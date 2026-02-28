import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProcessedMessages1708000000000 implements MigrationInterface {
  name = 'CreateProcessedMessages1708000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "processed_messages" (
        "messageId" character varying(255) NOT NULL,
        "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "orderId" integer NOT NULL,
        "handler" character varying(100),
        CONSTRAINT "PK_processed_messages" PRIMARY KEY ("messageId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_messages"`);
  }
}
