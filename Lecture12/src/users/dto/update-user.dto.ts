export class UpdateUserDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  isActive?: boolean;
  avatarUrl?: string | null;
  avatarFileId?: number | null;
}
