import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const hashPassword = (password: string, cost: number) => bcrypt.hash(password, cost);

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** Generates a password that always satisfies the password policy. */
export function randomPassword(length = 20): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'];
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface PasswordPolicy {
  minLength: number;
}

/** Returns the violated rule codes (empty when the password is acceptable). */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy): string[] {
  const violations: string[] = [];
  if (password.length < policy.minLength) violations.push('min_length');
  if (!/[A-Z]/.test(password)) violations.push('uppercase');
  if (!/[a-z]/.test(password)) violations.push('lowercase');
  if (!/[0-9]/.test(password)) violations.push('digit');
  if (!/[^A-Za-z0-9]/.test(password)) violations.push('symbol');
  if (password.length > 128) violations.push('max_length');
  return violations;
}

/** AES-256-GCM encryption for secrets stored at rest (e.g. TOTP seeds). */
export function createSecretBox(appSecret: string) {
  const key = createHash('sha256').update(`ticketdesk:secretbox:${appSecret}`).digest();
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
    },
    decrypt(boxed: string): string {
      const [iv, tag, data] = boxed.split('.').map((p) => Buffer.from(p, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}
export type SecretBox = ReturnType<typeof createSecretBox>;
