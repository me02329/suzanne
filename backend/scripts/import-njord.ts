/**
 * Migration njord (suivi PEA) → Suzanne.
 *
 * Lit la base njord et produit un fichier de sauvegarde Suzanne (format v3) à
 * importer via Outils → « Restaurer un JSON » (import idempotent et atomique :
 * le relancer ne duplique rien).
 *
 *   NJORD_DATABASE_URL=postgresql://… npx tsx backend/scripts/import-njord.ts \
 *     --user "Mon profil" [--account "PEA"] [--from-account "Compte courant"] \
 *     [--out njord-export.json] [--dry-run]
 *
 * Correspondance :
 * - PeaInfo            → compte `pea` (EUR), ordres avec effet sur les espèces,
 *                        date fiscale = premier versement (règle des 5 ans).
 * - Etf                → position (asset_class etf ; symbole Yahoo, `.PA` ajouté
 *                        si absent, comme njord le faisait implicitement).
 * - Purchase / Sale    → ordres buy / sell, cours = total / quantité (frais
 *                        inclus dans le total njord, donc fee = 0).
 * - Payment > 0        → virement vers le PEA (versement) ; < 0 → retrait.
 *                        Sans --from-account, le virement n'a que sa ligne PEA
 *                        (l'argent « vient de l'extérieur ») ; avec, il débite
 *                        ce compte Suzanne — à n'utiliser que si ces débits ne
 *                        sont PAS déjà saisis dans Suzanne comme dépenses.
 * - solde_especes      → si le solde calculé (versements − achats + ventes)
 *                        diffère, un relevé de solde espèces est ajouté à la date
 *                        de mise à jour njord, pour que Suzanne affiche le vrai
 *                        solde. L'écart est signalé dans le rapport.
 */
import fs from 'node:fs';
import pg from 'pg';

type Args = { user: string; account: string; fromAccount: string | null; out: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? null : null;
  };
  const user = get('--user');
  if (!user) throw new Error('--user "<nom njord>" est requis');
  return {
    user,
    account: get('--account') ?? 'PEA',
    fromAccount: get('--from-account'),
    out: get('--out') ?? 'njord-export.json',
    dryRun: argv.includes('--dry-run'),
  };
}

const day = (d: Date | string | null) => (d == null ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));
const r2 = (n: number) => Math.round(n * 100) / 100;
const yahooSymbol = (symbol: string | null, name: string) => {
  const raw = (symbol ?? name).trim().toUpperCase();
  return raw.includes('.') ? raw : `${raw}.PA`;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NJORD_DATABASE_URL;
  if (!url) throw new Error('NJORD_DATABASE_URL doit pointer vers la base njord');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const user = (await client.query('SELECT id, name FROM users WHERE name = $1', [args.user])).rows[0];
    if (!user) throw new Error(`Utilisateur njord « ${args.user} » introuvable`);
    const uid = user.id as number;
    // Requêtes séquentielles : un seul client pg (pas de requêtes concurrentes).
    const pea = (await client.query('SELECT date_ouverture, solde_especes, updated_at FROM pea_info WHERE user_id = $1', [uid])).rows[0] ?? null;
    const etfs = (await client.query('SELECT id, name, symbol FROM etfs WHERE user_id = $1 ORDER BY id', [uid])).rows;
    const purchases = (await client.query('SELECT etf_id, date, quantity, total_price FROM purchases WHERE user_id = $1 ORDER BY date, id', [uid])).rows;
    const sales = (await client.query('SELECT etf_id, date, quantity, total_price FROM sales WHERE user_id = $1 ORDER BY date, id', [uid])).rows;
    const payments = (await client.query('SELECT date, amount FROM payments WHERE user_id = $1 ORDER BY date, id', [uid])).rows;

    const firstEvent = [...payments, ...purchases].map((x) => day(x.date)!).sort()[0] ?? day(new Date())!;
    const firstDeposit = payments.filter((p) => Number(p.amount) > 0).map((p) => day(p.date)!).sort()[0] ?? null;
    const opening = day(pea?.date_ouverture ?? null) ?? firstEvent;

    const holdings = etfs.map((etf) => {
      const orders = [
        ...purchases.filter((p) => p.etf_id === etf.id).map((p) => ({ side: 'buy', date: day(p.date), quantity: Number(p.quantity), unit_price: Number(p.total_price) / Number(p.quantity), fee: 0 })),
        ...sales.filter((s) => s.etf_id === etf.id).map((s) => ({ side: 'sell', date: day(s.date), quantity: Number(s.quantity), unit_price: Number(s.total_price) / Number(s.quantity), fee: 0 })),
      ].filter((o) => o.quantity > 0).sort((a, b) => a.date!.localeCompare(b.date!));
      return { account_name: args.account, symbol: yahooSymbol(etf.symbol, etf.name), name: etf.name, asset_class: 'etf', currency: 'EUR', orders };
    });

    const transactions = payments.map((p) => {
      const amount = r2(Number(p.amount));
      const lines = amount >= 0
        ? [
            ...(args.fromAccount ? [{ account_name: args.fromAccount, amount: -amount }] : []),
            { account_name: args.account, amount },
          ]
        : [
            { account_name: args.account, amount },
            ...(args.fromAccount ? [{ account_name: args.fromAccount, amount: -amount }] : []),
          ];
      return {
        kind: 'transfer',
        date: day(p.date),
        description: amount >= 0 ? 'Versement PEA' : 'Retrait PEA',
        cleared: true,
        lines: lines.map((l) => ({ ...l, category_id: null, refund: false, note: null })),
      };
    });

    // Rapprochement des espèces.
    const deposits = r2(payments.reduce((s, p) => s + Number(p.amount), 0));
    const bought = r2(purchases.reduce((s, p) => s + Number(p.total_price), 0));
    const sold = r2(sales.reduce((s, x) => s + Number(x.total_price), 0));
    const computedCash = r2(deposits - bought + sold);
    const njordCash = pea ? r2(Number(pea.solde_especes)) : null;
    const snapshotDate = day(pea?.updated_at ?? new Date())!;
    const snapshots = njordCash != null && Math.abs(njordCash - computedCash) >= 0.01
      ? [{ account_name: args.account, date: snapshotDate, balance: njordCash }]
      : [];

    const report = {
      utilisateur: user.name,
      ouverture: opening,
      date_fiscale: firstDeposit ?? opening,
      versements_nets: deposits,
      versements_bruts: r2(payments.filter((p) => Number(p.amount) > 0).reduce((s, p) => s + Number(p.amount), 0)),
      achats: bought,
      ventes: sold,
      especes_calculees: computedCash,
      especes_njord: njordCash,
      ecart_especes: njordCash != null ? r2(njordCash - computedCash) : null,
      releve_ajoute: snapshots[0] ?? null,
      positions: holdings.map((h) => {
        let qty = 0; let cost = 0;
        for (const o of h.orders) {
          if (o.side === 'buy') { qty += o.quantity; cost += o.quantity * o.unit_price; }
          else { const avg = qty > 0 ? cost / qty : 0; qty -= o.quantity; cost -= avg * o.quantity; }
        }
        return { symbole: h.symbol, nom: h.name, ordres: h.orders.length, quantite: Number(qty.toFixed(8)), pru: qty > 0 ? r2(cost / qty) : 0 };
      }),
    };
    console.log(JSON.stringify(report, null, 2));
    if (args.dryRun) return;

    const payload = {
      app: 'suzanne',
      version: 3,
      exported_at: new Date().toISOString(),
      source: 'njord',
      accounts: [{
        id: 1,
        name: args.account,
        type: 'pea',
        currency: 'EUR',
        initial_balance: 0,
        initial_balance_date: opening < firstEvent ? opening : firstEvent,
        orders_affect_cash: true,
        fiscal_start_date: firstDeposit ?? opening,
      }],
      transactions,
      holdings,
      snapshots,
    };
    fs.writeFileSync(args.out, `${JSON.stringify(payload, null, 1)}\n`);
    console.error(`→ ${args.out} écrit. À importer dans Suzanne : Outils → Restaurer un JSON.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
