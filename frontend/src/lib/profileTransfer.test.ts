import { describe, expect, it, vi } from 'vitest';
import type { Backend } from './activeProfile';
import { missingAfterTransfer, stepsFor, transferProfile, type TransferDeps } from './profileTransfer';

const check = (accounts: string[], holdings = 0) => ({
  uids: { accounts, categories: [], transactions: [], tags: [], institutions: [], recurring: [], goals: [] },
  counts: { holdings, bills: 0, budgets: 0, snapshots: 0 },
});

type Route = (init?: RequestInit) => Response;
function fakeDeps(routes: Record<string, Route>) {
  const calls: string[] = [];
  const saved: string[] = [];
  const deps: TransferDeps = {
    fetchFrom: vi.fn(async (backend: Backend, path: string, init?: RequestInit) => {
      const key = `${backend} ${init?.method ?? 'GET'} ${path}`;
      calls.push(key);
      const route = routes[key];
      if (!route) return new Response(JSON.stringify({ error: `inattendu : ${key}` }), { status: 500 });
      return route(init);
    }),
    saveBlob: (_blob, name) => { saved.push(name); },
  };
  return { deps, calls, saved };
}

const ok = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const user = { id: 3, name: 'Élise' };

describe('transferProfile', () => {
  it('déplace : sauvegarde, importe, vérifie, puis seulement supprime', async () => {
    const { deps, calls, saved } = fakeDeps({
      'server POST /api/profiles/import': (init) => {
        const body = JSON.parse(String(init?.body)) as { payload?: unknown };
        return body.payload ? ok({ user: { id: 9 }, created: true }, 201)() : ok({ error: 'invalide' }, 400)();
      },
      'phone GET /api/users/3/export.json': ok({ version: 3, user: { uid: 'u' } }),
      'phone GET /api/users/3/transfer-check': ok(check(['a', 'b'], 2)),
      'server GET /api/users/9/transfer-check': ok(check(['a', 'b', 'c'], 2)),
      'phone DELETE /api/users/3': ok({ ok: true }),
    });
    const result = await transferProfile(deps, { from: 'phone', to: 'server', user, mode: 'move' });
    expect(result).toEqual({ userId: 9, created: true });
    expect(saved[0]).toMatch(/^suzanne-elise-avant-transfert-\d{4}-\d{2}-\d{2}\.json$/);
    expect(calls.at(-1)).toBe('phone DELETE /api/users/3');
  });

  it('ne supprime rien si la destination est incomplète', async () => {
    const { deps, calls } = fakeDeps({
      'phone POST /api/profiles/import': ok({ user: { id: 1 }, created: false }),
      'server GET /api/users/3/export.json': ok({ version: 3 }),
      'server GET /api/users/3/transfer-check': ok(check(['a', 'b'])),
      'phone GET /api/users/1/transfer-check': ok(check(['a'])),
    });
    await expect(transferProfile(deps, { from: 'server', to: 'phone', user, mode: 'move' })).rejects.toThrow(/original est conservé/);
    expect(calls.some((c) => c.includes('DELETE'))).toBe(false);
  });

  it('sauvegarde impossible : ni import ni suppression', async () => {
    const { deps, calls } = fakeDeps({
      'server GET /api/users/3/export.json': ok({ version: 3 }),
    });
    deps.saveBlob = async () => { throw new Error('disque plein'); };
    await expect(transferProfile(deps, { from: 'server', to: 'phone', user, mode: 'move' })).rejects.toThrow(/rien n’a été transféré/);
    expect(calls).toEqual(['server GET /api/users/3/export.json']);
  });

  it('serveur pas à jour : arrêt avant tout export', async () => {
    const { deps, calls } = fakeDeps({
      'server POST /api/profiles/import': ok({ error: 'Route introuvable' }, 404),
    });
    await expect(transferProfile(deps, { from: 'phone', to: 'server', user, mode: 'copy' })).rejects.toThrow(/mets-le à jour/);
    expect(calls).toEqual(['server POST /api/profiles/import']);
  });

  it('repartir de zéro : un profil vide du même nom, l’original intact', async () => {
    const { deps, calls } = fakeDeps({
      'phone POST /api/users': ok({ id: 4, name: 'Élise' }, 201),
    });
    expect(await transferProfile(deps, { from: 'server', to: 'phone', user, mode: 'fresh' })).toEqual({ userId: 4, created: true });
    expect(calls).toEqual(['phone POST /api/users']);
  });
});

describe('missingAfterTransfer / stepsFor', () => {
  it('compte les manques par nature', () => {
    expect(missingAfterTransfer(check(['a', 'b'], 3), check(['a'], 1))).toEqual(['accounts : 1', 'holdings : 2']);
    expect(missingAfterTransfer(check(['a']), check(['a', 'z']))).toEqual([]);
  });
  it('étapes affichées', () => {
    expect(stepsFor('move', 'server')).toEqual(['check', 'export', 'save', 'import', 'verify', 'delete']);
    expect(stepsFor('copy', 'phone')).toEqual(['export', 'import', 'verify']);
  });
});
