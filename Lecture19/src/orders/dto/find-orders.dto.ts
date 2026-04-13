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

export const encodeCursor = (
  orderRecordId: number,
  createdAt: Date,
): string => {
  return Buffer.from(`${orderRecordId}|${createdAt.toISOString()}`).toString(
    'base64',
  );
};

export const decodeCursor = (
  cursor: string,
): { orderRecordId: number; createdAt: Date } | null => {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const pipeIndex = decoded.indexOf('|');
    if (pipeIndex === -1) {
      return null;
    }
    const orderRecordIdString = decoded.slice(0, pipeIndex);
    const dateStr = decoded.slice(pipeIndex + 1);
    const orderRecordId = parseInt(orderRecordIdString, 10);
    const createdAt = new Date(dateStr);

    if (isNaN(orderRecordId) || isNaN(createdAt.getTime())) {
      return null;
    }

    return { orderRecordId, createdAt };
  } catch {
    return null;
  }
};
