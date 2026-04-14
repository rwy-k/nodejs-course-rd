export const THROTTLE_WINDOW_MS = 60_000;

export const THROTTLE_GLOBAL_LIMIT = 200;

export const THROTTLE_AUTH_STRICT = {
  default: { limit: 10, ttl: THROTTLE_WINDOW_MS },
} as const;

export const THROTTLE_PAYMENT_STRICT = {
  default: { limit: 15, ttl: THROTTLE_WINDOW_MS },
} as const;

export const THROTTLE_ADMIN_WRITE = {
  default: { limit: 30, ttl: THROTTLE_WINDOW_MS },
} as const;

export const THROTTLE_GRAPHQL_MUTATION = {
  default: { limit: 25, ttl: THROTTLE_WINDOW_MS },
} as const;
