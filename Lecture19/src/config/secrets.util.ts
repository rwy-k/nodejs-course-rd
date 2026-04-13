import { readFileSync, existsSync } from 'fs';

export function resolveJwtSigningSecret(): string {
  const trimmedJwtSecretFromEnv = process.env.JWT_SECRET?.trim();
  if (trimmedJwtSecretFromEnv) return trimmedJwtSecretFromEnv;
  throw new Error(
    'JWT_SECRET is required in every environment (set env or JWT_SECRET_FILE before bootstrap; see .env.example and docs/SECRETS.md).',
  );
}

export function getSecret(envVar: string): string | undefined {
  const fileEnvVar = `${envVar}_FILE`;
  const filePath = process.env[fileEnvVar];

  if (filePath && existsSync(filePath)) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      console.warn(`Warning: Could not read secret from ${filePath}`);
    }
  }

  return process.env[envVar];
}

export function loadSecretsFromFiles(): void {
  const secretMappings = ['DB_PASSWORD', 'JWT_SECRET', 'AWS_SECRET_ACCESS_KEY'];

  for (const envVar of secretMappings) {
    const value = getSecret(envVar);
    if (value && !process.env[envVar]) {
      process.env[envVar] = value;
    }
  }
}
