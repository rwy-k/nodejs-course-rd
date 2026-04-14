import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { Channel, ChannelModel, Message } from 'amqplib';
import {
  OrderProcessMessageDto,
  OrderDlqMessageDto,
  ORDER_PROCESS_EVENT_NAME,
} from './dto/order-process-message.dto';

const QUEUE_ORDERS_PROCESS = 'orders.process';
const QUEUE_ORDERS_DLQ = 'orders.dlq';

export type OrderProcessHandler = (
  payload: OrderProcessMessageDto,
  acknowledgeMessage: () => void,
  negativeAcknowledgeMessage: (requeue?: boolean) => void,
) => Promise<void>;

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerChannel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly producer = 'nestjs-shop-api';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async connect(): Promise<void> {
    const host = this.configService.get<string>('rabbitmq.host');
    const port = this.configService.get<number>('rabbitmq.port');
    const user = this.configService.get<string>('rabbitmq.user');
    const password = this.configService.get<string>('rabbitmq.password');

    if (!host) {
      this.logger.warn(
        'RabbitMQ not configured (RABBITMQ_HOST missing), publishing disabled',
      );
      return;
    }

    try {
      const url = `amqp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port || 5672}`;
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      this.consumerChannel = await this.connection.createChannel();
      await this.consumerChannel.prefetch(1);

      this.connection.on('error', (connectionError) => {
        this.logger.error('RabbitMQ connection error', connectionError);
      });
      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
      });

      await this.assertOrdersProcessQueue();
      await this.assertOrdersDlqQueue();
      this.logger.log('RabbitMQ connected and queues asserted');
    } catch (connectionError) {
      this.logger.error('Failed to connect to RabbitMQ', connectionError);
      this.connection = null;
      this.channel = null;
      this.consumerChannel = null;
    }
  }

  startOrdersProcessConsumer(handler: OrderProcessHandler): void {
    if (!this.consumerChannel) {
      this.logger.warn('RabbitMQ consumer channel not available');
      return;
    }
    this.consumerChannel
      .consume(
        QUEUE_ORDERS_PROCESS,
        (queueMessage: Message | null) => {
          void (async () => {
            if (!queueMessage) return;
            let payload: OrderProcessMessageDto;
            try {
              payload = JSON.parse(
                queueMessage.content.toString('utf-8'),
              ) as OrderProcessMessageDto;
            } catch (parseError) {
              this.logger.error(
                'Invalid message body, nack without requeue',
                parseError,
              );
              this.consumerChannel?.nack(queueMessage, false, false);
              return;
            }
            const acknowledgeMessage = () =>
              this.consumerChannel?.ack(queueMessage);
            const negativeAcknowledgeMessage = (requeue = false) =>
              this.consumerChannel?.nack(queueMessage, false, requeue);
            try {
              await handler(
                payload,
                acknowledgeMessage,
                negativeAcknowledgeMessage,
              );
            } catch (handlerError) {
              this.logger.error('Order process handler failed', handlerError);
              negativeAcknowledgeMessage(true);
            }
          })();
        },
        { noAck: false },
      )
      .then((consumerRegistration) => {
        this.consumerTag = consumerRegistration.consumerTag;
        this.logger.log('Orders process consumer started');
      })
      .catch((consumerStartError) => {
        this.logger.error(
          'Failed to start orders process consumer',
          consumerStartError,
        );
      });
  }

  private async assertOrdersProcessQueue(): Promise<void> {
    if (!this.channel) return;
    await this.channel.assertQueue(QUEUE_ORDERS_PROCESS, {
      durable: true,
    });
  }

  private async assertOrdersDlqQueue(): Promise<void> {
    if (!this.channel) return;
    await this.channel.assertQueue(QUEUE_ORDERS_DLQ, {
      durable: true,
    });
  }

  async publishToOrdersDlq(payload: OrderDlqMessageDto): Promise<boolean> {
    await Promise.resolve();
    if (!this.channel) {
      this.logger.warn('RabbitMQ channel not available, skip DLQ publish');
      return false;
    }
    try {
      const sent = this.channel.sendToQueue(
        QUEUE_ORDERS_DLQ,
        Buffer.from(JSON.stringify(payload), 'utf-8'),
        {
          persistent: true,
          contentType: 'application/json',
        },
      );
      if (!sent) {
        this.logger.warn('Channel buffer full, DLQ message not sent');
        return false;
      }
      return true;
    } catch (publishError) {
      this.logger.error('Failed to publish to orders.dlq', publishError);
      return false;
    }
  }

  async publishOrderProcess(payload: OrderProcessMessageDto): Promise<boolean> {
    await Promise.resolve();
    if (!this.channel) {
      this.logger.warn('RabbitMQ channel not available, skip publish');
      return false;
    }

    const message: OrderProcessMessageDto = {
      ...payload,
      producer: payload.producer ?? this.producer,
      eventName: payload.eventName ?? ORDER_PROCESS_EVENT_NAME,
    };

    try {
      const sent = this.channel.sendToQueue(
        QUEUE_ORDERS_PROCESS,
        Buffer.from(JSON.stringify(message), 'utf-8'),
        {
          persistent: true,
          contentType: 'application/json',
        },
      );
      if (!sent) {
        this.logger.warn('Channel buffer full, message not sent');
        return false;
      }
      return true;
    } catch (publishError) {
      this.logger.error('Failed to publish to orders.process', publishError);
      return false;
    }
  }

  private async close(): Promise<void> {
    try {
      if (this.consumerChannel && this.consumerTag) {
        await this.consumerChannel.cancel(this.consumerTag);
        this.consumerTag = null;
      }
      if (this.consumerChannel) {
        await this.consumerChannel.close();
        this.consumerChannel = null;
      }
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
    } catch (closeError) {
      this.logger.error('Error closing RabbitMQ', closeError);
    }
  }
}
