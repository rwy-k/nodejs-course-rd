import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => ({
  host: process.env.RABBITMQ_HOST,
  port: parseInt(process.env.RABBITMQ_PORT || '', 10),
  user: process.env.RABBITMQ_USER,
  password: process.env.RABBITMQ_PASSWORD,
  queue: {
    ordersProcess: 'orders.process',
    ordersDlq: 'orders.dlq',
  },
  retry: {
    maxAttempts: parseInt(process.env.ORDER_PROCESSOR_MAX_ATTEMPTS || '3', 10),
    delayMs: parseInt(process.env.ORDER_PROCESSOR_RETRY_DELAY_MS || '5000', 10),
  },
}));
