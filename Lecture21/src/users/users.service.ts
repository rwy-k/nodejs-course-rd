import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../audit/audit.types';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);
    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findOne(userRecordId: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userRecordId },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userRecordId} not found`);
    }
    return user;
  }

  async findByIds(userRecordIds: number[]): Promise<User[]> {
    if (userRecordIds.length === 0) {
      return [];
    }
    return this.userRepository.find({
      where: { id: In(userRecordIds) },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(
    userRecordId: number,
    updateUserDto: UpdateUserDto,
    actor?: User,
    auditRequestContext?: AuditRequestContext | null,
  ): Promise<User> {
    const user = await this.findOne(userRecordId);
    const prevRole = user.role;
    Object.assign(user, updateUserDto);
    const saved = await this.userRepository.save(user);
    if (
      actor &&
      updateUserDto.role !== undefined &&
      updateUserDto.role !== prevRole
    ) {
      this.audit.log({
        action: 'user.role_change',
        actor: { id: actor.id, role: actor.role },
        targetType: 'User',
        targetId: userRecordId,
        outcome: 'success',
        auditRequestContext: auditRequestContext ?? null,
        reason: `from:${prevRole};to:${saved.role}`,
      });
    }
    return saved;
  }

  async remove(userRecordId: number): Promise<void> {
    const user = await this.findOne(userRecordId);
    await this.userRepository.remove(user);
  }
}
