import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnableBankingClient, EnableBankingError, signEnableBankingJwt, toBankRow, type BankTransaction } from './enableBanking';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const config = { appId: 'app-123', privateKeyPem: privateKey, redirectUrl: 'https://example.test/callback', baseUrl: 'https://eb.test' };

describe('signEnableBankingJwt', () => {
  it('produit un JWT RS256 vérifiable avec la clé publique', () => {
    const jwt = signEnableBankingJwt('app-123', privateKey, 1_700_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_700_000_000, exp: 1_700_003_600 });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
  });
});

describe('EnableBankingClient', () => {
  it('suit la pagination des opérations (continuation_key) et signe chaque appel', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const pages: Record<string, unknown> = {
      '': { transactions: [{ entry_reference: 'a' }], continuation_key: 'k1' },
      k1: { transactions: [{ entry_reference: 'b' }], continuation_key: null },
    };
    const client = new EnableBankingClient(config, async (url, init) => {
      calls.push({ url, auth: init?.headers?.Authorization });
      const key = new URL(url).searchParams.get('continuation_key') ?? '';
      return { ok: true, status: 200, text: async () => JSON.stringify(pages[key]) };
    });
    const txs = await client.transactions('acc/1', { dateFrom: '2026-10-01' });
    expect(txs.map((t) => t.entry_reference)).toEqual(['a', 'b']);
    expect(calls[0]!.url).toBe('https://eb.test/accounts/acc%2F1/transactions?date_from=2026-10-01');
    expect(calls[1]!.url).toContain('continuation_key=k1');
    expect(calls.every((c) => c.auth?.startsWith('Bearer ey'))).toBe(true);
  });

  it('remonte les erreurs HTTP avec le corps de la réponse', async () => {
    const client = new EnableBankingClient(config, async () => ({ ok: false, status: 401, text: async () => '{"message":"Invalid JWT"}' }));
    await expect(client.aspsps()).rejects.toBeInstanceOf(EnableBankingError);
    await expect(client.aspsps()).rejects.toThrow(/401.*Invalid JWT/);
  });

  it("envoie la demande d'autorisation avec l'URL de retour configurée", async () => {
    let sent: unknown;
    const client = new EnableBankingClient(config, async (_url, init) => {
      sent = JSON.parse(init!.body!);
      return { ok: true, status: 200, text: async () => '{"url":"https://bank.test/auth"}' };
    });
    const out = await client.startAuth({ name: 'BoursoBank', country: 'FR' }, { state: 's1', validUntil: new Date('2027-01-01T00:00:00Z') });
    expect(out.url).toBe('https://bank.test/auth');
    expect(sent).toEqual({
      access: { valid_until: '2027-01-01T00:00:00.000Z' },
      aspsp: { name: 'BoursoBank', country: 'FR' },
      state: 's1',
      redirect_url: 'https://example.test/callback',
      psu_type: 'personal',
    });
  });
});

describe('toBankRow', () => {
  const base: BankTransaction = { transaction_amount: { amount: '385.12', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-16', status: 'BOOK' };

  it('virement émis : bénéficiaire + motif complet, montant positif, dépense', () => {
    const row = toBankRow({ ...base, entry_reference: 'E1', creditor: { name: 'ACME SAS' }, remittance_information: ['Apport en capital', 'octobre 2026 - facture 12'] });
    expect(row).toMatchObject({
      fingerprint: 'eb:E1', date: '2026-10-16', type: 'expense', amount: 385.12, pending: false,
      description: 'ACME SAS — Apport en capital octobre 2026 - facture 12',
    });
  });

  it('virement reçu : émetteur, sans doublon si le motif le contient déjà', () => {
    const row = toBankRow({ ...base, credit_debit_indicator: 'CRDT', transaction_amount: { amount: '500', currency: 'EUR' }, debtor: { name: 'Jean Dupont' }, remittance_information: ['VIR SEPA JEAN DUPONT cadeau'] });
    expect(row.type).toBe('income');
    expect(row.description).toBe('VIR SEPA JEAN DUPONT cadeau');
  });

  it("opération en attente et sans référence : pas d'empreinte, marquée pending", () => {
    const row = toBankRow({ ...base, status: 'PDNG', bank_transaction_code: { description: 'Paiement carte' } });
    expect(row).toMatchObject({ fingerprint: null, pending: true, description: 'Paiement carte' });
  });
});
