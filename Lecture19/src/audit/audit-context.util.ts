import type { Request } from 'express';
import type { AuditRequestContext } from './audit.types';

const UA_MAX = 200;

export function auditContextFromRequest(
  httpRequest: Request,
): AuditRequestContext {
  const raw = httpRequest.headers['x-correlation-id'];
  const correlationId =
    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  const userAgentHeader = httpRequest.headers['user-agent'];
  const userAgent =
    typeof userAgentHeader === 'string'
      ? userAgentHeader.length > UA_MAX
        ? `${userAgentHeader.slice(0, UA_MAX)}…`
        : userAgentHeader
      : null;
  return {
    ip: typeof httpRequest.ip === 'string' ? httpRequest.ip : null,
    userAgent,
    correlationId,
  };
}
