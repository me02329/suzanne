import React from 'react';
import {
  BarChart3,
  CreditCard,
  Landmark,
  LayoutDashboard,
  PieChart,
  Repeat,
  Settings2,
  Tags,
  Target,
  Upload,
  Users,
} from 'lucide-react';
import type { SearchResult } from '@suzanne-lite/shared';

export type Tab = 'dashboard' | 'transactions' | 'statistics' | 'accounts' | 'categories' | 'budgets' | 'recurring' | 'goals' | 'rules' | 'tools' | 'users';

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
  { tab: 'transactions', label: 'Transactions', icon: React.createElement(CreditCard, { size: 18 }) },
  { tab: 'statistics', label: 'Statistiques', icon: React.createElement(PieChart, { size: 18 }) },
  { tab: 'accounts', label: 'Comptes', icon: React.createElement(Landmark, { size: 18 }) },
  { tab: 'categories', label: 'Catégories', icon: React.createElement(Tags, { size: 18 }) },
  { tab: 'budgets', label: 'Budgets', icon: React.createElement(BarChart3, { size: 18 }) },
  { tab: 'recurring', label: 'Récurrents', icon: React.createElement(Repeat, { size: 18 }) },
  { tab: 'goals', label: 'Objectifs', icon: React.createElement(Target, { size: 18 }) },
  { tab: 'rules', label: 'Règles', icon: React.createElement(Settings2, { size: 18 }) },
  { tab: 'tools', label: 'Import/Export', icon: React.createElement(Upload, { size: 18 }) },
  { tab: 'users', label: 'Utilisateurs', icon: React.createElement(Users, { size: 18 }) },
];

export const navSections: NavSection[] = [
  { id: 'pilotage', label: 'Pilotage', items: navItems.filter((item) => ['dashboard', 'transactions', 'statistics', 'budgets', 'recurring'].includes(item.tab)) },
  { id: 'structure', label: 'Structure', items: navItems.filter((item) => ['accounts', 'categories', 'goals', 'rules'].includes(item.tab)) },
  { id: 'admin', label: 'Administration', items: navItems.filter((item) => ['tools', 'users'].includes(item.tab)) },
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
