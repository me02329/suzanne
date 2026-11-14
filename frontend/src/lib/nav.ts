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

export type Tab = 'dashboard' | 'wealth' | 'assistant' | 'transactions' | 'statistics' | 'accounts' | 'categories' | 'budgets' | 'recurring' | 'bills' | 'goals' | 'investments' | 'alerts' | 'anomalies' | 'rules' | 'tools' | 'users' | 'settings' | 'tags' | 'forecast' | 'health' | 'simulator';

// Navigation à deux niveaux : 7 sections (barre latérale / barre du bas), et
// des onglets à l'intérieur de chaque section. Chaque onglet garde sa propre
// URL (/budgets, /bills…) : les liens existants restent valides.
// Les libellés sont des clés de traduction (catalogue ui.csv), affichées avec t().
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
    id: 'home', label: 'ui.nav.home', short: 'ui.nav.home', icon: icon(House),
    tabs: [{ tab: 'dashboard', label: 'ui.tab.dashboard' }, { tab: 'health', label: 'ui.tab.health' }, { tab: 'alerts', label: 'ui.tab.alerts' }],
  },
  {
    id: 'ops', label: 'ui.nav.ops', short: 'ui.nav.ops', icon: icon(ArrowLeftRight),
    tabs: [{ tab: 'transactions', label: 'ui.tab.transactions' }, { tab: 'anomalies', label: 'ui.tab.anomalies' }],
  },
  {
    id: 'accounts', label: 'ui.nav.accounts', short: 'ui.nav.accounts_short', icon: icon(Landmark),
    tabs: [
      { tab: 'accounts', label: 'ui.tab.accounts' },
      { tab: 'wealth', label: 'ui.tab.wealth' },
      { tab: 'investments', label: 'ui.tab.investments' },
      { tab: 'goals', label: 'ui.tab.goals' },
      { tab: 'simulator', label: 'ui.tab.simulator' },
    ],
  },
  {
    id: 'plan', label: 'ui.nav.plan', short: 'ui.nav.plan', icon: icon(CalendarRange),
    tabs: [
      { tab: 'budgets', label: 'ui.tab.budgets' },
      { tab: 'recurring', label: 'ui.tab.recurring' },
      { tab: 'bills', label: 'ui.tab.bills' },
      { tab: 'forecast', label: 'ui.tab.forecast' },
    ],
  },
  { id: 'analysis', label: 'ui.nav.analysis', short: 'ui.nav.analysis', icon: icon(PieChart), tabs: [{ tab: 'statistics', label: 'ui.tab.statistics' }] },
  { id: 'assistant', label: 'ui.nav.assistant', short: 'ui.nav.assistant', icon: icon(Sparkles), tabs: [{ tab: 'assistant', label: 'ui.tab.assistant' }] },
  {
    id: 'settings', label: 'ui.nav.settings', short: 'ui.nav.settings', icon: icon(Settings),
    tabs: [
      { tab: 'categories', label: 'ui.tab.categories' },
      { tab: 'tags', label: 'ui.tab.tags' },
      { tab: 'rules', label: 'ui.tab.rules' },
      { tab: 'tools', label: 'ui.tab.tools' },
      { tab: 'users', label: 'ui.tab.users' },
      { tab: 'settings', label: 'ui.tab.settings' },
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
  return navItems.find((i) => i.tab === tab)?.label ?? 'ui.tab.dashboard';
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
