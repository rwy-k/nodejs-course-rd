import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { Public } from './auth/decorators';

@ApiTags('meta')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @SkipThrottle()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('admin')
  @ApiOperation({
    summary: 'Links to available API surfaces (GraphQL, Swagger, health)',
  })
  adminSurface(): {
    health: string;
    graphql: string;
    apiDocs: string | null;
  } {
    return {
      health: '/health',
      graphql: '/graphql',
      apiDocs: process.env.NODE_ENV !== 'production' ? '/api-docs' : null,
    };
  }
}
