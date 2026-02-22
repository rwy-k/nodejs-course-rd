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
  ) {}

  async create(
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
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
