import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryFailedError, In } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../entities/product.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import {
  FindOrdersDto,
  FindOrdersResult,
  encodeCursor,
  decodeCursor,
} from './dto/find-orders.dto';
import {
  NotFoundError,
  DatabaseError,
} from '../common/exceptions/graphql.exceptions';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentClientService } from '../payment-client/payment-client.service';
import { PaymentGrpcError, GrpcStatusCode } from '../payment-client/grpc-errors';
import { randomUUID } from 'crypto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly rabbitmqService: RabbitmqService,
    private readonly paymentClient: PaymentClientService,
  ) {}

  async create(
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
    options?: { correlationId?: string },
  ): Promise<{ order: Order; created: boolean }> {
    const key = idempotencyKey || createOrderDto.idempotencyKey;

    if (key) {
      const existingOrder = await this.orderRepository.findOne({
        where: { idempotencyKey: key },
        relations: ['items', 'items.product', 'user'],
      });

      if (existingOrder) {
        return { order: existingOrder, created: false };
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const productIds = createOrderDto.items.map((item) => item.productId);

      const sortedProductIds = [...productIds].sort((a, b) => a - b);

      const lockedProducts = await queryRunner.manager.find(Product, {
        where: { id: In(sortedProductIds) },
        lock: { mode: 'pessimistic_write' },
        order: { id: 'ASC' },
      });

      const productMap = new Map(lockedProducts.map((p) => [p.id, p]));

      for (const itemDto of createOrderDto.items) {
        const product = productMap.get(itemDto.productId);

        if (!product) {
          throw new NotFoundException(
            `Product with ID ${itemDto.productId} not found`,
          );
        }

        if (product.stock < itemDto.quantity) {
          throw new ConflictException(
            `Insufficient stock for product ${product.name}. ` +
              `Available: ${product.stock}, requested: ${itemDto.quantity}`,
          );
        }
      }

      const order = queryRunner.manager.create(Order, {
        userId: createOrderDto.userId,
        shippingAddress: createOrderDto.shippingAddress,
        idempotencyKey: key || null,
        totalAmount: 0,
      });

      const savedOrder = await queryRunner.manager.save(Order, order);

      let totalAmount = 0;
      const orderItems: OrderItem[] = [];

      for (const itemDto of createOrderDto.items) {
        const product = productMap.get(itemDto.productId)!;

        product.stock -= itemDto.quantity;
        await queryRunner.manager.save(Product, product);

        const orderItem = queryRunner.manager.create(OrderItem, {
          orderId: savedOrder.id,
          productId: product.id,
          quantity: itemDto.quantity,
          price: product.price,
        });

        const savedItem = await queryRunner.manager.save(OrderItem, orderItem);
        orderItems.push(savedItem);

        totalAmount += Number(product.price) * itemDto.quantity;
      }

      savedOrder.totalAmount = totalAmount;
      savedOrder.items = orderItems;
      await queryRunner.manager.save(Order, savedOrder);

      await queryRunner.commitTransaction();

      const fullOrder = await this.orderRepository.findOne({
        where: { id: savedOrder.id },
        relations: ['items', 'items.product', 'user'],
      });

      if (fullOrder) {
        const messageId = randomUUID();
        this.rabbitmqService
          .publishOrderProcess({
            messageId,
            orderId: fullOrder.id,
            createdAt: fullOrder.createdAt.toISOString(),
            attempt: 0,
            correlationId: options?.correlationId,
          })
          .catch((err) => {
            this.logger.warn('Failed to publish order to RabbitMQ', err);
          });
      }

      return { order: fullOrder!, created: true };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      const isUniqueViolation =
        error instanceof QueryFailedError &&
        this.isPostgresUniqueViolation(error);

      if (isUniqueViolation && key) {
        const existingOrder = await this.orderRepository.findOne({
          where: { idempotencyKey: key },
          relations: ['items', 'items.product', 'user'],
        });

        if (existingOrder) {
          return { order: existingOrder, created: false };
        }
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to create order. Please try again later.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      relations: ['items', 'items.product', 'user'],
    });
  }

  private readonly logger = new Logger(OrdersService.name);

  async findAllFiltered(options?: FindOrdersDto): Promise<FindOrdersResult> {
    try {
      const countQb = this.orderRepository.createQueryBuilder('order');

      if (options?.filter) {
        const { status, dateFrom, dateTo } = options.filter;
        if (status) {
          countQb.andWhere('order.status = :status', { status });
        }
        if (dateFrom) {
          countQb.andWhere('order.createdAt >= :dateFrom', { dateFrom });
        }
        if (dateTo) {
          countQb.andWhere('order.createdAt <= :dateTo', { dateTo });
        }
      }

      const totalCount = await countQb.getCount();

      const qb = this.orderRepository
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.items', 'items')
        .leftJoinAndSelect('order.user', 'user');

      if (options?.filter) {
        const { status, dateFrom, dateTo } = options.filter;
        if (status) {
          qb.andWhere('order.status = :status', { status });
        }
        if (dateFrom) {
          qb.andWhere('order.createdAt >= :dateFrom', { dateFrom });
        }
        if (dateTo) {
          qb.andWhere('order.createdAt <= :dateTo', { dateTo });
        }
      }

      const limit = Math.min(options?.pagination?.first ?? 20, 50);
      const afterCursor = options?.pagination?.after;
      const beforeCursor = options?.pagination?.before;

      const afterData = afterCursor ? decodeCursor(afterCursor) : null;
      const beforeData = beforeCursor ? decodeCursor(beforeCursor) : null;

      if (afterData) {
        qb.andWhere(
          '(order.createdAt < :afterDate OR (order.createdAt = :afterDate AND order.id < :afterId))',
          { afterDate: afterData.createdAt, afterId: afterData.id },
        );
      }

      if (beforeData) {
        qb.andWhere(
          '(order.createdAt > :beforeDate OR (order.createdAt = :beforeDate AND order.id > :beforeId))',
          { beforeDate: beforeData.createdAt, beforeId: beforeData.id },
        );
      }

      qb.orderBy('order.createdAt', 'DESC').addOrderBy('order.id', 'DESC');
      qb.take(limit + 1);

      let data = await qb.getMany();

      const hasNextPage = data.length > limit;
      if (hasNextPage) {
        data = data.slice(0, limit);
      }

      const hasPreviousPage = !!afterCursor;

      const startCursor = data.length > 0 ? encodeCursor(data[0].id, data[0].createdAt) : undefined;
      const endCursor =
        data.length > 0 ? encodeCursor(data[data.length - 1].id, data[data.length - 1].createdAt) : undefined;

      return {
        data,
        totalCount,
        hasNextPage,
        hasPreviousPage,
        startCursor,
        endCursor,
      };
    } catch (error) {
      this.logger.error('Failed to fetch orders', error);
      throw new DatabaseError('fetching orders');
    }
  }

  async findByUser(userId: number): Promise<Order[]> {
    try {
      return this.orderRepository.find({
        where: { userId },
        relations: ['items', 'items.product'],
      });
    } catch (error) {
      this.logger.error(`Failed to fetch orders for user ${userId}`, error);
      throw new DatabaseError('fetching user orders');
    }
  }

  async findOne(id: number): Promise<Order> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id },
        relations: ['items', 'items.product', 'user'],
      });

      if (!order) {
        throw new NotFoundError('Order', id);
      }

      return order;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.logger.error(`Failed to fetch order ${id}`, error);
      throw new DatabaseError('fetching order');
    }
  }

  async update(id: number, updateOrderDto: UpdateOrderDto): Promise<Order> {
    const order = await this.findOne(id);
    Object.assign(order, updateOrderDto);
    return this.orderRepository.save(order);
  }

  async remove(id: number): Promise<void> {
    const order = await this.findOne(id);
    await this.orderRepository.remove(order);
  }

  async requestPaymentForOrder(orderId: number): Promise<{
    paymentId: string;
    status: string;
    errorMessage?: string;
  }> {
    const order = await this.findOne(orderId);
    const amount = Math.round(Number(order.totalAmount) * 100).toString();
    try {
      const result = await this.paymentClient.authorize({
        order_id: String(order.id),
        amount,
        currency: 'UAH',
        idempotency_key: order.idempotencyKey ?? undefined,
      });
      const res = result as { payment_id?: string; paymentId?: string; status: string; error_message?: string; errorMessage?: string };
      return {
        paymentId: res.payment_id ?? res.paymentId ?? '',
        status: res.status,
        errorMessage: res.error_message ?? res.errorMessage,
      };
    } catch (err) {
      if (err instanceof PaymentGrpcError) {
        throw this.mapPaymentGrpcErrorToHttp(err);
      }
      throw err;
    }
  }

  private mapPaymentGrpcErrorToHttp(err: PaymentGrpcError): HttpException {
    const message = err.message || 'Payment service error';
    switch (err.code) {
      case GrpcStatusCode.INVALID_ARGUMENT:
        return new BadRequestException(`Invalid payment request: ${message}`);
      case GrpcStatusCode.NOT_FOUND:
        return new NotFoundException(`Payment not found: ${message}`);
      case GrpcStatusCode.ALREADY_EXISTS:
        return new ConflictException(`Payment conflict: ${message}`);
      case GrpcStatusCode.FAILED_PRECONDITION:
        return new BadRequestException(`Payment precondition failed: ${message}`);
      case GrpcStatusCode.DEADLINE_EXCEEDED:
        return new GatewayTimeoutException(`Payment service did not respond in time: ${message}`);
      case GrpcStatusCode.UNAVAILABLE:
      case GrpcStatusCode.RESOURCE_EXHAUSTED:
        return new ServiceUnavailableException(`Payment service temporarily unavailable: ${message}`);
      case GrpcStatusCode.PERMISSION_DENIED:
      case GrpcStatusCode.UNAUTHENTICATED:
        return new BadRequestException(`Payment authorization failed: ${message}`);
      default:
        return new ServiceUnavailableException(`Payment service error: ${message}`);
    }
  }

  private isPostgresUniqueViolation(error: QueryFailedError<any>): boolean {
    const driverError: unknown = error.driverError;
    return (
      typeof driverError === 'object' &&
      driverError !== null &&
      'code' in driverError &&
      driverError.code === '23505'
    );
  }
}
