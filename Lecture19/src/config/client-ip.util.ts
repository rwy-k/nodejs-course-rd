type ThrottleRequest = {
  headers?: Record<string, unknown>;
  ip?: string;
  ips?: string[];
};

export function clientIpForThrottle(throttleRequest: ThrottleRequest): string {
  const xForwardedFor = throttleRequest.headers?.['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    const first = xForwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    const first = String(xForwardedFor[0]).split(',')[0]?.trim();
    if (first) return first;
  }
  if (throttleRequest.ips?.length) {
    return throttleRequest.ips[0] ?? 'unknown';
  }
  return throttleRequest.ip ?? 'unknown';
}

export function clientIpTracker(
  throttleRequestLike: Record<string, unknown>,
): string {
  return clientIpForThrottle(throttleRequestLike as ThrottleRequest);
}
