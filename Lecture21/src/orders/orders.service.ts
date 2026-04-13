import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
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
import {
  PaymentGrpcError,
  paymentGrpcErrorToHttp,
} from '../payment-client/grpc-errors';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../audit/audit.types';

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
    private readonly audit: AuditService,
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

      const sortedProductIds = [...productIds].sort(
        (firstProductId, secondProductId) => firstProductId - secondProductId,
      );

      const lockedProducts = await queryRunner.manager.find(Product, {
        where: { id: In(sortedProductIds) },
        lock: { mode: 'pessimistic_write' },
        order: { id: 'ASC' },
      });

      const productMap = new Map(
        lockedProducts.map((product) => [product.id, product]),
      );

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
        const product = productMap.get(itemDto.productId);

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

      // Use the same query runner (one pool connection) until `finally` releases it.
      // `orderRepository.findOne` here would borrow a second connection while the runner
      // is still checked out — under parallel creates on one SKU that starves the pool.
      const fullOrder = await queryRunner.manager.findOne(Order, {
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
          .catch((publishError) => {
            this.logger.warn(
              'Failed to publish order to RabbitMQ',
              publishError,
            );
          });
      }

      return { order: fullOrder, created: true };
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
      const orderCountQueryBuilder =
        this.orderRepository.createQueryBuilder('order');

      if (options?.filter) {
        const { status, dateFrom, dateTo } = options.filter;
        if (status) {
          orderCountQueryBuilder.andWhere('order.status = :status', { status });
        }
        if (dateFrom) {
          orderCountQueryBuilder.andWhere('order.createdAt >= :dateFrom', {
            dateFrom,
          });
        }
        if (dateTo) {
          orderCountQueryBuilder.andWhere('order.createdAt <= :dateTo', {
            dateTo,
          });
        }
      }

      const totalCount = await orderCountQueryBuilder.getCount();

      const ordersPageQueryBuilder = this.orderRepository
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.items', 'items')
        .leftJoinAndSelect('order.user', 'user');

      if (options?.filter) {
        const { status, dateFrom, dateTo } = options.filter;
        if (status) {
          ordersPageQueryBuilder.andWhere('order.status = :status', { status });
        }
        if (dateFrom) {
          ordersPageQueryBuilder.andWhere('order.createdAt >= :dateFrom', {
            dateFrom,
          });
        }
        if (dateTo) {
          ordersPageQueryBuilder.andWhere('order.createdAt <= :dateTo', {
            dateTo,
          });
        }
      }

      const limit = Math.min(options?.pagination?.first ?? 20, 50);
      const afterCursor = options?.pagination?.after;
      const beforeCursor = options?.pagination?.before;

      const afterData = afterCursor ? decodeCursor(afterCursor) : null;
      const beforeData = beforeCursor ? decodeCursor(beforeCursor) : null;

      if (afterData) {
        ordersPageQueryBuilder.andWhere(
          '(order.createdAt < :afterDate OR (order.createdAt = :afterDate AND order.id < :afterId))',
          {
            afterDate: afterData.createdAt,
            afterId: afterData.orderRecordId,
          },
        );
      }

      if (beforeData) {
        ordersPageQueryBuilder.andWhere(
          '(order.createdAt > :beforeDate OR (order.createdAt = :beforeDate AND order.id > :beforeId))',
          {
            beforeDate: beforeData.createdAt,
            beforeId: beforeData.orderRecordId,
          },
        );
      }

      ordersPageQueryBuilder
        .orderBy('order.createdAt', 'DESC')
        .addOrderBy('order.id', 'DESC');
      ordersPageQueryBuilder.take(limit + 1);

      let data = await ordersPageQueryBuilder.getMany();

      const hasNextPage = data.length > limit;
      if (hasNextPage) {
        data = data.slice(0, limit);
      }

      const hasPreviousPage = !!afterCursor;

      const startCursor =
        data.length > 0
          ? encodeCursor(data[0].id, data[0].createdAt)
          : undefined;
      const endCursor =
        data.length > 0
          ? encodeCursor(
              data[data.length - 1].id,
              data[data.length - 1].createdAt,
            )
          : undefined;

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

  async findOne(orderRecordId: number): Promise<Order> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderRecordId },
        relations: ['items', 'items.product', 'user'],
      });

      if (!order) {
        throw new NotFoundError('Order', orderRecordId);
      }

      return order;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.logger.error(`Failed to fetch order ${orderRecordId}`, error);
      throw new DatabaseError('fetching order');
    }
  }

  private async findOrderForPaymentAuthorize(orderRecordId: number): Promise<{
    id: number;
    totalAmount: number;
    idempotencyKey: string | null;
  }> {
    try {
      const row = await this.orderRepository.findOne({
        where: { id: orderRecordId },
        select: ['id', 'totalAmount', 'idempotencyKey'],
      });
      if (!row) {
        throw new NotFoundError('Order', orderRecordId);
      }
      return row;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.logger.error(`Failed to fetch order ${orderRecordId}`, error);
      throw new DatabaseError('fetching order');
    }
  }

  async update(
    orderRecordId: number,
    updateOrderDto: UpdateOrderDto,
  ): Promise<Order> {
    const order = await this.findOne(orderRecordId);
    Object.assign(order, updateOrderDto);
    return this.orderRepository.save(order);
  }

  async remove(orderRecordId: number): Promise<void> {
    const order = await this.findOne(orderRecordId);
    await this.orderRepository.remove(order);
  }

  async requestPaymentForOrder(
    orderId: number,
    auditRequestContext?: AuditRequestContext | null,
  ): Promise<{
    paymentId: string;
    status: string;
    errorMessage?: string;
  }> {
    const order = await this.findOrderForPaymentAuthorize(orderId);
    const amount = Math.round(Number(order.totalAmount) * 100).toString();
    try {
      const result = await this.paymentClient.authorize({
        order_id: String(order.id),
        amount,
        currency: 'UAH',
        idempotency_key: order.idempotencyKey ?? undefined,
      });
      const authorizeResult = result as {
        payment_id?: string;
        paymentId?: string;
        status: string;
        error_message?: string;
        errorMessage?: string;
      };
      const paymentId =
        authorizeResult.payment_id ?? authorizeResult.paymentId ?? '';
      this.audit.log({
        action: 'payment.authorize_request',
        actor: null,
        targetType: 'Order',
        targetId: orderId,
        outcome: 'success',
        auditRequestContext: auditRequestContext ?? null,
        reason: `paymentId:${paymentId};status:${authorizeResult.status}`,
      });
      return {
        paymentId,
        status: authorizeResult.status,
        errorMessage:
          authorizeResult.error_message ?? authorizeResult.errorMessage,
      };
    } catch (caughtError) {
      const reason =
        caughtError instanceof PaymentGrpcError
          ? `grpc_code:${caughtError.code}`
          : 'authorize_failed';
      this.audit.log({
        action: 'payment.authorize_request',
        actor: null,
        targetType: 'Order',
        targetId: orderId,
        outcome: 'failure',
        auditRequestContext: auditRequestContext ?? null,
        reason,
      });
      if (caughtError instanceof PaymentGrpcError) {
        throw paymentGrpcErrorToHttp(caughtError);
      }
      throw caughtError;
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
