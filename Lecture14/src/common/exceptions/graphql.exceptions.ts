import { GraphQLError } from 'graphql';

export class NotFoundError extends GraphQLError {
  constructor(resource: string, id: number | string) {
    super(`${resource} with ID ${id} not found`, {
      extensions: { code: 'NOT_FOUND' },
    });
  }
}

export class ValidationError extends GraphQLError {
  constructor(message: string, field?: string) {
    super(message, {
      extensions: {
        code: 'VALIDATION_ERROR',
        ...(field && { field }),
      },
    });
  }
}

export class DatabaseError extends GraphQLError {
  constructor(operation: string) {
    super(`Database error during ${operation}`, {
      extensions: { code: 'DATABASE_ERROR' },
    });
  }
}

