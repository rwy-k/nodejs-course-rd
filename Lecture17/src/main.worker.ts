import { NestFactory } from '@nestjs/core';
import { loadSecretsFromFiles } from './config/secrets.util';
import { WorkerAppModule } from './worker-app.module';

loadSecretsFromFiles();

async function bootstrap() {
  const app = await NestFactory.create(WorkerAppModule);
  await app.init();
}

void bootstrap();
