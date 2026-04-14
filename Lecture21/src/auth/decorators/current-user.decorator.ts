import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../entities/user.entity';

export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, executionContext: ExecutionContext) => {
    const request = executionContext
      .switchToHttp()
      .getRequest<{ user?: User }>();
    const user = request.user;

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
