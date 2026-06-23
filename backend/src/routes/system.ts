import { Router } from 'express';
import { prismaBase } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createBackupSchema, idParam } from '../lib/validation.js';
import { buildExportPayload, EXPORT_ENTITIES, importPayload } from './import_export.js';

export const systemRouter = Router();

// Combien de sauvegardes automatiques on conserve (rotation par utilisateur).
const AUTO_BACKUP_KEEP = 14;

const BACKUP_META = { id: true, user_id: true, label: true, size: true, auto: true, created_at: true } as const;

// --- Journal d'audit -------------------------------------------------------
systemRouter.get('/users/:user_id/audit-log', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prismaBase.auditLog.findMany({
    where: { user_id },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
  res.json(rows);
}));

// --- Sauvegardes -----------------------------------------------------------
// Crée un snapshot JSON complet de l'utilisateur, stocké en base. Partagé par
// la création manuelle et la rotation automatique.
export async function createBackup(user_id: number, label: string, auto: boolean) {
  const payload = await buildExportPayload(user_id, [...EXPORT_ENTITIES], null, null);
  const data = Buffer.from(JSON.stringify(payload));
  const backup = await prismaBase.backup.create({
    data: { user_id, label, size: data.length, auto, data },
    select: BACKUP_META,
  });
  if (auto) {
    // Rotation : ne garder que les N dernières sauvegardes auto.
    const old = await prismaBase.backup.findMany({
      where: { user_id, auto: true },
      orderBy: { created_at: 'desc' },
      skip: AUTO_BACKUP_KEEP,
      select: { id: true },
    });
    if (old.length > 0) await prismaBase.backup.deleteMany({ where: { id: { in: old.map((b) => b.id) } } });
  }
  return backup;
}

systemRouter.get('/users/:user_id/backups', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prismaBase.backup.findMany({ where: { user_id }, orderBy: { created_at: 'desc' }, select: BACKUP_META }));
}));

systemRouter.post('/users/:user_id/backups', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createBackupSchema.parse(req.body);
  const label = body.label?.trim() || `Sauvegarde manuelle du ${new Date().toLocaleDateString('fr-FR')}`;
  res.status(201).json(await createBackup(user_id, label, false));
}));

systemRouter.get('/users/:user_id/backups/:id/download', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const backup = await prismaBase.backup.findFirst({ where: { id, user_id } });
  if (!backup) { res.status(404).json({ error: 'Sauvegarde introuvable' }); return; }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="suzanne-backup-${id}.json"`);
  res.send(Buffer.from(backup.data));
}));

// Restaure une sauvegarde via le même pipeline que l'import JSON (réutilise les
// entités existantes ; n'écrase pas, complète).
systemRouter.post('/users/:user_id/backups/:id/restore', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const backup = await prismaBase.backup.findFirst({ where: { id, user_id } });
  if (!backup) { res.status(404).json({ error: 'Sauvegarde introuvable' }); return; }
  const payload = JSON.parse(Buffer.from(backup.data).toString());
  res.json(await importPayload(user_id, payload));
}));

systemRouter.delete('/users/:user_id/backups/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.backup.deleteMany({ where: { id, user_id } });
  if (result.count === 0) { res.status(404).json({ error: 'Sauvegarde introuvable' }); return; }
  res.json({ deleted: true });
}));
