import { afterAll, beforeAll, beforeEach } from 'vitest';
import { prisma } from '../prisma';

// Tables in an order that doesn't matter thanks to CASCADE; RESTART IDENTITY
// keeps auto-increment ids predictable across tests.
const TABLES = [
  'transaction_tags',
  'transactions',
  'account_snapshots',
  'budgets',
  'recurring_transactions',
  'savings_goals',
  'category_rules',
  'categories',
  'tags',
  'accounts',
  'institutions',
  'settings',
  'users',
];

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error('Integration tests require DATABASE_URL pointing at a throwaway Postgres.');
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
