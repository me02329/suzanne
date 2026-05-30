import type { AiPendingAction } from '@suzanne-lite/shared';

// Lightweight assistant state shared between App (which owns the conversation so
// it survives tab switches) and the lazily-loaded Assistant page. Kept out of
// Assistant.tsx so importing these doesn't pull react-markdown into the main
// bundle.

export interface ToolEvent {
  id: string;
  name: string;
  status: 'running' | 'ok' | 'error';
  preview?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  actions?: AiPendingAction[];
  tools?: ToolEvent[];
}

export const WELCOME: ChatMessage = {
  id: 1,
  role: 'assistant',
  content: 'Je peux analyser tes finances, rechercher des transactions, créer / modifier / supprimer (catégories, tags, objectifs, récurrents, budgets, règles, transactions). Toute écriture demande confirmation.',
};

export function initialAssistantMessages(): ChatMessage[] {
  return [WELCOME];
}
