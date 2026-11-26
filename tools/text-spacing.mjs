// Contrôle des espaces dans le texte AFFICHÉ : signale deux morceaux de texte
// collés à la frontière de deux éléments en ligne (« <strong>Aucune
// dépense</strong>Ajoute… » → « dépenseAjoute »). Une recherche dans le code
// ne suffit pas : les traductions, valeurs et composants se combinent à
// l'exécution.
//
//   BASE=http://localhost:5174 [PROFILE=<id>] node tools/text-spacing.mjs [pages,séparées,par,virgule]
//
// Nécessite l'app lancée (dev) avec des données (tools/demo-data.mjs).
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const ALL = ['dashboard', 'health', 'alerts', 'transactions', 'anomalies', 'accounts', 'wealth', 'diversification', 'investments', 'loans', 'goals', 'simulator',
  'budgets', 'recurring', 'bills', 'forecast', 'statistics', 'categories', 'tags', 'rules', 'tools', 'bank', 'settings', 'users', 'assistant'];
const pages = process.argv[2] ? process.argv[2].split(',') : ALL;

function scan() {
  const isText = (s) => /[\p{L}\p{N}]/u.test(s);
  const inlineLike = (el) => {
    const d = getComputedStyle(el).display;
    return d === 'inline' || d === 'contents';
  };
  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return false; // sr-only, masqué
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const skipTag = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'OPTION', 'SELECT', 'TEXTAREA', 'INPUT', 'TITLE']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (skipTag.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const found = [];
  let prev = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? '';
    if (!text.trim()) { if (text.length > 0) prev = null; continue; } // espace = séparation
    if (!node.parentElement || !visible(node.parentElement)) { prev = null; continue; }
    if (prev && prev.parentElement !== node.parentElement) {
      const a = prev.textContent ?? '';
      const lastA = a.slice(-1);
      const firstB = text[0];
      if (lastA && firstB && !/\s/.test(lastA) && !/\s/.test(firstB) && (isText(lastA) || /[.,;:!?)»%€]/.test(lastA)) && isText(firstB)) {
        // Frontière seulement entre éléments en ligne, dans un même bloc : un
        // bloc, une cellule ou un enfant de flex/grid est visuellement séparé.
        const common = (() => { let p = prev.parentElement; while (p && !p.contains(node)) p = p.parentElement; return p; })();
        const chain = (from) => { const out = []; for (let p = from; p && p !== common; p = p.parentElement) out.push(p); return out; };
        const sepA = chain(prev.parentElement).some((el) => !inlineLike(el));
        const sepB = chain(node.parentElement).some((el) => !inlineLike(el));
        const cd = common ? getComputedStyle(common).display : 'block';
        const flexy = /flex|grid/.test(cd);
        // Espacement donné par le CSS (marge, retrait) : pas collé à l'écran.
        const px = (el, side) => { const s = getComputedStyle(el); return parseFloat(s[`margin${side}`]) + parseFloat(s[`padding${side}`]); };
        // Séparateur ajouté par le CSS (« · » en ::before / ::after).
        const pseudo = (el, which) => { const c = getComputedStyle(el, which).content; return c && c !== 'none' && c !== 'normal' && c !== '""'; };
        const spaced = chain(prev.parentElement).some((el) => px(el, 'Right') >= 2 || pseudo(el, '::after'))
          || chain(node.parentElement).some((el) => px(el, 'Left') >= 2 || pseudo(el, '::before'));
        if (!sepA && !sepB && !flexy && !spaced) {
          found.push(`${a.trim().slice(-30)}|${text.trim().slice(0, 30)}`);
        }
      }
    }
    prev = node;
  }
  return [...new Set(found)];
}

const browser = await chromium.launch();
let total = 0;
for (const [label, viewport] of [['bureau', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  // PROFILE=<id> : contrôler un autre profil (ex. un profil vide, pour les états vides).
  if (process.env.PROFILE) {
    await page.addInitScript((id) => localStorage.setItem('suzanne_active_profile', JSON.stringify({ backend: 'server', userId: Number(id) })), process.env.PROFILE);
  }
  for (const name of pages) {
    await page.goto(`${BASE}/${name}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    // Sections repliées (<details>) : ouvertes pour être contrôlées aussi.
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(150);
    const hits = await page.evaluate(scan);
    for (const h of hits) console.log(`${label.padEnd(6)} /${name.padEnd(16)} « ${h.replace('|', ' ▌ ')} »`);
    total += hits.length;
  }
  await page.close();
}
await browser.close();
console.log(total === 0 ? '✓ Aucun texte collé.' : `${total} frontière(s) à vérifier.`);
process.exitCode = total === 0 ? 0 : 1;
