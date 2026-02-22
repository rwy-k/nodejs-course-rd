import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

export class AddFileIdRelations1707800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'avatarFileId',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'products',
      new TableColumn({
        name: 'imageFileId',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.createForeignKey(
      'users',
      new TableForeignKey({
        columnNames: ['avatarFileId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'file_records',
        onDelete: 'SET NULL',
      }),
    );

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

    await queryRunner.dropColumn('users', 'avatarFileId');
    await queryRunner.dropColumn('products', 'imageFileId');
  }
}
