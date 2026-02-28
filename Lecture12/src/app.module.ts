import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { HelloModule } from './hello/hello.module';
import { GraphqlResolversModule } from './graphql/graphql.module';
import { AuthModule } from './auth/auth.module';
import { UploadModule } from './upload/upload.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { formatGraphQLError } from './graphql/utils/format-error';
import databaseConfig from './config/database.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { OrderProcessorModule } from './order-processor/order-processor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, rabbitmqConfig],
    }),
    RabbitmqModule,
    OrderProcessorModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: process.env.NODE_ENV === 'development',
        logging: process.env.NODE_ENV === 'development',
      }),
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile:
        process.env.NODE_ENV === 'production'
          ? true
          : join(process.cwd(), 'src/schema.gql'),
      path: '/graphql',
      playground: process.env.NODE_ENV !== 'production',
      formatError: formatGraphQLError,
      context: ({ req }) => ({ req }),
    }),
    AuthModule,
    UsersModule,
    ProductsModule,
    OrdersModule,
    HelloModule,
    GraphqlResolversModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
