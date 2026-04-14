export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEventPayload {
  type: 'audit';
  action: string;
  actorId: number | null;
  actorRole: string | null;
  targetType: string;
  targetId: string | number | null;
  outcome: AuditOutcome;
  timestamp: string;
  correlationId: string | null;
  requestId: string;
  reason?: string;
  ip?: string | null;
  userAgentTruncated?: string | null;
}

export type AuditRequestContext = {
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
};
