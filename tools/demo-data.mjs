// Données de démonstration (fictives) pour les captures et les essais.
//
//   DATABASE_URL=… npm run db:seed          # profil « Démo » + catégories
//   BASE=http://localhost:3000 node tools/demo-data.mjs
//
// Remplit le profil « Démo » via l'API : 12 mois d'un foyer fictif (salaire,
// loyer, courses, abonnements, épargne, PEA aux cours Yahoo réels), budgets,
// factures, récurrents, objectifs, tags et règles. Tirages pseudo-aléatoires à
// graine fixe : mêmes données à chaque exécution, relatives au mois courant.
// À lancer sur une base VIDE dédiée (jamais sur une base réelle).

const BASE = process.env.BASE ?? 'http://localhost:3000';
async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// Générateur déterministe (mulberry32).
let seed = 20261114;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => Math.round((a + rand() * (b - a)) * 100) / 100;
const pick = (list) => list[Math.floor(rand() * list.length)];

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const day = (y, m, d) => new Date(Date.UTC(y, m, Math.min(d, 28)));
const past = (d) => d <= today;
const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11 + i, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
const start = months[0];
const cur = months[11];
const monthIso = ({ y, m }) => `${y}-${String(m + 1).padStart(2, '0')}`;

const users = await api('/users');
const user = users.find((u) => u.name === 'Démo');
if (!user) throw new Error('Profil « Démo » introuvable : lance d’abord npm run db:seed');
const U = `/users/${user.id}`;
if ((await api(`${U}/transactions`)).length > 0) throw new Error('Le profil Démo a déjà des opérations : base non vide, arrêt.');

const cats = Object.fromEntries((await api(`${U}/categories`)).map((c) => [c.name, c.id]));
const cat = (name) => { if (!cats[name]) throw new Error(`catégorie ${name}`); return cats[name]; };

// ── Comptes ─────────────────────────────────────────────────────────────────
const bank = await api(`${U}/institutions`, { name: 'Banque Exemple' });
const broker = await api(`${U}/institutions`, { name: 'Courtier Exemple' });
const accounts = await api(`${U}/accounts`);
const courant = accounts.find((a) => a.name === 'Compte courant');
await api(`${U}/accounts/${courant.id}`, { institution_id: bank.id, initial_balance: 2150, initial_balance_date: iso(day(start.y, start.m, 1)) }, 'PATCH');
const livret = await api(`${U}/accounts`, { name: 'Livret A', type: 'livret_a', currency: 'EUR', institution_id: bank.id, initial_balance: 6400, initial_balance_date: iso(day(start.y, start.m, 1)) });
const carte = await api(`${U}/accounts`, { name: 'Carte de crédit', type: 'credit', currency: 'EUR', institution_id: bank.id, initial_balance: 0, initial_balance_date: iso(day(start.y, start.m, 1)) });
const pea = await api(`${U}/accounts`, { name: 'PEA', type: 'pea', currency: 'EUR', institution_id: broker.id, initial_balance: 0, initial_balance_date: iso(day(start.y, start.m, 1)), orders_affect_cash: true });

const travel = await api(`${U}/tags`, { name: 'Vacances', color: '#14b8a6' });
const work = await api(`${U}/tags`, { name: 'Travail', color: '#475569' });

const txs = [];
const add = (date, type, amount, account, category, description, extra = {}) => {
  if (past(date)) txs.push({ type, amount, date: iso(date), account_id: account.id, category_id: category ? cat(category) : null, description, ...extra });
};

// ── Mouvements mensuels ─────────────────────────────────────────────────────
// Les charges fixes du mois courant sont laissées aux récurrents (générés plus bas).
for (const mo of months) {
  const isCur = mo === cur;
  const { y, m } = mo;
  if (!isCur) {
    add(day(y, m, 27), 'income', 2650, courant, 'Salaire', 'VIR SALAIRE EXEMPLE SAS');
    add(day(y, m, 3), 'expense', 860, courant, 'Logement', 'PRLV LOYER AGENCE EXEMPLE');
    add(day(y, m, 6), 'expense', 13.49, courant, 'Abonnements', 'NETFLIX.COM');
    add(day(y, m, 8), 'expense', 10.99, courant, 'Abonnements', 'SPOTIFY');
    add(day(y, m, 5), 'expense', 86.4, courant, 'Transport', 'NAVIGO MENSUEL');
    add(day(y, m, 12), 'expense', 29.99, courant, 'Internet & téléphone', 'BOX INTERNET EXEMPLE');
  }
  add(day(y, m, 10), 'expense', between(58, 96), courant, 'Énergie', 'PRLV ELECTRICITE EXEMPLE');
  add(day(y, m, 15), 'expense', 24.5, courant, 'Assurances', 'ASSURANCE HABITATION');
  for (let i = 0; i < 7 + Math.floor(rand() * 4); i += 1) add(day(y, m, 1 + Math.floor(rand() * 27)), 'expense', between(18, 115), pick([courant, courant, carte]), 'Courses', pick(['CARREFOUR MARKET', 'MONOPRIX', 'LIDL', 'BIOCOOP', 'MARCHE DU SAMEDI']));
  for (let i = 0; i < 3 + Math.floor(rand() * 3); i += 1) add(day(y, m, 1 + Math.floor(rand() * 27)), 'expense', between(12, 58), carte, 'Restaurants', pick(['LE PETIT BISTROT', 'SUSHI EXEMPLE', 'BOULANGERIE DU COIN', 'PIZZERIA NAPOLI']));
  if (rand() < 0.7) add(day(y, m, 18), 'expense', between(25, 140), carte, 'Shopping', pick(['LIBRAIRIE EXEMPLE', 'MAGASIN DE SPORT', 'BOUTIQUE EN LIGNE']));
  if (rand() < 0.5) add(day(y, m, 21), 'expense', between(15, 60), carte, 'Loisirs', pick(['CINEMA EXEMPLE', 'CONCERT', 'MUSEE']));
  if (rand() < 0.35) add(day(y, m, 9), 'expense', between(20, 70), courant, 'Santé', 'PHARMACIE EXEMPLE');
  if (rand() < 0.3) add(day(y, m, 23), 'expense', between(30, 120), courant, 'Frais professionnels', 'TRAIN DEPLACEMENT PRO', { tag_ids: [work.id] });
  // Épargne : livret le 28, PEA le 2 (le versement achète des titres plus bas).
  add(day(y, m, 28), 'transfer', 250, courant, null, 'VIR EPARGNE LIVRET A', { to_account_id: livret.id });
  add(day(y, m, 2), 'transfer', 200, courant, null, 'VIR VERSEMENT PEA', { to_account_id: pea.id });
  // Remboursement de la carte en fin de mois.
  add(day(y, m, 28), 'transfer', between(320, 520), courant, null, 'REMBOURSEMENT CARTE', { to_account_id: carte.id });
}
// Vacances d'été (tag), une prime en décembre si couvert.
const summer = months.find((x) => x.m === 6) ?? months[6];
add(day(summer.y, summer.m, 14), 'expense', 642, carte, 'Vacances', 'LOCATION GITE BRETAGNE', { tag_ids: [travel.id] });
add(day(summer.y, summer.m, 15), 'expense', 186, carte, 'Transport', 'SNCF VOYAGES', { tag_ids: [travel.id] });
add(day(summer.y, summer.m, 17), 'expense', 74.5, carte, 'Restaurants', 'CREPERIE DU PORT', { tag_ids: [travel.id] });
const dec = months.find((x) => x.m === 11);
if (dec) add(day(dec.y, dec.m, 20), 'income', 900, courant, 'Prime', 'VIR PRIME ANNUELLE');
for (const tx of txs) await api(`${U}/transactions`, tx);

// ── PEA : un ETF monde acheté chaque mois au cours réel de clôture ─────────
const etf = await api(`${U}/holdings`, { account_id: pea.id, symbol: 'DCAM.PA', name: 'Amundi PEA Monde (MSCI World)', asset_class: 'etf', currency: 'EUR' });
const prices = await api(`/prices/DCAM.PA/history?from=${iso(day(start.y, start.m, 1))}&to=${iso(today)}`).catch(() => []);
for (const mo of months) {
  const date = day(mo.y, mo.m, 3);
  if (!past(date)) continue;
  const quote = prices.find((p) => p.date >= iso(date))?.price ?? 5.5;
  const quantity = Math.floor(199 / quote);
  if (quantity > 0) await api(`${U}/holdings/${etf.id}/orders`, { side: 'buy', date: iso(date), quantity, unit_price: Math.round(quote * 1e4) / 1e4, fee: 0 });
}

// ── Planification ───────────────────────────────────────────────────────────
const recurrings = [
  ['Salaire', 'income', 2650, 27, 'Salaire'], ['Loyer', 'expense', 860, 3, 'Logement'], ['Netflix', 'expense', 13.49, 6, 'Abonnements'],
  ['Spotify', 'expense', 10.99, 8, 'Abonnements'], ['Navigo', 'expense', 86.4, 5, 'Transport'], ['Box internet', 'expense', 29.99, 12, 'Internet & téléphone'],
];
for (const [description, type, amount, dom, category] of recurrings) {
  await api(`${U}/recurring-transactions`, { description, type, amount, day_of_month: dom, frequency: 'monthly', account_id: courant.id, category_id: cat(category) });
}
await api(`${U}/recurring-transactions/generate`, {});
await api(`${U}/bills`, { name: 'Électricité', amount_min: 55, amount_max: 100, start_date: iso(day(start.y, start.m, 10)), frequency: 'monthly', pattern: 'ELECTRICITE', account_id: courant.id, category_id: cat('Énergie') });
await api(`${U}/bills`, { name: 'Assurance habitation', amount_min: 20, amount_max: 30, start_date: iso(day(start.y, start.m, 15)), frequency: 'monthly', pattern: 'ASSURANCE HABITATION', account_id: courant.id, category_id: cat('Assurances') });
await api(`${U}/budgets/global`, { month: monthIso(cur), amount_limit: 1900, recurring: true }, 'PUT');
for (const [category, limit] of [['Courses', 420], ['Restaurants', 160], ['Shopping', 120], ['Loisirs', 80]]) {
  await api(`${U}/budgets`, { category_id: cat(category), month: monthIso(cur), amount_limit: limit, recurring: true });
}
await api(`${U}/sinking-funds`, { name: 'Vacances d’été', category_id: cat('Vacances'), target_amount: 1200, period_months: 12, start_month: monthIso(start) });
await api(`${U}/savings-goals`, { name: 'Fonds d’urgence', target_amount: 10000, current_amount: 0, account_id: livret.id, color: '#16a34a' });
await api(`${U}/savings-goals`, { name: 'Nouveau vélo', target_amount: 1500, current_amount: 640, deadline: iso(day(cur.y + 1, 3, 1)), color: '#f59e0b' });
await api(`${U}/category-rules`, { pattern: 'CARREFOUR', category_id: cat('Courses') });
await api(`${U}/category-rules`, { pattern: 'SNCF', category_id: cat('Transport') });

console.log(`Démo : ${txs.length} opérations, ${months.length} mois, PEA ${prices.length ? 'aux cours Yahoo' : 'cours fictifs'} — profil n°${user.id}`);
