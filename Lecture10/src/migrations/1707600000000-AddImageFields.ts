import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddImageFields1707600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasAvatarUrl = await queryRunner.hasColumn('users', 'avatarUrl');
    if (!hasAvatarUrl) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'avatarUrl',
          type: 'varchar',
          isNullable: true,
        }),
      );
    }

    const hasImageUrl = await queryRunner.hasColumn('products', 'imageUrl');
    if (!hasImageUrl) {
      await queryRunner.addColumn(
        'products',
        new TableColumn({
          name: 'imageUrl',
          type: 'varchar',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasAvatarUrl = await queryRunner.hasColumn('users', 'avatarUrl');
    if (hasAvatarUrl) {
      await queryRunner.dropColumn('users', 'avatarUrl');
    }

    const hasImageUrl = await queryRunner.hasColumn('products', 'imageUrl');
    if (hasImageUrl) {
      await queryRunner.dropColumn('products', 'imageUrl');
    }
  }
}
