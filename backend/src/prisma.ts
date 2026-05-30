import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 connects through a driver adapter rather than a bundled query
// engine: the connection string lives here (and in prisma.config.ts for the
// migrate CLI) instead of the schema's datasource block.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
