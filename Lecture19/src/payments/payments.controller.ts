import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentClientService } from '../payment-client/payment-client.service';
import {
  PaymentGrpcError,
  paymentGrpcErrorToHttp,
} from '../payment-client/grpc-errors';
import { Roles, CurrentUser } from '../auth/decorators';
import { User, UserRole } from '../entities/user.entity';
import { CapturePaymentDto } from './dto/capture-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { THROTTLE_PAYMENT_STRICT } from '../config/throttle.config';
import { AuditService } from '../audit/audit.service';
import { auditContextFromRequest } from '../audit/audit-context.util';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentClient: PaymentClientService,
    private readonly audit: AuditService,
  ) {}

  @Post('capture')
  @Throttle(THROTTLE_PAYMENT_STRICT)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Capture authorized payment (gRPC stub)' })
  @ApiResponse({ status: 201, description: 'Capture result' })
  async capture(
    @Body() capturePaymentDto: CapturePaymentDto,
    @CurrentUser() actor: User,
    @Req() httpRequest: Request,
  ) {
    const auditRequestContext = auditContextFromRequest(httpRequest);
    try {
      const result = await this.paymentClient.capture({
        payment_id: capturePaymentDto.payment_id,
        amount: capturePaymentDto.amount,
        idempotency_key: capturePaymentDto.idempotency_key,
      });
      this.audit.log({
        action: 'payment.capture',
        actor: { id: actor.id, role: actor.role },
        targetType: 'Payment',
        targetId: capturePaymentDto.payment_id,
        outcome: 'success',
        auditRequestContext,
        reason: `status:${result.status}`,
      });
      return result;
    } catch (caughtError) {
      this.audit.log({
        action: 'payment.capture',
        actor: { id: actor.id, role: actor.role },
        targetType: 'Payment',
        targetId: capturePaymentDto.payment_id,
        outcome: 'failure',
        auditRequestContext,
        reason:
          caughtError instanceof PaymentGrpcError
            ? `grpc_code:${caughtError.code}`
            : 'capture_failed',
      });
      if (caughtError instanceof PaymentGrpcError) {
        throw paymentGrpcErrorToHttp(caughtError);
      }
      throw caughtError;
    }
  }

  @Post('refund')
  @Throttle(THROTTLE_PAYMENT_STRICT)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Refund captured payment (gRPC stub)' })
  @ApiResponse({ status: 201, description: 'Refund result' })
  async refund(
    @Body() refundPaymentDto: RefundPaymentDto,
    @CurrentUser() actor: User,
    @Req() httpRequest: Request,
  ) {
    const auditRequestContext = auditContextFromRequest(httpRequest);
    try {
      const result = await this.paymentClient.refund({
        payment_id: refundPaymentDto.payment_id,
        amount: refundPaymentDto.amount,
        idempotency_key: refundPaymentDto.idempotency_key,
      });
      this.audit.log({
        action: 'payment.refund',
        actor: { id: actor.id, role: actor.role },
        targetType: 'Payment',
        targetId: refundPaymentDto.payment_id,
        outcome: 'success',
        auditRequestContext,
        reason: `status:${result.status}`,
      });
      return result;
    } catch (caughtError) {
      this.audit.log({
        action: 'payment.refund',
        actor: { id: actor.id, role: actor.role },
        targetType: 'Payment',
        targetId: refundPaymentDto.payment_id,
        outcome: 'failure',
        auditRequestContext,
        reason:
          caughtError instanceof PaymentGrpcError
            ? `grpc_code:${caughtError.code}`
            : 'refund_failed',
      });
      if (caughtError instanceof PaymentGrpcError) {
        throw paymentGrpcErrorToHttp(caughtError);
      }
      throw caughtError;
    }
  }
}
