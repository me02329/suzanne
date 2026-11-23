import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prismaBase as db } from '../prisma';
import { EXPORT_ENTITIES } from '../lib/backup';

// Passage d'un profil entre le serveur et le téléphone (ADR 0012) : export →
// import dans le profil désigné par son uid → vérification. Une seule base en
// test : le « déplacement » est simulé en supprimant la source avant l'import.
const api = request(createApp());

async function profileWithData(name: string) {
  const u = (await api.post('/api/users').send({ name }).expect(201)).body as { id: number; uid: string };
  const acc = (await api.post(`/api/users/${u.id}/accounts`).send({ name: `${name} courant`, type: 'checking', currency: 'EUR', initial_balance: 500, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  const cat = (await api.get(`/api/users/${u.id}/categories`).expect(200)).body.find((c: { type: string }) => c.type === 'expense').id as number;
  for (const [amount, description] of [[42.5, 'Boulangerie'], [800, 'Loyer']] as const) {
    await api.post(`/api/users/${u.id}/transactions`).send({ type: 'expense', amount, date: '2026-11-20', account_id: acc, category_id: cat, description }).expect(201);
  }
  await api.post(`/api/users/${u.id}/tags`).send({ name: `${name} vacances`, color: '#ff0000' }).expect(201);
  return u;
}

const exportOf = async (id: number) => (await api.post(`/api/users/${id}/export`).send({ entities: EXPORT_ENTITIES }).expect(200)).body;
const check = async (id: number) => (await api.get(`/api/users/${id}/transfer-check`).expect(200)).body as {
  user: { uid: string; name: string }; uids: Record<string, string[]>; counts: Record<string, number>;
};
/** La destination contient-elle tout ce que contenait la source ? */
function covers(dest: Awaited<ReturnType<typeof check>>, src: Awaited<ReturnType<typeof check>>) {
  for (const [kind, list] of Object.entries(src.uids)) for (const uid of list) if (!dest.uids[kind]!.includes(uid)) return `${kind} ${uid} manquant`;
  for (const [kind, n] of Object.entries(src.counts)) if ((dest.counts[kind] ?? 0) < n) return `${kind} : ${dest.counts[kind]} < ${n}`;
  return true;
}

describe('transfert de profil (ADR 0012)', () => {
  it('l’export porte l’identité stable du profil', async () => {
    const u = await profileWithData('Alice');
    expect(u.uid).toMatch(/^[0-9a-f-]{36}$/);
    const payload = await exportOf(u.id);
    expect(payload.user).toMatchObject({ uid: u.uid, name: 'Alice' });
  });

  it('déplacer : recréé à destination avec la même identité, rien ne manque, sans données par défaut en double', async () => {
    const u = await profileWithData('Bruno');
    const before = await check(u.id);
    const payload = await exportOf(u.id);
    await api.delete(`/api/users/${u.id}`).expect(200);

    const res = await api.post('/api/profiles/import').send({ payload }).expect(201);
    expect(res.body).toMatchObject({ created: true, user: { uid: u.uid, name: 'Bruno' } });
    const after = await check(res.body.user.id);
    expect(covers(after, before)).toBe(true);
    // Pas de compte « Compte courant » ni de catégories par défaut ajoutés en plus.
    expect(after.uids.accounts!.length).toBe(before.uids.accounts!.length);
    expect(after.uids.categories!.length).toBe(before.uids.categories!.length);
  });

  it('fusion : un second transfert du même profil ne crée aucun doublon', async () => {
    const u = await profileWithData('Chloé');
    const payload = await exportOf(u.id);
    const before = await check(u.id);
    const res = await api.post('/api/profiles/import').send({ payload }).expect(200);
    expect(res.body).toMatchObject({ created: false, user: { id: u.id } });
    expect(res.body.summary.transactions.created).toBe(0);
    expect(await check(u.id)).toEqual(before);
  });

  it('homonyme vide (ex. « Moi » de l’installation) : repris, pas de « Moi (2) »', async () => {
    const source = await profileWithData('Moi');
    const payload = await exportOf(source.id);
    await api.delete(`/api/users/${source.id}`).expect(200);
    const fresh = (await api.post('/api/users').send({ name: 'Moi' }).expect(201)).body as { id: number; uid: string };
    expect(fresh.uid).not.toBe(source.uid);

    const res = await api.post('/api/profiles/import').send({ payload }).expect(200);
    expect(res.body.user).toMatchObject({ id: fresh.id, uid: source.uid, name: 'Moi' });
    const users = (await api.get('/api/users').expect(200)).body as Array<{ name: string }>;
    expect(users.filter((x) => x.name.startsWith('Moi'))).toHaveLength(1);
    // Catégories par défaut du profil vierge + celles importées : fusionnées par nom.
    const names = (await api.get(`/api/users/${fresh.id}/categories`).expect(200)).body.map((c: { name: string; type: string }) => `${c.type}:${c.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('homonyme avec des données : profil importé sous un nom suffixé, rien n’est mélangé', async () => {
    const source = await profileWithData('Dora');
    const payload = await exportOf(source.id);
    payload.user.uid = crypto.randomUUID(); // un AUTRE profil « Dora » (venu d'une autre base)
    const res = await api.post('/api/profiles/import').send({ payload }).expect(201);
    expect(res.body.user.name).toBe('Dora (2)');
    expect((await check(source.id)).uids.transactions!.length).toBe(2);
  });

  it('même numéro de profil mais autre identité : les éléments ne sont pas pris pour ceux du profil existant', async () => {
    // Entre deux bases, le profil n°X de l'une n'est pas le n°X de l'autre.
    const a = await profileWithData('Émile');
    const b = await profileWithData('Fanny');
    const payload = await exportOf(b.id);
    payload.user.id = a.id; // le numéro coïncide avec un profil existant…
    payload.user.uid = crypto.randomUUID(); // …mais ce n'est pas lui
    const txBefore = await db.transaction.count({ where: { user_id: a.id } });
    await api.post(`/api/users/${a.id}/import.json`).send({ payload }).expect(200);
    // Les 2 opérations de Fanny sont créées chez Émile (import volontaire), pas
    // rattachées par erreur à des lignes existantes d'Émile.
    expect(await db.transaction.count({ where: { user_id: a.id } })).toBe(txBefore + 2);
  });

  it('refuse une sauvegarde sans identité de profil', async () => {
    const u = await profileWithData('Gaspard');
    const payload = await exportOf(u.id);
    delete payload.user.uid;
    const res = await api.post('/api/profiles/import').send({ payload }).expect(400);
    expect(res.body.error).toMatch(/identifiant de profil/);
  });
});
