import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { THROTTLE_GRAPHQL_MUTATION } from '../config/throttle.config';

@Resolver()
export class HelloResolver {
  @Public()
  @Query(() => String)
  hello(): string {
    return 'Hello World!';
  }

  @Public()
  @Mutation(() => String, {
    name: 'clientPing',
    description: 'Strictly throttled mutation bucket (placeholder).',
  })
  @Throttle(THROTTLE_GRAPHQL_MUTATION)
  clientPing(): string {
    return 'pong';
  }
}
