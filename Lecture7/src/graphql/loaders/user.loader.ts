import * as DataLoader from 'dataloader';
import { Injectable, Scope } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { User } from '../../entities/user.entity';

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  private readonly loader: DataLoader<number, User | null>;

  constructor(private readonly usersService: UsersService) {
    this.loader = new DataLoader<number, User | null>(
      async (userIds: readonly number[]) => {
        const users = await this.usersService.findByIds([...userIds]);

        const userMap = new Map<number, User>();
        for (const user of users) {
          userMap.set(user.id, user);
        }

        return userIds.map((id) => userMap.get(id) ?? null);
      },
    );
  }

  load(userId: number): Promise<User | null> {
    return this.loader.load(userId);
  }

  loadMany(userIds: number[]): Promise<(User | Error | null)[]> {
    return this.loader.loadMany(userIds);
  }
}
