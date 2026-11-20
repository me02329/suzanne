import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { withSoftDelete } from './prismaSoftDelete.js';

// Prisma 7 connects through a driver adapter rather than a bundled query
// engine: the connection string lives here (and in prisma.config.ts for the
// migrate CLI) instead of the schema's datasource block.
//
// Pool volontairement petit : l'app sert un foyer (quelques utilisateurs),
// et chaque connexion Postgres ouverte coûte ~5-10 Mo côté serveur. `max`
// est un plafond, pas un plancher — le pool n'ouvre des connexions qu'à la
// demande, donc au repos il n'y en a qu'une. 5 absorbe plusieurs dashboards
// simultanés ; surchargeable via DATABASE_POOL_MAX pour un usage plus chargé.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
});

// Client de base, NON filtré : à n'utiliser que pour la corbeille (lister /
// restaurer / purger les transactions supprimées) et les écritures système
// (journal d'audit, sauvegardes).
export const prismaBase = new PrismaClient({ adapter });

// Client applicatif : transactions de la corbeille exclues des lectures
// (extension partagée avec le mode local, voir prismaSoftDelete.ts).
export const prisma = withSoftDelete(prismaBase);
