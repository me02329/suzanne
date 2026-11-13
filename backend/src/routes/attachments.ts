import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { ATTACHMENT_MIME_TYPES, createAttachmentSchema, idParam } from '../lib/validation.js';

export const attachmentsRouter = Router();

const META_SELECT = { id: true, transaction_id: true, filename: true, mime_type: true, size: true, created_at: true } as const;

// Pièces jointes d'une transaction (métadonnées seules, sans le binaire).
attachmentsRouter.get('/users/:user_id/transactions/:tx_id/attachments', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const tx_id = idParam.parse(req.params.tx_id);
  const transaction = await prisma.transaction.findFirst({ where: { id: tx_id, user_id }, select: { id: true } });
  if (!transaction) { res.status(404).json({ error: 'Transaction introuvable' }); return; }
  res.json(await prisma.attachment.findMany({ where: { user_id, transaction_id: tx_id }, select: META_SELECT, orderBy: { id: 'desc' } }));
}));

attachmentsRouter.post('/users/:user_id/transactions/:tx_id/attachments', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const tx_id = idParam.parse(req.params.tx_id);
  const body = createAttachmentSchema.parse(req.body);
  const transaction = await prisma.transaction.findFirst({ where: { id: tx_id, user_id }, select: { id: true } });
  if (!transaction) { res.status(404).json({ error: 'Transaction introuvable' }); return; }

  const data = Buffer.from(body.data_base64, 'base64');
  const row = await prisma.attachment.create({
    data: { user_id, transaction_id: tx_id, filename: body.filename, mime_type: body.mime_type, size: data.length, data },
    select: META_SELECT,
  });
  res.status(201).json(row);
}));

// Téléchargement : renvoie le binaire avec son type, toujours en pièce jointe
// et sans reniflage MIME (`nosniff`) — un fichier ne peut pas s'exécuter
// comme page HTML sur l'origine de l'app. Le nom de fichier est conservé.
attachmentsRouter.get('/users/:user_id/attachments/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const attachment = await prisma.attachment.findFirst({ where: { id, user_id } });
  if (!attachment) { res.status(404).json({ error: 'Pièce jointe introuvable' }); return; }
  // Type d'une pièce antérieure à la liste fermée : servi en binaire opaque.
  const mime = (ATTACHMENT_MIME_TYPES as readonly string[]).includes(attachment.mime_type) ? attachment.mime_type : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.send(Buffer.from(attachment.data));
}));

attachmentsRouter.delete('/users/:user_id/attachments/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.attachment.deleteMany({ where: { id, user_id } });
  if (result.count === 0) { res.status(404).json({ error: 'Pièce jointe introuvable' }); return; }
  res.json({ deleted: true });
}));
