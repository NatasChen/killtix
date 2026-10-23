import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

// Shared by the postgres-js (production) and PGlite (tests) drivers.
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function connectPostgres(databaseUrl: string, migrationsDir: string) {
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsDir });
  return { db: db as unknown as DB, close: () => client.end() };
}
