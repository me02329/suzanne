// Captures de l'interface (desktop 1440 / mobile 390) + contrôles automatiques.
// Prérequis : serveurs de dev lancés (front http://localhost:5174 par défaut).
//
//   node tools/screenshots.mjs <dossier> [page1,page2,…] [--theme dark] [--month 2026-04] [--lang en] [--full]
//
// Échoue (code 1) si une page lève une erreur JavaScript ou déborde
// horizontalement (scrollWidth > largeur de l'écran) — régression mobile la plus
// fréquente. Les captures ne doivent pas contenir de données réelles : à lancer
// sur une base de démo.
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0];
if (!out) {
  console.error('usage : node tools/screenshots.mjs <dossier> [pages] [--theme dark] [--month AAAA-MM] [--lang fr|en]');
  process.exit(2);
}
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const theme = flag('--theme') ?? 'light';
// Langue de l'interface (le navigateur automatisé est en anglais : on impose fr par défaut).
const lang = flag('--lang') ?? 'fr';
// Par défaut : la taille de l'écran (une page plus haute que l'écran laisserait
// un vide sous le menu latéral). --full : page entière.
const full = args.includes('--full');
const month = flag('--month');
const BASE = process.env.BASE ?? 'http://localhost:5174';
const ALL = ['dashboard', 'health', 'alerts', 'transactions', 'anomalies', 'accounts', 'wealth', 'investments', 'loans', 'goals', 'simulator',
  'budgets', 'recurring', 'bills', 'forecast', 'statistics', 'assistant', 'categories', 'tags', 'rules', 'tools', 'users', 'settings'];
const pages = args[1] && !args[1].startsWith('--') ? args[1].split(',') : ALL;
fs.mkdirSync(out, { recursive: true });

// Nombre de mois à reculer depuis le mois courant pour atteindre --month.
const monthsBack = (() => {
  if (!month) return 0;
  const now = new Date();
  const [y, m] = month.split('-').map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
})();

const problems = [];
const browser = await chromium.launch();
for (const [label, viewport, mobile] of [['desk', { width: 1440, height: 900 }, false], ['mob', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('suzanne_theme', JSON.stringify(t.theme)); localStorage.setItem('suzanne_lang', t.lang); } catch { /* ignore */ } }, { theme, lang });
  const page = await ctx.newPage();
  let current = '';
  page.on('pageerror', (e) => problems.push(`[${label}] ${current} : erreur JS — ${e.message}`));
  for (const p of pages) {
    current = p;
    await page.goto(`${BASE}/${p}`);
    await page.waitForTimeout(900);
    for (let i = 0; i < monthsBack; i += 1) {
      const prev = page.getByRole('button', { name: 'Mois précédent' }).first();
      if (!(await prev.isVisible().catch(() => false))) break;
      await prev.click();
      await page.waitForTimeout(150);
    }
    if (monthsBack > 0) await page.waitForTimeout(900);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > viewport.width) problems.push(`[${label}] ${p} : débordement horizontal (${width}px > ${viewport.width}px)`);
    const file = `${out}/${label}-${p.replace(/[/?=&]/g, '_')}.png`;
    await page.screenshot({ path: file, fullPage: full });
  }
  await ctx.close();
}
await browser.close();
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok — ${pages.length} pages × 2 formats dans ${out}`);
