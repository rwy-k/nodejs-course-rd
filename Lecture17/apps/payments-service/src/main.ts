import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';
import { appConfig } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const protoPath = join(
    process.cwd(),
    '..',
    '..',
    'packages',
    'contracts',
    'proto',
    'payments.proto',
  );

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'payments',
      protoPath,
      url: appConfig.grpcUrl,
      loader: { keepCase: true },
    },
  });

  await app.startAllMicroservices();
  await app.listen(appConfig.httpPort);
}
void bootstrap();
