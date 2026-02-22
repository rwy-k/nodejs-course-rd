import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Headers,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Roles } from '../auth/decorators';
import { UserRole } from '../entities/user.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const idempotencyKey =
      idempotencyKeyHeader || createOrderDto.idempotencyKey;
    const { order, created } = await this.ordersService.create(
      createOrderDto,
      idempotencyKey,
    );

    res?.status(created ? HttpStatus.CREATED : HttpStatus.OK);

    return {
      data: order,
      created,
      message: created
        ? 'Order created successfully'
        : 'Order already exists (idempotent response)',
    };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.ordersService.findAll();
  }

  @Get('user/:userId')
  findByUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.ordersService.findByUser(userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.update(id, updateOrderDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.remove(id);
  }
}
