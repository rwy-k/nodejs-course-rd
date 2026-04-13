import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../entities/user.entity';
import { LoginDto, RegisterDto } from './dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import type { AuditRequestContext } from '../audit/audit.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(
    registerDto: RegisterDto,
    auditRequestContext?: AuditRequestContext | null,
  ) {
    const existingUser = await this.usersRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = this.usersRepository.create({
      ...registerDto,
      password: hashedPassword,
      role: UserRole.USER,
    });

    const savedUser = await this.usersRepository.save(user);

    this.audit.log({
      action: 'auth.register',
      actor: { id: savedUser.id, role: savedUser.role },
      targetType: 'User',
      targetId: savedUser.id,
      outcome: 'success',
      auditRequestContext: auditRequestContext ?? null,
    });

    const { password, ...result } = savedUser;
    void password;
    return {
      user: result,
      accessToken: this.generateToken(savedUser),
    };
  }

  async login(
    loginDto: LoginDto,
    auditRequestContext?: AuditRequestContext | null,
  ) {
    const user = await this.usersRepository.findOne({
      where: { email: loginDto.email },
      select: [
        'id',
        'email',
        'firstName',
        'lastName',
        'role',
        'isActive',
        'password',
      ],
    });

    if (!user) {
      this.audit.log({
        action: 'auth.login',
        actor: null,
        targetType: 'User',
        targetId: null,
        outcome: 'denied',
        auditRequestContext: auditRequestContext ?? null,
        reason: 'user_not_found',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      this.audit.log({
        action: 'auth.login',
        actor: { id: user.id, role: user.role },
        targetType: 'User',
        targetId: user.id,
        outcome: 'denied',
        auditRequestContext: auditRequestContext ?? null,
        reason: 'inactive_user',
      });
      throw new UnauthorizedException('User is inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      this.audit.log({
        action: 'auth.login',
        actor: null,
        targetType: 'User',
        targetId: user.id,
        outcome: 'denied',
        auditRequestContext: auditRequestContext ?? null,
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.audit.log({
      action: 'auth.login',
      actor: { id: user.id, role: user.role },
      targetType: 'User',
      targetId: user.id,
      outcome: 'success',
      auditRequestContext: auditRequestContext ?? null,
    });

    const { password, ...result } = user;
    void password;
    return {
      user: result,
      accessToken: this.generateToken(user),
    };
  }

  async getProfile(userId: number) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    return this.jwtService.sign(payload);
  }
}
