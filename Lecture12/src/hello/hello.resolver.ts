import { Query, Resolver } from '@nestjs/graphql';
import { Public } from '../auth/decorators/public.decorator';

@Resolver()
export class HelloResolver {
  @Public()
  @Query(() => String)
  hello(): string {
    return 'Hello World!';
  }
}

