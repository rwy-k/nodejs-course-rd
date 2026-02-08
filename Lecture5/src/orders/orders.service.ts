import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryFailedError, In } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../entities/product.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

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

  async findByUser(userId: number): Promise<Order[]> {
    return this.orderRepository.find({
      where: { userId },
      relations: ['items', 'items.product'],
    });
  }

  async findOne(id: number): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['items', 'items.product', 'user'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
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
