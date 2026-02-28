import { readFileSync, existsSync } from 'fs';

export function getSecret(envVar: string): string | undefined {
  const fileEnvVar = `${envVar}_FILE`;
  const filePath = process.env[fileEnvVar];

  if (filePath && existsSync(filePath)) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      console.warn(`Warning: Could not read secret from ${filePath}`);
    }
  }

  return process.env[envVar];
}

export function loadSecretsFromFiles(): void {
  const secretMappings = [
    'DB_PASSWORD',
    'JWT_SECRET',
    'AWS_SECRET_ACCESS_KEY',
  ];

  for (const envVar of secretMappings) {
    const value = getSecret(envVar);
    if (value && !process.env[envVar]) {
      process.env[envVar] = value;
    }
  }
}
