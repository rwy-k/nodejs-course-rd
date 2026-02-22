import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUserRole1707500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('user', 'admin')
    `);

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'role',
        type: 'user_role_enum',
        default: "'user'",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'role');
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
  }
}
