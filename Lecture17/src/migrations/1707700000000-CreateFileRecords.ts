import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateFileRecords1707700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "file_status_enum" AS ENUM ('pending', 'ready');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "file_visibility_enum" AS ENUM ('private', 'public');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "file_entity_type_enum" AS ENUM ('user', 'product');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'file_records',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'ownerId',
            type: 'int',
          },
          {
            name: 'entityType',
            type: 'file_entity_type_enum',
          },
          {
            name: 'entityId',
            type: 'int',
          },
          {
            name: 'key',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'originalName',
            type: 'varchar',
          },
          {
            name: 'contentType',
            type: 'varchar',
          },
          {
            name: 'size',
            type: 'bigint',
          },
          {
            name: 'status',
            type: 'file_status_enum',
            default: "'pending'",
          },
          {
            name: 'visibility',
            type: 'file_visibility_enum',
            default: "'private'",
          },
          {
            name: 'url',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'file_records',
      new TableIndex({
        name: 'idx_file_records_owner',
        columnNames: ['ownerId'],
      }),
    );

    await queryRunner.createIndex(
      'file_records',
      new TableIndex({
        name: 'idx_file_records_entity',
        columnNames: ['entityType', 'entityId'],
      }),
    );

    await queryRunner.createIndex(
      'file_records',
      new TableIndex({
        name: 'idx_file_records_key',
        columnNames: ['key'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'file_records',
      new TableForeignKey({
        columnNames: ['ownerId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('file_records');

    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('ownerId') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('file_records', foreignKey);
      }
    }

    await queryRunner.dropTable('file_records', true);

    await queryRunner.query(`DROP TYPE IF EXISTS "file_entity_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "file_visibility_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "file_status_enum"`);
  }
}
