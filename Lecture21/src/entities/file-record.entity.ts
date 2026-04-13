import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum FileStatus {
  PENDING = 'pending',
  READY = 'ready',
}

export enum FileVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

export enum FileEntityType {
  USER = 'user',
  PRODUCT = 'product',
}

@Entity('file_records')
@Index('idx_file_records_owner', ['ownerId'])
@Index('idx_file_records_entity', ['entityType', 'entityId'])
@Index('idx_file_records_key', ['key'], { unique: true })
export class FileRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  ownerId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({
    type: 'enum',
    enum: FileEntityType,
  })
  entityType: FileEntityType;

  @Column()
  entityId: number;

  @Column({ unique: true })
  key: string;

  @Column()
  originalName: string;

  @Column()
  contentType: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({
    type: 'enum',
    enum: FileStatus,
    default: FileStatus.PENDING,
  })
  status: FileStatus;

  @Column({
    type: 'enum',
    enum: FileVisibility,
    default: FileVisibility.PRIVATE,
  })
  visibility: FileVisibility;

  @Column({ nullable: true })
  url: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
