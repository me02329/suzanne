import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires a driver adapter at runtime (see src/prisma.ts).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const categories = [
  ['Courses', 'expense', '#22c55e', 'shopping-cart'],
  ['Restaurants', 'expense', '#f59e0b', 'utensils'],
  ['Logement', 'expense', '#f97316', 'home'],
  ['Énergie', 'expense', '#eab308', 'plug'],
  ['Internet & téléphone', 'expense', '#2563eb', 'wifi'],
  ['Assurances', 'expense', '#7c3aed', 'shield-check'],
  ['Transport', 'expense', '#06b6d4', 'car'],
  ['Carburant', 'expense', '#0891b2', 'fuel'],
  ['Abonnements', 'expense', '#6366f1', 'repeat'],
  ['Informatique', 'expense', '#0ea5e9', 'monitor'],
  ['Logiciels & services', 'expense', '#4f46e5', 'cloud'],
  ['Loisirs', 'expense', '#a855f7', 'gamepad-2'],
  ['Culture', 'expense', '#8b5cf6', 'book-open'],
  ['Sport', 'expense', '#16a34a', 'dumbbell'],
  ['Vacances', 'expense', '#14b8a6', 'plane'],
  ['Shopping', 'expense', '#ec4899', 'shopping-bag'],
  ['Vêtements', 'expense', '#db2777', 'shirt'],
  ['Beauté', 'expense', '#f472b6', 'sparkles'],
  ['Santé', 'expense', '#ef4444', 'heart-pulse'],
  ['Animaux', 'expense', '#84cc16', 'paw-print'],
  ['Impôts & taxes', 'expense', '#64748b', 'receipt'],
  ['Frais bancaires', 'expense', '#475569', 'landmark'],
  ['Frais professionnels', 'expense', '#334155', 'briefcase'],
  ['Cadeaux', 'expense', '#d946ef', 'gift'],
  ['Dons', 'expense', '#be123c', 'hand-heart'],
  ['Éducation', 'expense', '#0f766e', 'graduation-cap'],
  ['Maison', 'expense', '#a16207', 'hammer'],
  ['Retraits espèces', 'expense', '#78716c', 'banknote'],
  ['Divers', 'expense', '#9ca3af', 'circle-ellipsis'],
  ['Salaire', 'income', '#16a34a', 'wallet'],
  ['Prime', 'income', '#65a30d', 'badge-euro'],
  ['Freelance', 'income', '#059669', 'briefcase-business'],
  ['Remboursement', 'income', '#0ea5e9', 'refresh-cw'],
  ['Aides', 'income', '#0284c7', 'hand-coins'],
  ['Intérêts', 'income', '#7c3aed', 'percent'],
  ['Vente occasion', 'income', '#db2777', 'tag'],
  ['Cadeau reçu', 'income', '#f43f5e', 'gift'],
  ['Autre revenu', 'income', '#64748b', 'plus-circle'],
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
