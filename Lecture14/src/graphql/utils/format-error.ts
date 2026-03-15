import { GraphQLFormattedError, GraphQLError } from 'graphql';
import { Logger } from '@nestjs/common';

const logger = new Logger('GraphQL');

export function formatGraphQLError(error: GraphQLError): GraphQLFormattedError {
  const code = error.extensions?.code as string;
  const originalError = error.extensions?.originalError as {
    message?: string | string[];
  };

  if (code === 'BAD_REQUEST' && originalError?.message) {
    const messages = Array.isArray(originalError.message)
      ? originalError.message
      : [originalError.message];
    return {
      message: messages.join('; '),
      extensions: { code: 'VALIDATION_ERROR' },
    };
  }

  if (code === 'GRAPHQL_VALIDATION_FAILED') {
    return {
      message: error.message,
      extensions: { code: 'VALIDATION_ERROR' },
    };
  }

  if (code === 'NOT_FOUND' || code === 'DATABASE_ERROR') {
    if (code === 'DATABASE_ERROR') {
      logger.error(`DATABASE_ERROR: ${error.message}`);
    }
    return {
      message: error.message,
      extensions: { code },
    };
  }

  if (code === 'INTERNAL_SERVER_ERROR') {
    logger.error(`INTERNAL_SERVER_ERROR: ${error.message}`);
    return {
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    };
  }

  return {
    message: error.message,
    extensions: { code: code || 'UNKNOWN_ERROR' },
  };
}

