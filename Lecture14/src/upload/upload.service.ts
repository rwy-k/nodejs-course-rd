import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { FileRecordsService } from '../file-records/file-records.service';
import {
  FileRecord,
  FileEntityType,
  FileVisibility,
} from '../entities/file-record.entity';

export interface UploadedFile {
  key: string;
  url: string;
  bucket: string;
  fileRecord: FileRecord;
}

export interface UploadOptions {
  ownerId: number;
  entityType: FileEntityType;
  entityId: number;
  visibility?: FileVisibility;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

@Injectable()
export class UploadService {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;
  private cloudFrontBaseUrl: string | null;

  constructor(
    private configService: ConfigService,
    private fileRecordsService: FileRecordsService,
  ) {
    this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET') || '';
    this.cloudFrontBaseUrl =
      this.configService.get<string>('CLOUDFRONT_BASE_URL') || null;

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
  }

  getPublicUrl(key: string): string {
    if (this.cloudFrontBaseUrl) {
      const baseUrl = this.cloudFrontBaseUrl.replace(/\/$/, '');
      return `${baseUrl}/${key}`;
    }

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private generateKey(
    entityType: FileEntityType,
    entityId: number,
    contentType: string,
  ): string {
    const extension = MIME_TO_EXTENSION[contentType] || 'bin';
    const fileId = uuidv4();

    switch (entityType) {
      case FileEntityType.USER:
        return `users/${entityId}/avatars/${fileId}.${extension}`;
      case FileEntityType.PRODUCT:
        return `products/${entityId}/images/${fileId}.${extension}`;
      default:
        return `uploads/${entityId}/${fileId}.${extension}`;
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    options: UploadOptions,
  ): Promise<UploadedFile> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimeTypes = Object.keys(MIME_TO_EXTENSION);

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only images are allowed (jpeg, png, gif, webp)',
      );
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    const key = this.generateKey(
      options.entityType,
      options.entityId,
      file.mimetype,
    );

    const fileRecord = await this.fileRecordsService.create({
      ownerId: options.ownerId,
      entityType: options.entityType,
      entityId: options.entityId,
      key,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      visibility: options.visibility || FileVisibility.PRIVATE,
    });

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const url = this.getPublicUrl(key);

      const updatedRecord = await this.fileRecordsService.markAsReady(fileRecord.id);
      updatedRecord.url = url;

      return {
        key,
        url,
        bucket: this.bucket,
        fileRecord: updatedRecord,
      };
    } catch (error) {
      await this.fileRecordsService.delete(fileRecord.id).catch(() => {});
      throw error;
    }
  }

  async uploadAvatar(
    file: Express.Multer.File,
    ownerId: number,
    userId: number,
  ): Promise<UploadedFile> {
    return this.uploadFile(file, {
      ownerId,
      entityType: FileEntityType.USER,
      entityId: userId,
      visibility: FileVisibility.PUBLIC,
    });
  }

  async uploadProductImage(
    file: Express.Multer.File,
    ownerId: number,
    productId: number,
  ): Promise<UploadedFile> {
    return this.uploadFile(file, {
      ownerId,
      entityType: FileEntityType.PRODUCT,
      entityId: productId,
      visibility: FileVisibility.PUBLIC,
    });
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);

    try {
      await this.fileRecordsService.deleteByKey(key);
    } catch {
      // File record might not exist
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getFileUrl(fileId: number): Promise<{ url: string; signed: boolean }> {
    const fileRecord = await this.fileRecordsService.findOne(fileId);

    if (fileRecord.visibility === FileVisibility.PUBLIC) {
      return {
        url: this.getPublicUrl(fileRecord.key),
        signed: false,
      };
    }

    const signedUrl = await this.getSignedUrl(fileRecord.key);
    return {
      url: signedUrl,
      signed: true,
    };
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.substring(1);
    } catch {
      return null;
    }
  }

  async getFilesByEntity(
    entityType: FileEntityType,
    entityId: number,
  ): Promise<FileRecord[]> {
    return this.fileRecordsService.findByEntity(entityType, entityId);
  }

  async createPresignedUpload(options: {
    ownerId: number;
    entityType: FileEntityType;
    entityId: number;
    contentType: string;
    originalName?: string;
    visibility?: FileVisibility;
  }): Promise<{
    fileId: string;
    key: string;
    uploadUrl: string;
    contentType: string;
  }> {
    const allowedMimeTypes = Object.keys(MIME_TO_EXTENSION);

    if (!allowedMimeTypes.includes(options.contentType)) {
      throw new BadRequestException(
        'Invalid content type. Only images are allowed (jpeg, png, gif, webp)',
      );
    }

    const key = this.generateKey(
      options.entityType,
      options.entityId,
      options.contentType,
    );

    const fileRecord = await this.fileRecordsService.create({
      ownerId: options.ownerId,
      entityType: options.entityType,
      entityId: options.entityId,
      key,
      originalName: options.originalName || 'unknown',
      contentType: options.contentType,
      size: 0,
      visibility: options.visibility || FileVisibility.PRIVATE,
    });

    const uploadUrl = await this.getPresignedUploadUrl(
      key,
      options.contentType,
      3600,
    );

    return {
      fileId: fileRecord.id.toString(),
      key,
      uploadUrl,
      contentType: options.contentType,
    };
  }

  async confirmUpload(fileId: number, size?: number): Promise<FileRecord> {
    const fileRecord = await this.fileRecordsService.findOne(fileId);

    const url = this.getPublicUrl(fileRecord.key);

    return this.fileRecordsService.markAsReady(fileId, { url, size });
  }

  async cancelUpload(fileId: number): Promise<void> {
    const fileRecord = await this.fileRecordsService.findOne(fileId);

    await this.deleteFile(fileRecord.key).catch(() => {});

    await this.fileRecordsService.delete(fileId);
  }
}
