/**
 * Operator commands, run inside the app container:
 *   docker compose exec app node dist/server/cli.js reset-password <email>
 */
import { eq } from 'drizzle-orm';
import { hashPassword, randomPassword } from './auth/crypto.js';
import { loadConfig } from './config.js';
import { connectPostgres } from './db/client.js';
import { sessions, users } from './db/schema.js';

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command !== 'reset-password' || !arg) {
    console.error('usage: node dist/server/cli.js reset-password <email>');
    process.exit(2);
  }
  const config = loadConfig();
  const { db, close } = await connectPostgres(config.databaseUrl, config.migrationsDir);
  try {
    const email = arg.toLowerCase();
    const password = randomPassword();
    const [user] = await db
      .update(users)
      .set({
        passwordHash: await hashPassword(password, config.bcryptCost),
        mustChangePassword: true,
        isActive: true,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.email, email))
      .returning();
    if (!user) {
      console.error(`no user with e-mail ${email}`);
      process.exitCode = 1;
      return;
    }
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    console.log(`Temporary password for ${email}: ${password}\nIt must be changed at the next login.`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
