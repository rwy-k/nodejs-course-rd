import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductIndexes1707400000000 implements MigrationInterface {
  name = 'AddProductIndexes1707400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category 
      ON products (category)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_is_available 
      ON products ("isAvailable")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_price 
      ON products (price)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_created_at 
      ON products ("createdAt" DESC)
    `);

    await queryRunner.query(`   
      CREATE INDEX IF NOT EXISTS idx_products_category_available_price 
      ON products (category, "isAvailable", price)
    `);

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
      ON products USING GIN (name gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_trgm`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_products_category_available_price`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_price`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_is_available`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_category`);
  }
}
