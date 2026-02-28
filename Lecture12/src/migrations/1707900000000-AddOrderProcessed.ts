import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderProcessed1707900000000 implements MigrationInterface {
  name = 'AddOrderProcessed1707900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."orders_status_enum" ADD VALUE IF NOT EXISTS 'processed'
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "processedAt"`);
  }
}
