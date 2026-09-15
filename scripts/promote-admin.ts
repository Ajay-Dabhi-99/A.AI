/**
 * Grants or revokes administrator access (Phase 3). There is deliberately no
 * API for this: only someone with database credentials can create an admin.
 *
 *   pnpm admin:promote you@example.com
 *   pnpm admin:promote you@example.com --revoke
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const email = args
  .find((arg) => !arg.startsWith('--'))
  ?.trim()
  .toLowerCase();

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm admin:promote <email> [--revoke]');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add it to the root .env file.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const role = revoke ? 'USER' : 'ADMIN';
  const { count } = await prisma.user.updateMany({ where: { email }, data: { role } });
  if (count === 0) {
    console.error(`No account found for ${email}. Sign up first, then run this again.`);
    process.exitCode = 1;
  } else {
    console.log(
      revoke ? `${email} is no longer an administrator.` : `${email} is now an administrator.`,
    );
    console.log('Sign out and back in (or refresh) to see the change.');
  }
} finally {
  await prisma.$disconnect();
}
