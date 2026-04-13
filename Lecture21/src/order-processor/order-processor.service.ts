import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { ProcessedMessage } from '../entities/processed-message.entity';
import {
  RabbitmqService,
  OrderProcessHandler,
} from '../rabbitmq/rabbitmq.service';
import { OrderProcessMessageDto } from '../rabbitmq/dto/order-process-message.dto';

const DEFAULT_SLEEP_MS = 0;
const ORDER_PROCESS_HANDLER = 'order.process';

function logContext(
  messageId: string,
  orderId: number,
  attempt: number,
): string {
  return `messageId=${messageId} orderId=${orderId} attempt=${attempt}`;
}

const MAX_REASON_LEN = 200;

function errorReason(unknownError: unknown): string {
  const raw =
    unknownError instanceof Error
      ? unknownError.message
      : typeof unknownError === 'string'
        ? unknownError
        : JSON.stringify(unknownError);
  const normalizedReasonText = raw.replace(/\s+/g, ' ').trim();
  return normalizedReasonText.length > MAX_REASON_LEN
    ? normalizedReasonText.slice(0, MAX_REASON_LEN) + '…'
    : normalizedReasonText;
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
    this.rabbitmqService.startOrdersProcessConsumer(
      this.handleMessage.bind(this) as OrderProcessHandler,
    );
  }

  private async handleMessage(
    payload: OrderProcessMessageDto,
    acknowledgeMessage: () => void,
    negativeAcknowledgeMessage: (requeue?: boolean) => void,
  ): Promise<void> {
    const orderId =
      typeof payload.orderId === 'string'
        ? parseInt(payload.orderId, 10)
        : payload.orderId;
    if (Number.isNaN(orderId)) {
      this.logger.warn(
        `${logContext(payload.messageId, -1, payload.attempt)} result=invalid reason=invalid orderId`,
      );
      negativeAcknowledgeMessage(false);
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
      } catch (insertError) {
        if (this.isPostgresUniqueViolation(insertError)) {
          this.logger.log(
            `${logContext(payload.messageId, orderId, payload.attempt)} result=success reason=already processed (idempotent skip)`,
          );
          await queryRunner.rollbackTransaction();
          await queryRunner.release();
          acknowledgeMessage();
          return;
        }
        throw insertError;
      }

      const order = await queryRunner.manager.findOne(Order, {
        where: { id: orderId },
      });
      if (!order) {
        this.logger.warn(
          `${logContext(payload.messageId, orderId, payload.attempt)} result=skip reason=order not found`,
        );
        await queryRunner.rollbackTransaction();
        await queryRunner.release();
        acknowledgeMessage();
        return;
      }

      if (order.status === OrderStatus.PROCESSED) {
        this.logger.log(
          `${logContext(payload.messageId, orderId, payload.attempt)} result=success reason=order already processed`,
        );
        await queryRunner.commitTransaction();
        await queryRunner.release();
        acknowledgeMessage();
        return;
      }

      const sleepMs = this.configService.get<number>(
        'ORDER_PROCESSOR_SLEEP_MS',
        DEFAULT_SLEEP_MS,
      );
      if (sleepMs > 0) {
        await this.sleep(sleepMs);
      }

      order.status = OrderStatus.PROCESSED;
      order.processedAt = new Date();
      await queryRunner.manager.save(Order, order);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      acknowledgeMessage();
      this.logger.log(
        `${logContext(payload.messageId, orderId, payload.attempt)} result=success`,
      );
    } catch (processingError) {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      const maxAttempts = this.configService.get<number>(
        'rabbitmq.retry.maxAttempts',
        3,
      );
      const delayMs = this.configService.get<number>(
        'rabbitmq.retry.delayMs',
        5000,
      );
      const reason = errorReason(processingError);

      acknowledgeMessage();
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
          this.logger.error(
            `${logContext(payload.messageId, orderId, payload.attempt)} result=error reason=republish failed, message lost`,
          );
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

  private sleep(delayMilliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
  }

  private isPostgresUniqueViolation(queryError: unknown): boolean {
    if (!(queryError instanceof QueryFailedError)) return false;
    const driverError = (
      queryError as QueryFailedError & { driverError?: { code?: string } }
    ).driverError;
    return (
      typeof driverError === 'object' &&
      driverError !== null &&
      driverError.code === '23505'
    );
  }
}
