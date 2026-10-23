import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { sha256 } from './crypto.js';

const ISSUER = 'TicketDesk';

export const generateTotpSecret = () => new OTPAuth.Secret({ size: 20 }).base32;

const totpFor = (secret: string, label = '') =>
  new OTPAuth.TOTP({ issuer: ISSUER, label, secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });

export const totpUri = (secret: string, email: string) => totpFor(secret, email).toString();

export function verifyTotp(secret: string, token: string, now: Date): boolean {
  const cleaned = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  return totpFor(secret).validate({ token: cleaned, timestamp: now.getTime(), window: 1 }) !== null;
}

/** For tests: the current code of a secret. */
export const currentTotp = (secret: string, now: Date) => totpFor(secret).generate({ timestamp: now.getTime() });

export function generateRecoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: count }, () => {
    const hex = randomBytes(5).toString('hex');
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

export const hashRecoveryCode = (code: string) => sha256(code.trim().toLowerCase());
