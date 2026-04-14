import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FileRecord,
  FileStatus,
  FileVisibility,
  FileEntityType,
} from '../entities/file-record.entity';

export interface CreateFileRecordDto {
  ownerId: number;
  entityType: FileEntityType;
  entityId: number;
  key: string;
  originalName: string;
  contentType: string;
  size: number;
  visibility?: FileVisibility;
  url?: string;
}

@Injectable()
export class FileRecordsService {
  constructor(
    @InjectRepository(FileRecord)
    private fileRecordsRepository: Repository<FileRecord>,
  ) {}

  async create(dto: CreateFileRecordDto): Promise<FileRecord> {
    const fileRecord = this.fileRecordsRepository.create({
      ...dto,
      status: FileStatus.PENDING,
      visibility: dto.visibility || FileVisibility.PRIVATE,
    });

    return this.fileRecordsRepository.save(fileRecord);
  }

  async markAsReady(
    id: number,
    updates?: { url?: string; size?: number },
  ): Promise<FileRecord> {
    const fileRecord = await this.findOne(id);
    fileRecord.status = FileStatus.READY;
    if (updates?.url) {
      fileRecord.url = updates.url;
    }
    if (updates?.size) {
      fileRecord.size = updates.size;
    }
    return this.fileRecordsRepository.save(fileRecord);
  }

  async markAsReadyByKey(
    key: string,
    updates?: { url?: string; size?: number },
  ): Promise<FileRecord> {
    const fileRecord = await this.findByKey(key);
    fileRecord.status = FileStatus.READY;
    if (updates?.url) {
      fileRecord.url = updates.url;
    }
    if (updates?.size) {
      fileRecord.size = updates.size;
    }
    return this.fileRecordsRepository.save(fileRecord);
  }

  async findOne(id: number): Promise<FileRecord> {
    const fileRecord = await this.fileRecordsRepository.findOne({
      where: { id },
    });

    if (!fileRecord) {
      throw new NotFoundException(`FileRecord with ID ${id} not found`);
    }

    return fileRecord;
  }

  async findByKey(key: string): Promise<FileRecord> {
    const fileRecord = await this.fileRecordsRepository.findOne({
      where: { key },
    });

    if (!fileRecord) {
      throw new NotFoundException(`FileRecord with key ${key} not found`);
    }

    return fileRecord;
  }

  async findByEntity(
    entityType: FileEntityType,
    entityId: number,
  ): Promise<FileRecord[]> {
    return this.fileRecordsRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByOwner(ownerId: number): Promise<FileRecord[]> {
    return this.fileRecordsRepository.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateVisibility(
    id: number,
    visibility: FileVisibility,
  ): Promise<FileRecord> {
    const fileRecord = await this.findOne(id);
    fileRecord.visibility = visibility;
    return this.fileRecordsRepository.save(fileRecord);
  }

  async delete(id: number): Promise<void> {
    const fileRecord = await this.findOne(id);
    await this.fileRecordsRepository.remove(fileRecord);
  }

  async deleteByKey(key: string): Promise<void> {
    const fileRecord = await this.findByKey(key);
    await this.fileRecordsRepository.remove(fileRecord);
  }
}
