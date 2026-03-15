import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileRecord } from '../entities/file-record.entity';
import { FileRecordsService } from './file-records.service';

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord])],
  providers: [FileRecordsService],
  exports: [FileRecordsService],
})
export class FileRecordsModule {}
