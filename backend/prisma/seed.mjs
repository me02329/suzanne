import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  ['Courses', 'expense', '#22c55e', 'shopping-cart'],
  ['Logement', 'expense', '#f97316', 'home'],
  ['Transport', 'expense', '#06b6d4', 'car'],
  ['Loisirs', 'expense', '#a855f7', 'gamepad-2'],
  ['Santé', 'expense', '#ef4444', 'heart-pulse'],
  ['Salaire', 'income', '#16a34a', 'wallet'],
  ['Remboursement', 'income', '#0ea5e9', 'refresh-cw'],
];

async function main() {
  const user = await prisma.user.upsert({
    where: { name: 'Démo' },
    update: {},
    create: { name: 'Démo' },
  });

  await prisma.account.upsert({
    where: { user_id_name: { user_id: user.id, name: 'Compte courant' } },
    update: {},
    create: {
      user_id: user.id,
      name: 'Compte courant',
      type: 'checking',
      currency: 'EUR',
      initial_balance: 0,
      initial_balance_date: new Date('2026-01-01T00:00:00.000Z'),
    },
  });

  for (const [name, type, color, icon] of categories) {
    await prisma.category.upsert({
      where: { user_id_name_type: { user_id: user.id, name, type } },
      update: { color, icon },
      create: { user_id: user.id, name, type, color, icon },
    });
  }

  console.log('[seed] ensured Démo, default account and categories');
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
