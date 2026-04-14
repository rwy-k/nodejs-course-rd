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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Roles, Public } from '../auth/decorators';
import { UserRole } from '../entities/user.entity';
import {
  THROTTLE_ADMIN_WRITE,
  THROTTLE_PAYMENT_STRICT,
} from '../config/throttle.config';
import { auditContextFromRequest } from '../audit/audit-context.util';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Res({ passthrough: true }) httpResponse?: Response,
  ) {
    const idempotencyKey =
      idempotencyKeyHeader || createOrderDto.idempotencyKey;
    const { order, created } = await this.ordersService.create(
      createOrderDto,
      idempotencyKey,
      { correlationId },
    );

    httpResponse?.status(created ? HttpStatus.CREATED : HttpStatus.OK);

    return {
      data: order,
      created,
      message: created ? 'Order created successfully' : 'Order already exists',
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
  findOne(@Param('id', ParseIntPipe) orderRecordId: number) {
    return this.ordersService.findOne(orderRecordId);
  }

  @Patch(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseIntPipe) orderRecordId: number,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.update(orderRecordId, updateOrderDto);
  }

  @Delete(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) orderRecordId: number) {
    return this.ordersService.remove(orderRecordId);
  }

  @Public()
  @Post(':id/request-payment')
  @Throttle(THROTTLE_PAYMENT_STRICT)
  async requestPayment(
    @Param('id', ParseIntPipe) orderRecordId: number,
    @Req() httpRequest: Request,
  ) {
    return this.ordersService.requestPaymentForOrder(
      orderRecordId,
      auditContextFromRequest(httpRequest),
    );
  }
}
