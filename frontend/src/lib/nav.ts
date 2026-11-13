import React from 'react';
import {
  ArrowLeftRight,
  CalendarRange,
  House,
  Landmark,
  PieChart,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { SearchResult } from '@suzanne/shared';

export type Tab = 'dashboard' | 'wealth' | 'assistant' | 'transactions' | 'statistics' | 'accounts' | 'categories' | 'budgets' | 'recurring' | 'bills' | 'goals' | 'investments' | 'alerts' | 'anomalies' | 'rules' | 'tools' | 'users' | 'settings' | 'tags' | 'forecast' | 'health';

// Navigation à deux niveaux : 7 sections (barre latérale / barre du bas), et
// des onglets à l'intérieur de chaque section. Chaque onglet garde sa propre
// URL (/budgets, /bills…) : les liens existants restent valides.
export interface NavSection {
  id: string;
  label: string;
  /** Libellé court pour la barre d'onglets mobile. */
  short: string;
  icon: React.ReactNode;
  tabs: Array<{ tab: Tab; label: string }>;
}

const icon = (C: typeof House) => React.createElement(C, { size: 20, strokeWidth: 1.75 });

export const navSections: NavSection[] = [
  {
    id: 'home', label: 'Accueil', short: 'Accueil', icon: icon(House),
    tabs: [{ tab: 'dashboard', label: 'Aperçu' }, { tab: 'health', label: 'Santé' }, { tab: 'alerts', label: 'Alertes' }],
  },
  {
    id: 'ops', label: 'Opérations', short: 'Opérations', icon: icon(ArrowLeftRight),
    tabs: [{ tab: 'transactions', label: 'Journal' }, { tab: 'anomalies', label: 'À vérifier' }],
  },
  {
    id: 'accounts', label: 'Patrimoine', short: 'Comptes', icon: icon(Landmark),
    tabs: [
      { tab: 'accounts', label: 'Comptes' },
      { tab: 'wealth', label: 'Patrimoine' },
      { tab: 'investments', label: 'Placements' },
      { tab: 'goals', label: 'Objectifs' },
    ],
  },
  {
    id: 'plan', label: 'Planifier', short: 'Planifier', icon: icon(CalendarRange),
    tabs: [
      { tab: 'budgets', label: 'Budgets' },
      { tab: 'recurring', label: 'Récurrents' },
      { tab: 'bills', label: 'Factures' },
      { tab: 'forecast', label: 'Prévisions' },
    ],
  },
  { id: 'analysis', label: 'Analyse', short: 'Analyse', icon: icon(PieChart), tabs: [{ tab: 'statistics', label: 'Statistiques' }] },
  { id: 'assistant', label: 'Assistant', short: 'Assistant', icon: icon(Sparkles), tabs: [{ tab: 'assistant', label: 'Assistant' }] },
  {
    id: 'settings', label: 'Réglages', short: 'Réglages', icon: icon(Settings),
    tabs: [
      { tab: 'categories', label: 'Catégories' },
      { tab: 'tags', label: 'Tags' },
      { tab: 'rules', label: 'Règles' },
      { tab: 'tools', label: 'Import / Export' },
      { tab: 'users', label: 'Profils' },
      { tab: 'settings', label: 'Préférences' },
    ],
  },
];

/** Sections de la barre d'onglets mobile (les autres vont dans « Plus »). */
export const MOBILE_PRIMARY = ['home', 'ops', 'accounts'] as const;

/** Pages dont le contenu dépend du mois sélectionné (sélecteur affiché). */
export const MONTH_TABS = new Set<Tab>(['dashboard', 'health', 'alerts', 'transactions', 'budgets', 'bills', 'assistant']);

export const navItems = navSections.flatMap((section) => section.tabs.map((t) => ({ ...t, section })));

export function sectionForTab(tab: Tab): NavSection {
  return navSections.find((s) => s.tabs.some((t) => t.tab === tab)) ?? navSections[0]!;
}

export function tabLabel(tab: Tab): string {
  return navItems.find((i) => i.tab === tab)?.label ?? 'Aperçu';
}

// Maps a search result type to the tab where the user should land.
export function tabForSearchResult(type: SearchResult['type']): Tab {
  switch (type) {
    case 'transaction': return 'transactions';
    case 'category': return 'categories';
    case 'account': return 'accounts';
    case 'goal': return 'goals';
  }
}

// Tab values double as URL path segments (/dashboard, /transactions, ...).
const TAB_SET = new Set<string>(navItems.map((item) => item.tab));

export function pathForTab(tab: Tab): string {
  return `/${tab}`;
}

// Derives the active tab from a pathname; unknown paths fall back to dashboard.
export function tabFromPath(pathname: string): Tab {
  const segment = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return TAB_SET.has(segment) ? (segment as Tab) : 'dashboard';
}

// Guards a tab value read from localStorage.
export function normalizeTab(value: string): Tab {
  return TAB_SET.has(value) ? (value as Tab) : 'dashboard';
}
