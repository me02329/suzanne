import { getAiConfig } from '../lib/settingsStore.js';
import { aiToolDefinitions, executeAiTool, type PendingAiAction } from './tools.js';

type AiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatChoice {
  message: { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[] };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

export interface AiChatResult {
  answer: string;
  pendingActions: PendingAiAction[];
}

export type AiErrorKind = 'not_configured' | 'auth' | 'rate_limit' | 'insufficient_quota' | 'model_unavailable' | 'bad_request' | 'upstream' | 'network';

export class AiProviderError extends Error {
  status: number;
  kind: AiErrorKind;
  detail: string;
  constructor(kind: AiErrorKind, status: number, message: string, detail = '') {
    super(message);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

function classifyUpstream(status: number, body: string): AiProviderError {
  const trimmed = body.slice(0, 400);
  // OpenAI returns 429 for two very different situations: real rate limits
  // (too many requests per minute) and "insufficient_quota" (no credit on
  // the account). The user-facing fix is completely different so we split.
  if (status === 429) {
    if (body.includes('insufficient_quota')) {
      return new AiProviderError(
        'insufficient_quota',
        402,
        'Pas de crédit sur le compte OpenAI. Ajoute un moyen de paiement et un crédit prépayé sur platform.openai.com/settings/organization/billing/overview.',
        trimmed,
      );
    }
    return new AiProviderError('rate_limit', 429, 'Trop de requêtes : attends quelques secondes avant de réessayer.', trimmed);
  }
  if (status === 401 || status === 403) return new AiProviderError('auth', 401, 'Clé API refusée par le fournisseur.', trimmed);
  if (status === 404) return new AiProviderError('model_unavailable', 404, 'Modèle introuvable pour cette clé.', trimmed);
  if (status === 400) return new AiProviderError('bad_request', 400, 'Requête refusée par le fournisseur.', trimmed);
  return new AiProviderError('upstream', 502, `Erreur fournisseur IA (${status}).`, trimmed);
}

export async function checkAiHealth(): Promise<{ configured: boolean; model: string; baseUrl: string; provider: string; source: string; ok?: boolean; error?: { kind: AiErrorKind; message: string; detail: string } }> {
  const cfg = await getAiConfig();
  const info = { configured: Boolean(cfg.apiKey), model: cfg.model, baseUrl: cfg.baseUrl, provider: cfg.provider, source: cfg.source };
  if (!info.configured) return info;
  try {
    await createChatCompletion([
      { role: 'system', content: 'ping' },
      { role: 'user', content: 'ping' },
    ], { noTools: true });
    return { ...info, ok: true };
  } catch (e) {
    if (e instanceof AiProviderError) {
      return { ...info, ok: false, error: { kind: e.kind, message: e.message, detail: e.detail } };
    }
    return { ...info, ok: false, error: { kind: 'network', message: (e as Error).message, detail: '' } };
  }
}

export async function runAiChat(userId: number, message: string, context: { month: string; currency: string }): Promise<AiChatResult> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    throw new AiProviderError('not_configured', 503, 'Assistant IA non configuré: ajoute une clé API depuis Paramètres ou définis AI_API_KEY côté backend.');
  }

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt(context) },
    { role: 'user', content: message },
  ];
  const pendingActions: PendingAiAction[] = [];

  for (let step = 0; step < 4; step += 1) {
    const assistantMessage = await createChatCompletion(messages);
    messages.push(assistantMessage);

    const calls = assistantMessage.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        answer: assistantMessage.content?.trim() || 'Je n’ai pas trouvé de réponse exploitable.',
        pendingActions,
      };
    }

    for (const call of calls) {
      const args = parseToolArguments(call.function.arguments);
      const execution = await executeAiTool(userId, call.function.name, args);
      if (execution.pendingAction) pendingActions.push(execution.pendingAction);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(execution.result),
      });
    }
  }

  return {
    answer: 'J’ai atteint la limite d’étapes pour cette demande. Essaie une consigne plus précise.',
    pendingActions,
  };
}

async function createChatCompletion(messages: AiMessage[], options: { noTools?: boolean } = {}) {
  const cfg = await getAiConfig();
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        ...(options.noTools ? {} : { tools: aiToolDefinitions, tool_choice: 'auto' }),
        temperature: 0.2,
      }),
    });
  } catch (e) {
    const detail = (e as Error).message;
    console.error('[ai] network error reaching provider', { baseUrl: cfg.baseUrl, detail });
    throw new AiProviderError('network', 502, `Impossible de joindre le fournisseur IA: ${detail}`, detail);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error('[ai] provider error', { status: res.status, model: cfg.model, body: body.slice(0, 500) });
    throw classifyUpstream(res.status, body);
  }
  const data = await res.json() as ChatResponse;
  const message = data.choices?.[0]?.message;
  if (!message) {
    console.error('[ai] invalid response shape', data);
    throw new AiProviderError('upstream', 502, 'Réponse IA invalide.', JSON.stringify(data).slice(0, 400));
  }
  return { role: 'assistant' as const, content: message.content ?? null, tool_calls: message.tool_calls };
}

function parseToolArguments(value: string): unknown {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Arguments tool IA invalides');
  }
}

function systemPrompt(context: { month: string; currency: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'Tu es l\'assistant financier intégré à Suzanne Lite.',
    'Réponds en français, de façon concise et concrète.',
    'Utilise systématiquement les tools pour consulter les données ou préparer des actions, ne devine jamais des chiffres ou des identifiants.',
    '',
    'LECTURE : list_accounts, list_categories, list_tags, list_recurring, list_goals, list_budgets, list_rules, get_dashboard_summary, search_transactions.',
    '',
    'ÉCRITURE : tu peux créer, modifier et supprimer presque tout via les tools propose_* (transactions, catégories, tags, objectifs, récurrents, budgets, règles, et versements sur objectifs).',
    'Chaque propose_* prépare l\'action et la renvoie pour confirmation : ne prétends JAMAIS qu\'une donnée a été créée ou modifiée. Décris ce que tu vas faire et explique que l\'utilisateur doit cliquer "Confirmer".',
    'Toujours vérifier l\'existence et l\'id réel des entités avant d\'appeler un propose_* (utilise les list_*).',
    'Pour les suppressions, redemande explicitement avant d\'appeler propose_delete_*.',
    '',
    `Date du jour: ${today}. Mois affiché: ${context.month}. Devise affichée: ${context.currency}.`,
  ].join('\n');
}
