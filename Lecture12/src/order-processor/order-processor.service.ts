import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { ProcessedMessage } from '../entities/processed-message.entity';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { OrderProcessMessageDto } from '../rabbitmq/dto/order-process-message.dto';

const DEFAULT_SLEEP_MS = 0;
const ORDER_PROCESS_HANDLER = 'order.process';

function logContext(messageId: string, orderId: number, attempt: number): string {
  return `messageId=${messageId} orderId=${orderId} attempt=${attempt}`;
}

const MAX_REASON_LEN = 200;

function errorReason(err: unknown): string {
  const s = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
  return s.length > MAX_REASON_LEN ? s.slice(0, MAX_REASON_LEN) + '…' : s;
}

@Injectable()
export class OrderProcessorService implements OnModuleInit {
  private readonly logger = new Logger(OrderProcessorService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly rabbitmqService: RabbitmqService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.rabbitmqService.startOrdersProcessConsumer(this.handleMessage.bind(this));
  }

  private async handleMessage(
    payload: OrderProcessMessageDto,
    ack: () => void,
    nack: (requeue?: boolean) => void,
  ): Promise<void> {
    const orderId = typeof payload.orderId === 'string' ? parseInt(payload.orderId, 10) : payload.orderId;
    if (Number.isNaN(orderId)) {
      this.logger.warn(`${logContext(payload.messageId, -1, payload.attempt)} result=invalid reason=invalid orderId`);
      nack(false);
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      try {
        await queryRunner.manager.insert(ProcessedMessage, {
          messageId: payload.messageId,
          processedAt: new Date(),
          orderId,
          handler: ORDER_PROCESS_HANDLER,
        });
      } catch (insertErr) {
        if (this.isPostgresUniqueViolation(insertErr)) {
          this.logger.log(`${logContext(payload.messageId, orderId, payload.attempt)} result=success reason=already processed (idempotent skip)`);
          await queryRunner.rollbackTransaction();
          queryRunner.release();
          ack();
          return;
        }
        throw insertErr;
      }

      const order = await queryRunner.manager.findOne(Order, { where: { id: orderId } });
      if (!order) {
        this.logger.warn(`${logContext(payload.messageId, orderId, payload.attempt)} result=skip reason=order not found`);
        await queryRunner.rollbackTransaction();
        queryRunner.release();
        ack();
        return;
      }

      if (order.status === OrderStatus.PROCESSED) {
        this.logger.log(`${logContext(payload.messageId, orderId, payload.attempt)} result=success reason=order already processed`);
        await queryRunner.commitTransaction();
        queryRunner.release();
        ack();
        return;
      }

      const sleepMs = this.configService.get<number>('ORDER_PROCESSOR_SLEEP_MS', DEFAULT_SLEEP_MS);
      if (sleepMs > 0) {
        await this.sleep(sleepMs);
      }

      order.status = OrderStatus.PROCESSED;
      order.processedAt = new Date();
      await queryRunner.manager.save(Order, order);

      await queryRunner.commitTransaction();
      queryRunner.release();

      ack();
      this.logger.log(`${logContext(payload.messageId, orderId, payload.attempt)} result=success`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      queryRunner.release();

      const maxAttempts = this.configService.get<number>('rabbitmq.retry.maxAttempts', 3);
      const delayMs = this.configService.get<number>('rabbitmq.retry.delayMs', 5000);
      const reason = errorReason(err);

      ack();
      if (payload.attempt < maxAttempts) {
        this.logger.warn(
          `${logContext(payload.messageId, orderId, payload.attempt)} result=retry reason=${reason} (next attempt ${payload.attempt + 1}/${maxAttempts}, delay ${delayMs}ms)`,
        );
        await this.sleep(delayMs);
        const republished = await this.rabbitmqService.publishOrderProcess({
          ...payload,
          attempt: payload.attempt + 1,
        });
        if (!republished) {
          this.logger.error(`${logContext(payload.messageId, orderId, payload.attempt)} result=error reason=republish failed, message lost`);
        }
      } else {
        this.logger.error(
          `${logContext(payload.messageId, orderId, payload.attempt)} result=dlq reason=${reason}`,
        );
        await this.rabbitmqService.publishToOrdersDlq({
          ...payload,
          failedAt: new Date().toISOString(),
          reason,
        });
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isPostgresUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driverError = (err as QueryFailedError & { driverError?: { code?: string } }).driverError;
    return typeof driverError === 'object' && driverError !== null && driverError.code === '23505';
  }
}
