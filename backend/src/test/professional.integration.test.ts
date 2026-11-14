import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

// Compte professionnel (SASU) : ses opérations sont visibles mais hors des
// finances personnelles ; les virements perso ↔ société gardent leur sens.
describe('comptes professionnels', () => {
  it('exclus des statistiques et du patrimoine perso, virements dans le bon sens', async () => {
    const u = (await api.post('/api/users').send({ name: 'Pro' }).expect(201)).body.id as number;
    const account = async (body: Record<string, unknown>) =>
      (await api.post(`/api/users/${u}/accounts`).send({ currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01', ...body }).expect(201)).body as { id: number; professional: boolean };
    const perso = await account({ name: 'Courant', type: 'checking' });
    const pro = await account({ name: 'SASU', type: 'checking', professional: true });
    expect(pro.professional).toBe(true);
    const cat = (await api.post(`/api/users/${u}/categories`).send({ name: 'Matériel', type: 'expense', color: '#111111' }).expect(201)).body.id as number;
    const tx = (body: Record<string, unknown>) => api.post(`/api/users/${u}/transactions`).send(body).expect(201);

    await tx({ type: 'expense', amount: 40, date: '2026-10-10', account_id: perso.id, category_id: cat, description: 'Achat perso' });
    await tx({ type: 'expense', amount: 606, date: '2026-10-16', account_id: pro.id, category_id: cat, description: 'Achat PC société' });
    await tx({ type: 'income', amount: 1000, date: '2026-10-20', account_id: pro.id, description: 'Facture client' });

    const stats = (await api.get(`/api/users/${u}/statistics?range=custom&from=2026-10-01&to=2026-10-31&currency=EUR&exclude_uncategorized=false`).expect(200)).body;
    expect(stats.total_expenses).toBe(40);

    const dash = (await api.get(`/api/users/${u}/dashboard?month=2026-10&currency=EUR`).expect(200)).body;
    expect(dash.expenses).toBe(40);
    expect(dash.income).toBe(0);
    const proBalance = dash.account_balances.find((b: { account_id: number }) => b.account_id === pro.id);
    expect(proBalance).toMatchObject({ group: 'business', group_label: 'Société', balance: 394 });

    // Relevé importé côté société : l'apport perso → société est relié (virement
    // neutre) ; le salaire société → perso ne l'est pas (revenu personnel).
    await tx({ type: 'expense', amount: 385.12, date: '2026-10-16', account_id: perso.id, description: 'VIR Virement vers MAE' });
    await tx({ type: 'income', amount: 1500, date: '2026-10-30', account_id: perso.id, description: 'VIR Salaire président' });
    const csv = 'date;label;amount\n2026-10-16;VIR Virement de Martial;385,12\n2026-10-30;VIR Salaire président;-1500\n';
    const imported = (await api.post(`/api/users/${u}/import.csv`).send({ csv, account_id: pro.id, mapping: { date: 'date', amount: 'amount', description: 'label' } }).expect(200)).body;
    expect(imported.linked_transfers).toHaveLength(1);
    expect(imported.linked_transfers[0]).toMatchObject({ date: '2026-10-16', amount: 385.12 });

    const after = (await api.get(`/api/users/${u}/dashboard?month=2026-10&currency=EUR`).expect(200)).body;
    expect(after.income).toBe(1500); // le salaire reste un revenu perso
    expect(after.expenses).toBe(40); // l'apport à la société n'est pas une dépense
  });
});
