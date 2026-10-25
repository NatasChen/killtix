import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { DB } from '../db/client.js';
import { brandLogos, LOGO_VARIANTS, type LogoVariant } from '../db/schema.js';
import { ApiError } from '../errors.js';

export const LOGO_MAX_BYTES = 512 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Accepts only a PNG within the size limit: signature, then an IHDR chunk with a non-zero size. */
export function validatePng(bytes: Buffer) {
  const ok =
    bytes.length <= LOGO_MAX_BYTES &&
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.toString('latin1', 12, 16) === 'IHDR' &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0;
  if (!ok) throw new ApiError(400, 'invalid_logo');
}

export async function getLogo(db: DB, variant: LogoVariant) {
  const [row] = await db.select().from(brandLogos).where(eq(brandLogos.variant, variant));
  return row;
}

export async function setLogo(db: DB, variant: LogoVariant, bytes: Buffer, userId: number) {
  validatePng(bytes);
  const value = { data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), updatedBy: userId };
  await db
    .insert(brandLogos)
    .values({ variant, ...value })
    .onConflictDoUpdate({ target: brandLogos.variant, set: { ...value, updatedAt: sql`now()` } });
}

export async function deleteLogo(db: DB, variant: LogoVariant) {
  await db.delete(brandLogos).where(eq(brandLogos.variant, variant));
}

/** Public URLs of the uploaded logos; the hash in `v` changes with every upload so browsers can cache them. */
export async function logoUrls(db: DB) {
  const rows = await db.select({ variant: brandLogos.variant, sha256: brandLogos.sha256 }).from(brandLogos);
  const url = (v: LogoVariant) => {
    const row = rows.find((r) => r.variant === v);
    return row ? `/api/v1/branding/logo/${v}?v=${row.sha256.slice(0, 16)}` : null;
  };
  return Object.fromEntries(LOGO_VARIANTS.map((v) => [v, url(v)])) as Record<LogoVariant, string | null>;
}
