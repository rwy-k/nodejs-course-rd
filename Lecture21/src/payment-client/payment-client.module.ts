import { Module } from '@nestjs/common';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { PAYMENT_CLIENT } from './constants';
import { PaymentClientService } from './payment-client.service';

const protoPath = join(
  process.cwd(),
  'packages',
  'contracts',
  'proto',
  'payments.proto',
);

@Module({
  providers: [
    {
      provide: PAYMENT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('paymentsClient.grpcUrl');
        return ClientProxyFactory.create({
          transport: Transport.GRPC,
          options: {
            package: 'payments',
            protoPath,
            url,
            loader: { keepCase: true },
          },
        });
      },
    },
    PaymentClientService,
  ],
  exports: [PaymentClientService],
})
export class PaymentClientModule {}
