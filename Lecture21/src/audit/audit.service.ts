import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { UserRole } from '../entities/user.entity';
import type {
  AuditEventPayload,
  AuditOutcome,
  AuditRequestContext,
} from './audit.types';

export type AuditActor = {
  id: number;
  role: UserRole;
} | null;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  log(params: {
    action: string;
    actor: AuditActor;
    targetType: string;
    targetId: string | number | null;
    outcome: AuditOutcome;
    auditRequestContext?: AuditRequestContext | null;
    reason?: string;
  }): void {
    const payload: AuditEventPayload = {
      type: 'audit',
      action: params.action,
      actorId: params.actor?.id ?? null,
      actorRole: params.actor?.role ?? null,
      targetType: params.targetType,
      targetId: params.targetId,
      outcome: params.outcome,
      timestamp: new Date().toISOString(),
      correlationId: params.auditRequestContext?.correlationId ?? null,
      requestId: randomUUID(),
      reason: params.reason,
      ip: params.auditRequestContext?.ip ?? null,
      userAgentTruncated: params.auditRequestContext?.userAgent ?? null,
    };
    this.logger.log(JSON.stringify(payload));
  }
}
