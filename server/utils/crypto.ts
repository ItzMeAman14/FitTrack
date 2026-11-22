import crypto from 'crypto';
import { AppError } from './error.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const expected = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function resolveSecretEncryptionKey(): Buffer {
  const material =
    process.env.AI_KEY_ENCRYPTION_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim();

  if (!material) {
    throw new AppError(
      'Server encryption secret is not configured. Set AI_KEY_ENCRYPTION_SECRET or DATABASE_URL.',
      503
    );
  }

  return crypto.createHmac('sha256', material).update('fittrack-user-ai-key-v1').digest();
}

export function encryptSecret(plaintext: string): string {
  const key = resolveSecretEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new AppError('Saved API key format is invalid. Please re-add this model.', 500);
  }
  const [, ivHex, tagHex, dataHex] = parts;
  try {
    const key = resolveSecretEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new AppError(
      'Unable to decrypt saved API key. Please delete and re-add this model in AI Coach.',
      500
    );
  }
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

