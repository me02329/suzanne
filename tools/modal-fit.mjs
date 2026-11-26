// Contrôle : chaque fenêtre (modale) tient dans l'écran du téléphone.
// Ouvre, page par page, les boutons qui ouvrent une fenêtre, et signale celles
// qui sortent de l'écran ou dont le contenu déborde en largeur.
//
//   BASE=http://localhost:5174 node tools/modal-fit.mjs [largeur]
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const width = Number(process.argv[2] ?? 360);
const PAGES = ['dashboard', 'transactions', 'accounts', 'investments', 'loans', 'budgets', 'recurring', 'bills', 'goals', 'alerts',
  'categories', 'rules', 'tags', 'tools', 'users', 'settings'];
// Boutons qui ouvrent une fenêtre (libellés FR de l'app).
const OPENERS = /^(\+ ?)?(Nouveau|Nouvelle|Ajouter|Importer|Créer|Saisir|Enregistrer un remboursement|Rattacher une opération|Connecter|Exporter)/i;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 760 }, hasTouch: true, isMobile: true });
let problems = 0;
let checked = 0;
for (const name of PAGES) {
  await page.goto(`${BASE}/${name}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  const buttons = page.locator('main button:visible, .pg-page button:visible, section button:visible');
  const labels = [...new Set((await buttons.allInnerTexts()).map((s) => s.trim()).filter((s) => OPENERS.test(s)))];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label, exact: true }).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click().catch(() => {});
    await page.waitForTimeout(450);
    const modal = page.locator('.modal').last();
    if (!(await modal.count())) continue;
    checked += 1;
    const m = await modal.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const wide = [...el.querySelectorAll('*')].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1); }).slice(0, 3)
        .map((c) => `${c.tagName.toLowerCase()}.${String(c.className).split(' ')[0]}`);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollX: el.scrollWidth > el.clientWidth + 1, wide };
    });
    const vw = width;
    const bad = m.left < -1 || m.right > vw + 1 || m.top < -1 || m.scrollX || m.wide.length > 0;
    if (bad) {
      problems += 1;
      console.log(`✗ /${name} « ${label} » : x ${Math.round(m.left)}→${Math.round(m.right)} / ${vw}${m.scrollX ? ', défile en largeur' : ''}${m.wide.length ? `, dépasse : ${m.wide.join(' ')}` : ''}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}
await browser.close();
console.log(`${checked} fenêtre(s) contrôlée(s) à ${width}px : ${problems === 0 ? '✓ toutes tiennent dans l’écran' : `${problems} problème(s)`}`);
process.exitCode = problems === 0 ? 0 : 1;
