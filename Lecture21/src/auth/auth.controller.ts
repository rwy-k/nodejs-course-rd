import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  NotImplementedException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard } from './guards';
import { CurrentUser, Public } from './decorators';
import { User } from '../entities/user.entity';
import { THROTTLE_AUTH_STRICT } from '../config/throttle.config';
import { auditContextFromRequest } from '../audit/audit-context.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle(THROTTLE_AUTH_STRICT)
  async register(
    @Body() registerDto: RegisterDto,
    @Req() httpRequest: Request,
  ) {
    return this.authService.register(
      registerDto,
      auditContextFromRequest(httpRequest),
    );
  }

  @Public()
  @Post('login')
  @Throttle(THROTTLE_AUTH_STRICT)
  async login(@Body() loginDto: LoginDto, @Req() httpRequest: Request) {
    return this.authService.login(
      loginDto,
      auditContextFromRequest(httpRequest),
    );
  }

  @Public()
  @Post('refresh')
  @Throttle(THROTTLE_AUTH_STRICT)
  refreshToken(): void {
    throw new NotImplementedException(
      'Refresh token flow is not implemented; endpoint is rate-limited for future use.',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: User) {
    return this.authService.getProfile(user.id);
  }
}
