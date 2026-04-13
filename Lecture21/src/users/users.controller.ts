import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators';
import { UserRole } from '../entities/user.entity';
import { THROTTLE_ADMIN_WRITE } from '../config/throttle.config';
import { CurrentUser } from '../auth/decorators';
import { User } from '../entities/user.entity';
import { auditContextFromRequest } from '../audit/audit-context.util';

@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Throttle(THROTTLE_ADMIN_WRITE)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) userRecordId: number) {
    return this.usersService.findOne(userRecordId);
  }

  @Patch(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  update(
    @Param('id', ParseIntPipe) userRecordId: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() actor: User,
    @Req() httpRequest: Request,
  ) {
    return this.usersService.update(
      userRecordId,
      updateUserDto,
      actor,
      auditContextFromRequest(httpRequest),
    );
  }

  @Delete(':id')
  @Throttle(THROTTLE_ADMIN_WRITE)
  remove(@Param('id', ParseIntPipe) userRecordId: number) {
    return this.usersService.remove(userRecordId);
  }
}
