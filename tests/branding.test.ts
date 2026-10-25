import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES } from '../src/server/services/branding.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

// Smallest valid PNG: 1x1 transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (client: Awaited<ReturnType<TestContext['adminClient']>>, variant: string, bytes: Buffer) =>
  client.raw('PUT', `/api/v1/admin/branding/logo/${variant}`, { data: bytes.toString('base64') });

describe('company logo', () => {
  it('is public: anonymous visitors see no logo before one is uploaded', async () => {
    const res = await ctx.client().get('/api/v1/branding');
    expect(res.status).toBe(200);
    expect(res.body.logo).toEqual({ light: null, dark: null });
    expect((await ctx.client().get('/api/v1/branding/logo/light')).status).toBe(404);
  });

  it('can only be changed by system administrators', async () => {
    await ctx.createUser('logo-manager@example.com', 'it_manager');
    const manager = await ctx.login('logo-manager@example.com');
    expect((await upload(manager, 'light', PNG)).status).toBe(403);
    expect((await manager.del('/api/v1/admin/branding/logo/light')).status).toBe(403);
  });

  it('rejects files that are not PNG or are over the size limit', async () => {
    const admin = await ctx.adminClient();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const tooBig = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]);
    for (const bytes of [svg, tooBig, PNG.subarray(0, 16)]) {
      const res = await upload(admin, 'light', bytes);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_logo');
    }
    expect((await admin.raw('PUT', '/api/v1/admin/branding/logo/light', { data: 'not base64!' })).body.code).toBe('invalid_logo');
    expect((await upload(admin, 'favicon', PNG)).status).toBe(400);
  });

  it('serves the uploaded PNG to anyone, cacheable by its versioned URL', async () => {
    const admin = await ctx.adminClient();
    const res = await upload(admin, 'light', PNG);
    expect(res.status).toBe(200);
    expect(res.body.logo.dark).toBeNull();
    const url: string = res.body.logo.light;
    expect(url).toMatch(/^\/api\/v1\/branding\/logo\/light\?v=[0-9a-f]{16}$/);

    const img = await ctx.app.request(url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    const again = await ctx.app.request(url, { headers: { 'if-none-match': img.headers.get('etag')! } });
    expect(again.status).toBe(304);
  });

  it('removes a logo', async () => {
    const admin = await ctx.adminClient();
    await upload(admin, 'dark', PNG);
    const res = await admin.del('/api/v1/admin/branding/logo/dark');
    expect(res.status).toBe(200);
    expect(res.body.logo.dark).toBeNull();
    expect((await ctx.client().get('/api/v1/branding/logo/dark')).status).toBe(404);
  });
});
