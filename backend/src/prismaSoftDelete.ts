import type { PrismaClient } from '@prisma/client';

// Client applicatif : une extension exclut automatiquement les transactions
// soft-deleted (deleted_at != null) de TOUTES les lectures, sans avoir à ajouter
// le filtre dans chaque requête. Les écritures ne sont pas filtrées — le
// soft-delete et la restauration passent par le client de base.
//
// Partagé par le serveur (prisma.ts) et le mode local (local/prismaLocal.ts) :
// une copie qui divergerait réafficherait silencieusement la corbeille.
export function withSoftDelete(base: PrismaClient) {
  return base.$extends({
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
}
