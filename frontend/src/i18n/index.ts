import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import data from './i18n_data.json';

// Langues disponibles. Pour en ajouter une : ajouter son code ici ET une
// propriété (ex. "de") sur chaque entrée de i18n_data.json.
export const LANGUAGES = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'suzanne_lang';
const SUPPORTED = LANGUAGES.map((l) => l.code) as readonly string[];

// i18n_data.json : { "<clé française>": { "fr": "...", "en": "...", … } }. On le
// transpose vers le format par langue attendu par react-i18next. Source unique,
// facile à étendre (une langue = une propriété par entrée).
const dict = data as Record<string, Record<string, string>>;
const resources = Object.fromEntries(
  SUPPORTED.map((lang) => [
    lang,
    { translation: Object.fromEntries(Object.entries(dict).map(([key, langs]) => [key, langs[lang] ?? key])) },
  ]),
);

function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored as Lang;
    const browser = navigator?.language?.toLowerCase().split('-')[0];
    if (browser && SUPPORTED.includes(browser)) return browser as Lang;
  } catch { /* localStorage indisponible */ }
  return 'fr';
}

// Clés en langage naturel : la chaîne FRANÇAISE sert de clé (t('Enregistrer')).
// Une clé absente d'une langue retombe sur le français. keySeparator /
// nsSeparator désactivés pour que les « : » et « . » des phrases ne cassent rien.
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
