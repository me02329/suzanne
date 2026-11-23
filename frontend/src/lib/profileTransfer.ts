// Passage d'un profil entre le serveur et le téléphone (ADR 0012).
// Ordre voulu : rien n'est supprimé tant que la destination n'a pas été
// vérifiée, et une copie de sauvegarde est d'abord rangée sur l'appareil.
import type { Backend } from './activeProfile';

export type TransferMode = 'move' | 'copy' | 'fresh';
export type TransferStep = 'check' | 'export' | 'save' | 'import' | 'verify' | 'delete';

export interface TransferDeps {
  fetchFrom(backend: Backend, path: string, init?: RequestInit): Promise<Response>;
  /** Range la sauvegarde sur l'appareil ; rejette si elle n'a pas pu l'être. */
  saveBlob(blob: Blob, filename: string): Promise<void> | void;
}

export interface TransferRequest {
  from: Backend;
  to: Backend;
  user: { id: number; name: string };
  mode: TransferMode;
  onStep?: (step: TransferStep) => void;
}

export interface TransferResult {
  userId: number;
  /** false : le profil existait déjà à destination, les données y ont été fusionnées. */
  created: boolean;
}

interface TransferCheck {
  uids: Record<string, string[]>;
  counts: Record<string, number>;
}

export class TransferError extends Error {}

/** Étapes réellement parcourues pour un mode donné (pour l'affichage). */
export function stepsFor(mode: TransferMode, to: Backend): TransferStep[] {
  const check: TransferStep[] = to === 'server' ? ['check'] : [];
  if (mode === 'fresh') return [...check, 'import'];
  if (mode === 'copy') return [...check, 'export', 'import', 'verify'];
  return [...check, 'export', 'save', 'import', 'verify', 'delete'];
}

async function errorOf(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body?.error) return body.error;
  } catch { /* corps non JSON */ }
  return `Erreur ${response.status}`;
}

async function call<T>(deps: TransferDeps, backend: Backend, path: string, init?: RequestInit): Promise<T> {
  const response = await deps.fetchFrom(backend, path, init);
  if (!response.ok) throw new TransferError(await errorOf(response));
  return await response.json() as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Ce qui manque à destination (vide si tout y est). */
export function missingAfterTransfer(source: TransferCheck, destination: TransferCheck): string[] {
  const missing: string[] = [];
  for (const [kind, uids] of Object.entries(source.uids)) {
    const there = new Set(destination.uids[kind] ?? []);
    const absent = uids.filter((uid) => !there.has(uid)).length;
    if (absent > 0) missing.push(`${kind} : ${absent}`);
  }
  for (const [kind, count] of Object.entries(source.counts)) {
    const there = destination.counts[kind] ?? 0;
    if (there < count) missing.push(`${kind} : ${count - there}`);
  }
  return missing;
}

function backupName(name: string): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'profil';
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `suzanne-${slug}-avant-transfert-${day}.json`;
}

export async function transferProfile(deps: TransferDeps, req: TransferRequest): Promise<TransferResult> {
  const { from, to, user, mode } = req;
  const step = (s: TransferStep) => req.onStep?.(s);
  if (from === to) throw new TransferError('Le profil est déjà de ce côté.');

  if (to === 'server') {
    // Serveur pas encore mis à jour : on s'arrête avant d'avoir rien touché.
    step('check');
    const probe = await deps.fetchFrom('server', '/api/profiles/import', json({}));
    if (probe.status === 404) {
      throw new TransferError('Ton serveur ne sait pas encore recevoir un profil : mets-le à jour, puis réessaie.');
    }
    if (probe.status === 401) throw new TransferError(await errorOf(probe));
  }

  if (mode === 'fresh') {
    step('import');
    const created = await call<{ id: number }>(deps, to, '/api/users', json({ name: user.name }));
    return { userId: created.id, created: true };
  }

  step('export');
  const exported = await deps.fetchFrom(from, `/api/users/${user.id}/export.json`);
  if (!exported.ok) throw new TransferError(await errorOf(exported));
  const text = await exported.text();

  if (mode === 'move') {
    step('save');
    try {
      await deps.saveBlob(new Blob([text], { type: 'application/json' }), backupName(user.name));
    } catch (error) {
      throw new TransferError(`Sauvegarde dans Téléchargements impossible (${(error as Error).message}) : rien n’a été transféré.`);
    }
  }

  step('import');
  // Corps construit autour du texte exporté, sans le décoder puis le réencoder :
  // un gros profil n'existe ainsi qu'en un exemplaire de plus en mémoire.
  const imported = await call<{ user: { id: number }; created: boolean }>(deps, to, '/api/profiles/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: `{"payload":${text}}`,
  });

  step('verify');
  const [source, destination] = await Promise.all([
    call<TransferCheck>(deps, from, `/api/users/${user.id}/transfer-check`),
    call<TransferCheck>(deps, to, `/api/users/${imported.user.id}/transfer-check`),
  ]);
  const missing = missingAfterTransfer(source, destination);
  if (missing.length > 0) {
    throw new TransferError(`Vérification : il manque des données à destination (${missing.join(', ')}). L’original est conservé.`);
  }

  if (mode === 'move') {
    step('delete');
    const removed = await deps.fetchFrom(from, `/api/users/${user.id}`, { method: 'DELETE' });
    if (!removed.ok) throw new TransferError(`Copie réussie, mais l’original n’a pas pu être retiré : ${await errorOf(removed)}`);
  }
  return { userId: imported.user.id, created: imported.created };
}
