import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

// Client applicatif : une extension exclut automatiquement les transactions
// soft-deleted (deleted_at != null) de TOUTES les lectures, sans avoir à ajouter
// le filtre dans chaque requête. Les écritures ne sont pas filtrées — le
// soft-delete et la restauration passent par prismaBase.
export const prisma = prismaBase.$extends({
  query: {
    transaction: {
      async findMany({ args, query }) { args.where = { ...args.where, deleted_at: null }; return query(args); },
      async findFirst({ args, query }) { args.where = { ...args.where, deleted_at: null }; return query(args); },
      async count({ args, query }) { args.where = { ...args.where, deleted_at: null }; return query(args); },
      async aggregate({ args, query }) { args.where = { ...args.where, deleted_at: null }; return query(args); },
      async groupBy({ args, query }) { args.where = { ...args.where, deleted_at: null }; return query(args); },
    },
  },
});
