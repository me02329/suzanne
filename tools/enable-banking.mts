// Preuve de concept Enable Banking (DSP2) en ligne de commande : vérifier la
// configuration, la couverture des banques, autoriser l'accès à ses comptes et
// regarder ce que l'API renvoie (libellés complets, soldes), sans rien écrire
// dans la base. Mode d'emploi : docs/ENABLE-BANKING.md.
//
//   npx tsx tools/enable-banking.mts check
//   npx tsx tools/enable-banking.mts banks [FR] [filtre]
//   npx tsx tools/enable-banking.mts auth "<banque>" [FR] [jours]
//   npx tsx tools/enable-banking.mts session "<code ou URL de retour complète>"
//   npx tsx tools/enable-banking.mts accounts
//   npx tsx tools/enable-banking.mts balances <n° ou uid>
//   npx tsx tools/enable-banking.mts transactions <n° ou uid> [--from AAAA-MM-JJ] [--raw]
//
// Configuration : variables ENABLE_BANKING_APP_ID, ENABLE_BANKING_KEY_PATH,
// ENABLE_BANKING_REDIRECT_URL (ou fichier .env.enablebanking à la racine).
// La session et les réponses brutes vont dans .data/ (ignoré par git) : elles
// contiennent des données bancaires réelles.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EnableBankingClient, enableBankingConfigFromEnv, toBankRow, type Session } from '../backend/src/lib/enableBanking.ts';

const ENV_FILE = '.env.enablebanking';
const DATA_DIR = '.data';
const SESSION_FILE = `${DATA_DIR}/enablebanking-session.json`;

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const config = enableBankingConfigFromEnv();
if (!config) {
  console.error(`Configuration manquante : ENABLE_BANKING_APP_ID, ENABLE_BANKING_KEY_PATH, ENABLE_BANKING_REDIRECT_URL (env ou ${ENV_FILE}).`);
  process.exit(1);
}
const client = new EnableBankingClient(config);

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function loadSession(): Session {
  if (!existsSync(SESSION_FILE)) throw new Error('Aucune session : lance « auth » puis « session ».');
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Session;
}

function accountUid(ref: string | undefined): string {
  const session = loadSession();
  if (!ref) throw new Error('Indique le compte (numéro de « accounts » ou uid).');
  const n = Number(ref);
  const account = Number.isInteger(n) && n >= 1 ? session.accounts[n - 1] : session.accounts.find((a) => a.uid === ref);
  if (!account) throw new Error(`Compte introuvable : ${ref}`);
  return account.uid;
}

const money = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  switch (command) {
    case 'check': {
      const app = await client.application();
      console.log('Application OK :', JSON.stringify(app, null, 2));
      break;
    }
    case 'banks': {
      const country = (args[0] ?? 'FR').toUpperCase();
      const filter = args[1]?.toLowerCase();
      const banks = (await client.aspsps(country)).filter((b) => !filter || b.name.toLowerCase().includes(filter));
      for (const b of banks) {
        const days = b.maximum_consent_validity ? Math.round(b.maximum_consent_validity / 86400) : '?';
        console.log(`${b.name}${b.beta ? ' (bêta)' : ''} — consentement max ${days} j${b.bic ? ` — ${b.bic}` : ''}`);
      }
      console.log(`${banks.length} banque(s) (${country}).`);
      break;
    }
    case 'auth': {
      const name = args[0];
      if (!name) throw new Error('Indique le nom exact de la banque (voir « banks »).');
      const country = (args[1] ?? 'FR').toUpperCase();
      const bank = (await client.aspsps(country)).find((b) => b.name === name);
      const maxDays = bank?.maximum_consent_validity ? Math.floor(bank.maximum_consent_validity / 86400) : 90;
      const days = Math.min(Number(args[2] ?? maxDays), maxDays);
      const { url } = await client.startAuth({ name, country }, { state: randomUUID(), validUntil: new Date(Date.now() + days * 86400_000) });
      console.log(`Consentement demandé pour ${days} jours. Ouvre cette URL, valide dans l'appli de ta banque,`);
      console.log('puis copie l\'adresse complète de la page de retour (elle contient ?code=…) :\n');
      console.log(url);
      console.log('\nEnsuite : npx tsx tools/enable-banking.mts session "<adresse copiée>"');
      break;
    }
    case 'session': {
      const input = args[0];
      if (!input) throw new Error('Colle le code ou l\'URL de retour complète.');
      const code = input.includes('code=') ? new URL(input).searchParams.get('code') : input;
      if (!code) throw new Error('Pas de paramètre code dans cette URL.');
      const session = await client.createSession(code);
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
      console.log(`Session ${session.session_id} enregistrée (${SESSION_FILE}), valable jusqu'au ${session.access?.valid_until ?? '?'}.`);
      printAccounts(session);
      break;
    }
    case 'accounts':
      printAccounts(loadSession());
      break;
    case 'balances': {
      for (const b of await client.balances(accountUid(args[0]))) {
        console.log(`${b.balance_type.padEnd(5)} ${money(Number(b.balance_amount.amount)).padStart(12)} ${b.balance_amount.currency}  ${b.reference_date ?? b.last_change_date_time ?? ''}  ${b.name ?? ''}`);
      }
      break;
    }
    case 'transactions': {
      const uid = accountUid(args[0]);
      const dateFrom = flag('--from') ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const txs = await client.transactions(uid, { dateFrom });
      if (args.includes('--raw')) {
        mkdirSync(DATA_DIR, { recursive: true });
        const file = `${DATA_DIR}/enablebanking-transactions-${dateFrom}.json`;
        writeFileSync(file, JSON.stringify(txs, null, 2));
        console.log(`Réponse brute : ${file}`);
      }
      const rows = txs.map(toBankRow);
      for (const r of rows) {
        const sign = r.type === 'expense' ? '-' : '+';
        console.log(`${r.date}  ${(sign + money(r.amount)).padStart(11)}  ${r.pending ? '[attente] ' : ''}${r.description}`);
      }
      const lengths = rows.map((r) => r.description.length);
      console.log(`\n${rows.length} opération(s) depuis le ${dateFrom}` +
        (rows.length ? ` · libellé max ${Math.max(...lengths)} car. · ${rows.filter((r) => r.description.length > 40).length} au-delà de 40 car. (limite des exports CSV)` : '') +
        ` · ${rows.filter((r) => !r.fingerprint).length} sans identifiant bancaire · ${rows.filter((r) => r.pending).length} en attente.`);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 14).map((l) => l.slice(3)).join('\n'));
  }
}

function printAccounts(session: Session) {
  session.accounts.forEach((a, i) => {
    const iban = a.account_id?.iban ? `…${a.account_id.iban.slice(-4)}` : '';
    console.log(`${i + 1}. ${a.name ?? a.product ?? a.details ?? 'Compte'} ${iban} ${a.currency ?? ''} — uid ${a.uid}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
