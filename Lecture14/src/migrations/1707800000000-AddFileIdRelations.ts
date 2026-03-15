import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AddFileIdRelations1707800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasAvatarFileId = await queryRunner.hasColumn('users', 'avatarFileId');
    if (!hasAvatarFileId) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'avatarFileId',
          type: 'int',
          isNullable: true,
        }),
      );
    }

    const hasImageFileId = await queryRunner.hasColumn('products', 'imageFileId');
    if (!hasImageFileId) {
      await queryRunner.addColumn(
        'products',
        new TableColumn({
          name: 'imageFileId',
          type: 'int',
          isNullable: true,
        }),
      );
    }

    const usersTable = await queryRunner.getTable('users');
    const hasUsersFk = usersTable?.foreignKeys.some(
      (fk) => fk.columnNames.includes('avatarFileId'),
    );
    if (!hasUsersFk) {
      await queryRunner.createForeignKey(
        'users',
        new TableForeignKey({
          columnNames: ['avatarFileId'],
          referencedColumnNames: ['id'],
          referencedTableName: 'file_records',
          onDelete: 'SET NULL',
        }),
      );
    }

    const productsTable = await queryRunner.getTable('products');
    const hasProductsFk = productsTable?.foreignKeys.some(
      (fk) => fk.columnNames.includes('imageFileId'),
    );
    if (!hasProductsFk) {
      await queryRunner.createForeignKey(
        'products',
        new TableForeignKey({
          columnNames: ['imageFileId'],
          referencedColumnNames: ['id'],
          referencedTableName: 'file_records',
          onDelete: 'SET NULL',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');
    const productsTable = await queryRunner.getTable('products');

    if (usersTable) {
      const foreignKey = usersTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('avatarFileId') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('users', foreignKey);
      }
    }

    if (productsTable) {
      const foreignKey = productsTable.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('imageFileId') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('products', foreignKey);
      }
    }

    const hasAvatarFileId = await queryRunner.hasColumn('users', 'avatarFileId');
    if (hasAvatarFileId) {
      await queryRunner.dropColumn('users', 'avatarFileId');
    }

    const hasImageFileId = await queryRunner.hasColumn('products', 'imageFileId');
    if (hasImageFileId) {
      await queryRunner.dropColumn('products', 'imageFileId');
    }
  }
}
