import type { LucideIcon } from 'lucide-react';
import { CATEGORY_ICON_GROUPS } from './categoryIconCatalog';

export { CATEGORY_ICON_GROUPS } from './categoryIconCatalog';

// Icônes proposées pour les catégories, par nom (format Lucide, kebab-case,
// celui stocké en base). Une sélection groupée (voir categoryIconCatalog.ts)
// plutôt que toute la bibliothèque : le bundle reste raisonnable et le choix
// lisible.
export const CATEGORY_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICON_GROUPS.flatMap((g) => g.icons.map((i) => [i.key, i.Icon] as const)),
);

// Anciens noms saisis à la main qui n'existent pas tels quels.
const ALIASES: Record<string, string> = { tools: 'wrench', house: 'home', 'circle-plus': 'plus-circle' };

export function categoryIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return CATEGORY_ICONS[key] ?? CATEGORY_ICONS[ALIASES[key] ?? ''] ?? null;
}

/** Icône d'une catégorie (rien si aucune ou inconnue), teintée de `color` si fourni. */
export function CategoryIcon({ name, size = 16, className, color }: { name: string | null | undefined; size?: number; className?: string; color?: string | null }) {
  const Icon = categoryIcon(name);
  return Icon ? <Icon size={size} strokeWidth={1.8} className={className} style={color ? { color } : undefined} aria-hidden /> : null;
}

/** Minuscules, sans accents, mots séparés par des espaces. */
export function normalizeWords(text: string): string[] {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

const KEYWORDS = CATEGORY_ICON_GROUPS.flatMap((g) => g.icons.map((i) => ({ key: i.key, words: i.keywords.split(' ').filter(Boolean) })));

/**
 * Icône suggérée d'après le nom d'une catégorie (« Boulangerie » → croissant,
 * « Frais bancaires » → landmark), ou null si rien ne correspond. Mot identique
 * > préfixe ; à score égal, l'icône listée en premier l'emporte.
 */
export function suggestCategoryIcon(name: string): string | null {
  const tokens = normalizeWords(name);
  let best: { key: string; score: number } | null = null;
  for (const { key, words } of KEYWORDS) {
    for (const word of words) {
      for (const token of tokens) {
        const score = token === word ? word.length * 2
          : word.length >= 4 && token.startsWith(word) ? word.length
          : token.length >= 5 && word.startsWith(token) ? token.length
          : 0;
        if (score > 0 && (!best || score > best.score)) best = { key, score };
      }
    }
  }
  return best?.key ?? null;
}
