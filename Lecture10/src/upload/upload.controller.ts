import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Param,
  Delete,
  ParseIntPipe,
  Get,
  Body,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { User, UserRole } from '../entities/user.entity';
import { FileEntityType, FileStatus } from '../entities/file-record.entity';
import { UsersService } from '../users/users.service';
import { ProductsService } from '../products/products.service';
import { FileRecordsService } from '../file-records/file-records.service';
import { PresignRequestDto, CompleteUploadDto } from './dto';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly usersService: UsersService,
    private readonly productsService: ProductsService,
    private readonly fileRecordsService: FileRecordsService,
  ) {}

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    const existingUser = await this.usersService.findOne(user.id);

    if (existingUser.avatarUrl) {
      const oldKey = this.uploadService.extractKeyFromUrl(existingUser.avatarUrl);
      if (oldKey) {
        await this.uploadService.deleteFile(oldKey).catch(() => {});
      }
    }

    const uploaded = await this.uploadService.uploadAvatar(file, user.id, user.id);

    await this.usersService.update(user.id, { avatarUrl: uploaded.url });

    return {
      message: 'Avatar uploaded successfully',
      url: uploaded.url,
      fileRecord: uploaded.fileRecord,
    };
  }

  @Delete('avatar')
  async deleteAvatar(@CurrentUser() user: User) {
    const existingUser = await this.usersService.findOne(user.id);

    if (existingUser.avatarUrl) {
      const key = this.uploadService.extractKeyFromUrl(existingUser.avatarUrl);
      if (key) {
        await this.uploadService.deleteFile(key);
      }
      await this.usersService.update(user.id, { avatarUrl: null });
    }

    return { message: 'Avatar deleted successfully' };
  }

  @Post('product/:productId/image')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Param('productId', ParseIntPipe) productId: number,
    @CurrentUser() user: User,
  ) {
    const product = await this.productsService.findOne(productId);

    if (product.imageUrl) {
      const oldKey = this.uploadService.extractKeyFromUrl(product.imageUrl);
      if (oldKey) {
        await this.uploadService.deleteFile(oldKey).catch(() => {});
      }
    }

    const uploaded = await this.uploadService.uploadProductImage(file, user.id, productId);

    await this.productsService.update(productId, { imageUrl: uploaded.url });

    return {
      message: 'Product image uploaded successfully',
      url: uploaded.url,
      fileRecord: uploaded.fileRecord,
    };
  }

  @Delete('product/:productId/image')
  @Roles(UserRole.ADMIN)
  async deleteProductImage(@Param('productId', ParseIntPipe) productId: number) {
    const product = await this.productsService.findOne(productId);

    if (product.imageUrl) {
      const key = this.uploadService.extractKeyFromUrl(product.imageUrl);
      if (key) {
        await this.uploadService.deleteFile(key);
      }
      await this.productsService.update(productId, { imageUrl: null });
    }

    return { message: 'Product image deleted successfully' };
  }

  @Get('presigned/:key(*)')
  async getPresignedUrl(@Param('key') key: string) {
    const url = await this.uploadService.getSignedUrl(key);
    return { url };
  }

  @Get('files/:fileId/url')
  async getFileUrl(@Param('fileId', ParseIntPipe) fileId: number) {
    return this.uploadService.getFileUrl(fileId);
  }

  @Get('files/user/:userId')
  async getUserFiles(@Param('userId', ParseIntPipe) userId: number) {
    return this.uploadService.getFilesByEntity(FileEntityType.USER, userId);
  }

  @Get('files/product/:productId')
  async getProductFiles(@Param('productId', ParseIntPipe) productId: number) {
    return this.uploadService.getFilesByEntity(FileEntityType.PRODUCT, productId);
  }

  @Post('files/presign')
  async createPresignedUpload(
    @Body() dto: PresignRequestDto,
    @CurrentUser() user: User,
  ) {
    if (dto.entityType === FileEntityType.PRODUCT && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can upload product images');
    }

    if (dto.entityType === FileEntityType.USER && dto.entityId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only upload avatars for yourself');
    }

    return this.uploadService.createPresignedUpload({
      ownerId: user.id,
      entityType: dto.entityType,
      entityId: dto.entityId,
      contentType: dto.contentType,
      originalName: dto.originalName,
      visibility: dto.visibility,
    });
  }

  @Post('files/:fileId/complete')
  async completeUpload(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: User,
  ) {
    const fileRecord = await this.fileRecordsService.findOne(fileId);

    if (fileRecord.ownerId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You do not own this file');
    }

    if (fileRecord.status === FileStatus.READY) {
      throw new BadRequestException('File upload already completed');
    }

    const updatedRecord = await this.uploadService.confirmUpload(fileId, dto.size);

    if (updatedRecord.entityType === FileEntityType.USER) {
      await this.usersService.update(updatedRecord.entityId, {
        avatarUrl: updatedRecord.url,
        avatarFileId: updatedRecord.id,
      });
    } else if (updatedRecord.entityType === FileEntityType.PRODUCT) {
      await this.productsService.update(updatedRecord.entityId, {
        imageUrl: updatedRecord.url,
        imageFileId: updatedRecord.id,
      });
    }

    return {
      message: 'Upload completed successfully',
      fileRecord: updatedRecord,
    };
  }

  @Delete('files/:fileId')
  async cancelUpload(
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: User,
  ) {
    const fileRecord = await this.fileRecordsService.findOne(fileId);

    if (fileRecord.ownerId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You do not own this file');
    }

    await this.uploadService.cancelUpload(fileId);

    return { message: 'Upload cancelled successfully' };
  }
}
