import { Router } from 'express';
import { z } from 'zod';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';
import { backupPayloadSchema, importPayload } from '../lib/backup.js';

// Passage d'un profil entre le serveur et le téléphone (ADR 0012).
//
// POST /profiles/import : importe une sauvegarde v3 dans le profil désigné par
//   son uid (payload.user.uid) — fusion sans doublons s'il existe, création sinon
//   (sans compte ni catégories par défaut, qui entreraient en collision).
// GET /users/:id/transfer-check : ce qu'il faut pour vérifier un transfert —
//   les uid des éléments que l'import conserve, et les nombres des autres.
export const profileTransferRouter = Router();

const importBody = z.object({ payload: backupPayloadSchema });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Profil vide : rien d'autre que ce qu'un profil reçoit à sa création. */
async function isEmptyProfile(user_id: number): Promise<boolean> {
  const [transactions, holdings, snapshots, goals, recurring, budgets] = await Promise.all([
    prismaBase.transaction.count({ where: { user_id } }),
    prismaBase.holding.count({ where: { user_id } }),
    prismaBase.accountSnapshot.count({ where: { user_id } }),
    prismaBase.savingsGoal.count({ where: { user_id } }),
    prismaBase.recurringTransaction.count({ where: { user_id } }),
    prismaBase.budget.count({ where: { user_id } }),
  ]);
  return transactions + holdings + snapshots + goals + recurring + budgets === 0;
}

/** Nom libre : « Moi », sinon « Moi (2) », « Moi (3) »… */
async function freeName(base: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base} (${n})`;
    if (!(await prismaBase.user.findUnique({ where: { name: candidate }, select: { id: true } }))) return candidate;
  }
}

profileTransferRouter.post('/profiles/import', asyncHandler(async (req, res) => {
  const { payload } = importBody.parse(req.body);
  const uid = typeof payload.user?.uid === 'string' && UUID_RE.test(payload.user.uid) ? payload.user.uid.toLowerCase() : null;
  if (!uid) throw new HttpError(400, "Sauvegarde sans identifiant de profil : exporte-la depuis une version à jour de Suzanne.");
  const wantedName = (typeof payload.user?.name === 'string' && payload.user.name.trim()) || 'Profil';

  let user = await prismaBase.user.findUnique({ where: { uid } });
  let created = false;
  if (!user) {
    const homonym = await prismaBase.user.findUnique({ where: { name: wantedName } });
    if (homonym && await isEmptyProfile(homonym.id)) {
      // Profil homonyme encore vierge (ex. « Moi » créé à l'installation) : on le
      // reprend en lui donnant l'identité du profil transféré.
      user = await prismaBase.user.update({ where: { id: homonym.id }, data: { uid } });
    } else {
      user = await prismaBase.user.create({ data: { uid, name: await freeName(wantedName) } });
      created = true;
    }
  }
  const summary = await importPayload(user.id, payload);
  res.status(created ? 201 : 200).json({ user: { id: user.id, uid: user.uid, name: user.name }, created, summary });
}));

profileTransferRouter.get('/users/:user_id/transfer-check', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const user = await prisma.user.findUnique({ where: { id: user_id }, select: { uid: true, name: true } });
  if (!user) throw new HttpError(404, 'Profil introuvable');
  const where = { user_id };
  const uids = async (rows: Promise<Array<{ uid: string }>>) => (await rows).map((r) => r.uid).sort();
  const [accounts, categories, transactions, tags, institutions, recurring, goals, holdings, bills, budgets, snapshots] = await Promise.all([
    uids(prisma.account.findMany({ where, select: { uid: true } })),
    uids(prisma.category.findMany({ where, select: { uid: true } })),
    // Comme l'export : opérations hors corbeille, hors mouvements d'espèces dérivés des ordres.
    uids(prisma.transaction.findMany({ where: { user_id, kind: { not: 'trade' } }, select: { uid: true } })),
    uids(prisma.tag.findMany({ where, select: { uid: true } })),
    uids(prisma.institution.findMany({ where, select: { uid: true } })),
    uids(prisma.recurringTransaction.findMany({ where, select: { uid: true } })),
    uids(prisma.savingsGoal.findMany({ where, select: { uid: true } })),
    prisma.holding.count({ where }),
    prisma.bill.count({ where }),
    prisma.budget.count({ where }),
    prisma.accountSnapshot.count({ where }),
  ]);
  res.json({
    user,
    // Éléments dont l'import conserve l'uid : la destination doit tous les contenir.
    uids: { accounts, categories, transactions, tags, institutions, recurring, goals },
    // Les autres : la destination doit en avoir au moins autant.
    counts: { holdings, bills, budgets, snapshots },
  });
}));
