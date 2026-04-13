import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { ProcessedMessage } from '../entities/processed-message.entity';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { OrderProcessorService } from './order-processor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, ProcessedMessage]),
    RabbitmqModule,
  ],
  providers: [OrderProcessorService],
})
export class OrderProcessorModule {}
