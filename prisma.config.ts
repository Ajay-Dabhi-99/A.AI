import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations use Supabase's direct connection; the pooled DATABASE_URL is
    // for the running API. `prisma generate` needs neither.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
