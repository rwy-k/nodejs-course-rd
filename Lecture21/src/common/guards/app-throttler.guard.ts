import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext): {
    req: Record<string, unknown>;
    res: Record<string, unknown>;
  } {
    if (context.getType<string>() === 'graphql') {
      const graphQlExecutionContext = GqlExecutionContext.create(context);
      const graphQlContext = graphQlExecutionContext.getContext<{
        req: Record<string, unknown>;
        res?: Record<string, unknown>;
      }>();
      return {
        req: graphQlContext.req,
        res: graphQlContext.res ?? {},
      };
    }
    return super.getRequestResponse(context);
  }
}
