import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 connects through a driver adapter rather than a bundled query
// engine: the connection string lives here (and in prisma.config.ts for the
// migrate CLI) instead of the schema's datasource block.
//
// Pool volontairement petit : l'app est mono-utilisateur et chaque connexion
// Postgres coûte ~5-10 Mo côté serveur. 3 connexions suffisent largement
// (Express traite les requêtes vite et le pool fait la file d'attente).
// Surchargeable via DATABASE_POOL_MAX pour un usage plus chargé.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 3),
});

export const prisma = new PrismaClient({ adapter });
