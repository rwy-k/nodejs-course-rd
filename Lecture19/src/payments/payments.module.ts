import { Module } from '@nestjs/common';
import { PaymentClientModule } from '../payment-client/payment-client.module';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [PaymentClientModule],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
