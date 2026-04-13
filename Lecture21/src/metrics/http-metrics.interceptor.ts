import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Collapse numeric ids so Prometheus label cardinality stays low. */
function normalizeRoute(req: Request): string {
  const rawPath = req.path || req.url?.split('?')[0] || '';
  const collapsed = rawPath.replace(/\/[0-9]+/g, '/:id');
  return `${req.method} ${collapsed}`;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path || '';
    if (path === '/metrics') {
      return next.handle();
    }

    const start = process.hrtime.bigint();
    const method = req.method;
    const route = normalizeRoute(req);

    return next.handle().pipe(
      finalize(() => {
        const res = context.switchToHttp().getResponse<Response>();
        const statusCode = res.statusCode || 500;
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        this.metrics.recordHttp(method, route, statusCode, seconds);
      }),
    );
  }
}
