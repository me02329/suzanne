import React from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CreditCard,
  Landmark,
  LayoutDashboard,
  MessageSquareText,
  PieChart,
  ReceiptText,
  Repeat,
  Settings2,
  Tag as TagIcon,
  Tags,
  Target,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react';
import type { SearchResult } from '@suzanne/shared';

export type Tab = 'dashboard' | 'wealth' | 'assistant' | 'transactions' | 'statistics' | 'accounts' | 'categories' | 'budgets' | 'recurring' | 'bills' | 'goals' | 'rules' | 'tools' | 'users' | 'settings' | 'tags' | 'forecast' | 'health';

export interface NavItem {
  tab: Tab;
  label: string;
  icon: React.ReactNode;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const navItems: NavItem[] = [
  { tab: 'dashboard', label: 'Vue générale', icon: React.createElement(LayoutDashboard, { size: 18 }) },
  { tab: 'wealth', label: 'Patrimoine', icon: React.createElement(TrendingUp, { size: 18 }) },
  { tab: 'statistics', label: 'Statistiques', icon: React.createElement(PieChart, { size: 18 }) },
  { tab: 'forecast', label: 'Prévisionnel', icon: React.createElement(CalendarClock, { size: 18 }) },
  { tab: 'health', label: 'Santé financière', icon: React.createElement(Activity, { size: 18 }) },
  { tab: 'transactions', label: 'Transactions', icon: React.createElement(CreditCard, { size: 18 }) },
  { tab: 'accounts', label: 'Comptes', icon: React.createElement(Landmark, { size: 18 }) },
  { tab: 'budgets', label: 'Budgets', icon: React.createElement(BarChart3, { size: 18 }) },
  { tab: 'bills', label: 'Factures', icon: React.createElement(ReceiptText, { size: 18 }) },
  { tab: 'recurring', label: 'Récurrents', icon: React.createElement(Repeat, { size: 18 }) },
  { tab: 'goals', label: 'Objectifs', icon: React.createElement(Target, { size: 18 }) },
  { tab: 'categories', label: 'Catégories', icon: React.createElement(Tags, { size: 18 }) },
  { tab: 'tags', label: 'Tags', icon: React.createElement(TagIcon, { size: 18 }) },
  { tab: 'rules', label: 'Règles', icon: React.createElement(Settings2, { size: 18 }) },
  { tab: 'tools', label: 'Import/Export', icon: React.createElement(Upload, { size: 18 }) },
  { tab: 'users', label: 'Utilisateurs', icon: React.createElement(Users, { size: 18 }) },
  { tab: 'settings', label: 'Paramètres', icon: React.createElement(Settings2, { size: 18 }) },
  { tab: 'assistant', label: 'Assistant IA', icon: React.createElement(MessageSquareText, { size: 18 }) },
];

// Pilotage = visualisation pure ; Données = saisie/gestion des flux ;
// Structure = référentiel ; Administration = outillage + IA.
export const navSections: NavSection[] = [
  { id: 'pilotage', label: 'Pilotage', items: navItems.filter((item) => ['dashboard', 'wealth', 'statistics', 'forecast', 'health'].includes(item.tab)) },
  { id: 'donnees', label: 'Données', items: navItems.filter((item) => ['transactions', 'accounts', 'budgets', 'bills', 'recurring', 'goals'].includes(item.tab)) },
  { id: 'structure', label: 'Structure', items: navItems.filter((item) => ['categories', 'tags', 'rules'].includes(item.tab)) },
  { id: 'admin', label: 'Administration', items: navItems.filter((item) => ['tools', 'users', 'settings', 'assistant'].includes(item.tab)) },
];

// Maps a search result type to the tab where the user should land when they
// click the result. Keep in sync with the SearchResult union.
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

// Guards a tab value read from localStorage: a stale/corrupted value would
// otherwise make the "/" and "*" redirects point at an unknown path.
export function normalizeTab(value: string): Tab {
  return TAB_SET.has(value) ? (value as Tab) : 'dashboard';
}
