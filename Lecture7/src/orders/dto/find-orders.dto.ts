import { Order, OrderStatus } from '../../entities/order.entity';

export interface FindOrdersFilterDto {
  status?: OrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface FindOrdersPaginationDto {
  first?: number;
  after?: string;
  before?: string;
}

export interface FindOrdersDto {
  filter?: FindOrdersFilterDto;
  pagination?: FindOrdersPaginationDto;
}

export interface FindOrdersResult {
  data: Order[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export const encodeCursor = (id: number, createdAt: Date): string => {
  return Buffer.from(`${id}|${createdAt.toISOString()}`).toString('base64');
};

export const decodeCursor = (cursor: string): { id: number; createdAt: Date } | null => {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const pipeIndex = decoded.indexOf('|');
    if (pipeIndex === -1) {
      return null;
    }
    const idStr = decoded.slice(0, pipeIndex);
    const dateStr = decoded.slice(pipeIndex + 1);
    const id = parseInt(idStr, 10);
    const createdAt = new Date(dateStr);

    if (isNaN(id) || isNaN(createdAt.getTime())) {
      return null;
    }

    return { id, createdAt };
  } catch {
    return null;
  }
};
