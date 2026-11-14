import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { buildResources, parseCatalog } from './catalog';

// Langues disponibles. Pour en ajouter une : ajouter son code ici ET une
// colonne (ex. "de") dans chaque catalogue `catalogs/*.csv`.
export const LANGUAGES = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'suzanne_lang';
const SUPPORTED = LANGUAGES.map((l) => l.code) as readonly string[];

// Source des textes : les catalogues `catalogs/*.csv` (format `keys,fr,en`, clés
// stables `domaine.partie.nom`, un fichier par domaine), lus au build par Vite.
// Contrôle : `npm run i18n:check` (ADR 0007).
const csvFiles = import.meta.glob('./catalogs/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const catalogs = Object.entries(csvFiles).map(([file, text]) => parseCatalog(text, file.replace('./catalogs/', '')));
const resources = buildResources(catalogs, {}, SUPPORTED);

function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored as Lang;
    const browser = navigator?.language?.toLowerCase().split('-')[0];
    if (browser && SUPPORTED.includes(browser)) return browser as Lang;
  } catch { /* localStorage indisponible */ }
  return 'fr';
}

// Une clé absente d'une langue retombe sur le français. keySeparator /
// nsSeparator désactivés : les clés stables sont plates (`budgets.hero.remaining`
// est une clé, pas un chemin), et les « : » / « . » des anciennes clés-phrases
// ne cassent rien.
void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang(),
    fallbackLng: 'fr',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang);
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
}

export function currentLang(): Lang {
  return (SUPPORTED.includes(i18n.language) ? i18n.language : 'fr') as Lang;
}

// Étiquette Intl correspondant à la langue active (formatage nombres/dates/devises).
export function localeTag(): string {
  return currentLang() === 'en' ? 'en-US' : 'fr-FR';
}

export default i18n;
