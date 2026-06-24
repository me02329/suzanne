import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { fr } from './fr';
import { en } from './en';

export type Lang = 'fr' | 'en';
const STORAGE_KEY = 'suzanne_lang';

function initialLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
    // Premier lancement : on suit la langue du navigateur si c'est de l'anglais.
    if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en')) return 'en';
  } catch { /* localStorage indisponible */ }
  return 'fr';
}

void i18n
  .use(initReactI18next)
  .init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: initialLang(),
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: Lang): void {
  void i18n.changeLanguage(lang);
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
}

export function currentLang(): Lang {
  return (i18n.language === 'en' ? 'en' : 'fr');
}

// Étiquette Intl correspondant à la langue active, pour le formatage des
// nombres, dates et devises (lib/format.ts).
export function localeTag(): string {
  return currentLang() === 'en' ? 'en-US' : 'fr-FR';
}

export default i18n;
