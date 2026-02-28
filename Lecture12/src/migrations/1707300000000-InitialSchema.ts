import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1707300000000 implements MigrationInterface {
  name = 'InitialSchema1707300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "firstName" character varying(100) NOT NULL,
        "lastName" character varying(100) NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "role" "public"."users_role_enum" NOT NULL DEFAULT 'user',
        "isActive" boolean NOT NULL DEFAULT true,
        "avatarUrl" character varying,
        "avatarFileId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" SERIAL NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "price" numeric(10,2) NOT NULL,
        "stock" integer NOT NULL DEFAULT 0,
        "category" character varying(100),
        "isAvailable" boolean NOT NULL DEFAULT true,
        "imageUrl" character varying,
        "imageFileId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."orders_status_enum" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled')
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" SERIAL NOT NULL,
        "idempotencyKey" character varying(255),
        "status" "public"."orders_status_enum" NOT NULL DEFAULT 'pending',
        "totalAmount" numeric(10,2) NOT NULL DEFAULT 0,
        "shippingAddress" text,
        "userId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orders_idempotency_key" UNIQUE ("idempotencyKey"),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" SERIAL NOT NULL,
        "quantity" integer NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "orderId" integer,
        "productId" integer,
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "orders" 
      ADD CONSTRAINT "FK_orders_userId" 
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items" 
      ADD CONSTRAINT "FK_order_items_orderId" 
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items" 
      ADD CONSTRAINT "FK_order_items_productId" 
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_order_items_productId"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_order_items_orderId"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_orders_userId"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
