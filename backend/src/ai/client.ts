import { getAiConfig, type AiRuntimeConfig } from '../lib/settingsStore.js';
import { aiToolDefinitions, executeAiTool, type PendingAiAction } from './tools.js';

type AiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type AiChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

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

export type AiStreamEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool_start'; id: string; name: string; args: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; pendingAction?: PendingAiAction; preview?: string }
  | { kind: 'done'; answer: string; pendingActions: PendingAiAction[] }
  | { kind: 'error'; error: { kind: AiErrorKind; message: string; detail: string } };

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
    ], cfg, { noTools: true });
    return { ...info, ok: true };
  } catch (e) {
    if (e instanceof AiProviderError) {
      return { ...info, ok: false, error: { kind: e.kind, message: e.message, detail: e.detail } };
    }
    return { ...info, ok: false, error: { kind: 'network', message: (e as Error).message, detail: '' } };
  }
}

export async function runAiChat(userId: number, message: string, context: { month: string; currency: string }, history: AiChatHistoryMessage[] = []): Promise<AiChatResult> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    throw new AiProviderError('not_configured', 503, 'Assistant IA non configuré: ajoute une clé API depuis Paramètres ou définis AI_API_KEY côté backend.');
  }

  const messages = initialMessages(context, history, message);
  const pendingActions: PendingAiAction[] = [];

  for (let step = 0; step < 4; step += 1) {
    const assistantMessage = await createChatCompletion(messages, cfg);
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

export async function* streamAiChat(userId: number, message: string, context: { month: string; currency: string }, history: AiChatHistoryMessage[] = []): AsyncGenerator<AiStreamEvent> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    yield {
      kind: 'error',
      error: { kind: 'not_configured', message: 'Assistant IA non configuré: ajoute une clé API depuis Paramètres ou définis AI_API_KEY côté backend.', detail: '' },
    };
    return;
  }

  const messages = initialMessages(context, history, message);
  const pendingActions: PendingAiAction[] = [];
  let finalAnswer = '';

  try {
    for (let step = 0; step < 4; step += 1) {
      // Stream this turn from the provider. The generator yields token events
      // as we read deltas, and resolves to the assembled message at the end
      // so we can decide whether to loop (tool calls) or stop.
      const assembled = { content: '', tool_calls: [] as ToolCall[] };
      for await (const delta of streamChatCompletion(messages, cfg)) {
        if (delta.contentDelta) {
          assembled.content += delta.contentDelta;
          yield { kind: 'token', text: delta.contentDelta };
        }
        if (delta.toolCallDelta) {
          mergeToolCallDelta(assembled.tool_calls, delta.toolCallDelta);
        }
      }

      const assistantMessage: AiMessage = {
        role: 'assistant',
        content: assembled.content || null,
        tool_calls: assembled.tool_calls.length > 0 ? assembled.tool_calls : undefined,
      };
      messages.push(assistantMessage);

      if (assembled.tool_calls.length === 0) {
        finalAnswer = assembled.content.trim() || 'Je n\'ai pas trouvé de réponse exploitable.';
        yield { kind: 'done', answer: finalAnswer, pendingActions };
        return;
      }

      for (const call of assembled.tool_calls) {
        const args = parseToolArguments(call.function.arguments);
        yield { kind: 'tool_start', id: call.id, name: call.function.name, args };
        try {
          const execution = await executeAiTool(userId, call.function.name, args);
          if (execution.pendingAction) pendingActions.push(execution.pendingAction);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(execution.result),
          });
          yield {
            kind: 'tool_result',
            id: call.id,
            name: call.function.name,
            ok: true,
            pendingAction: execution.pendingAction,
            preview: previewResult(execution.result),
          };
        } catch (e) {
          const detail = (e as Error).message;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: detail }),
          });
          yield { kind: 'tool_result', id: call.id, name: call.function.name, ok: false, preview: detail };
        }
      }
    }

    yield { kind: 'done', answer: 'J\'ai atteint la limite d\'étapes pour cette demande. Essaie une consigne plus précise.', pendingActions };
  } catch (e) {
    if (e instanceof AiProviderError) {
      yield { kind: 'error', error: { kind: e.kind, message: e.message, detail: e.detail } };
    } else {
      yield { kind: 'error', error: { kind: 'network', message: (e as Error).message, detail: '' } };
    }
  }
}

interface StreamDelta {
  contentDelta?: string;
  toolCallDelta?: { index: number; id?: string; name?: string; argsDelta?: string };
}

async function* streamChatCompletion(messages: AiMessage[], cfg: AiRuntimeConfig): AsyncGenerator<StreamDelta> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        tools: aiToolDefinitions,
        tool_choice: 'auto',
        temperature: 0.2,
        stream: true,
      }),
    });
  } catch (e) {
    throw new AiProviderError('network', 502, `Impossible de joindre le fournisseur IA: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error('[ai] provider error (stream)', { status: res.status, model: cfg.model, body: body.slice(0, 500) });
    throw classifyUpstream(res.status, body);
  }
  if (!res.body) throw new AiProviderError('upstream', 502, 'Pas de body sur la réponse streaming.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by blank lines; data: lines may span multiple.
    let lineEnd: number;
    while ((lineEnd = buffer.indexOf('\n')) >= 0) {
      const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, '');
      buffer = buffer.slice(lineEnd + 1);
      if (!rawLine.startsWith('data:')) continue;
      const data = rawLine.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const payload = JSON.parse(data);
        const choice = payload?.choices?.[0];
        const delta = choice?.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { contentDelta: delta.content };
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            yield {
              toolCallDelta: {
                index: Number(tc.index ?? 0),
                id: tc.id,
                name: tc.function?.name,
                argsDelta: tc.function?.arguments,
              },
            };
          }
        }
      } catch {
        /* malformed chunk — skip */
      }
    }
  }
}

function mergeToolCallDelta(calls: ToolCall[], delta: { index: number; id?: string; name?: string; argsDelta?: string }) {
  while (calls.length <= delta.index) {
    calls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
  }
  const target = calls[delta.index]!;
  if (delta.id) target.id = delta.id;
  if (delta.name) target.function.name = delta.name;
  if (delta.argsDelta) target.function.arguments += delta.argsDelta;
}

function previewResult(result: unknown): string {
  try {
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  } catch {
    return '';
  }
}

async function createChatCompletion(messages: AiMessage[], cfg: AiRuntimeConfig, options: { noTools?: boolean } = {}) {
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

function initialMessages(context: { month: string; currency: string }, history: AiChatHistoryMessage[], message: string): AiMessage[] {
  const trimmedHistory = history
    .filter((entry) => entry.content.trim())
    .slice(-10)
    .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 2000) }) satisfies AiMessage);
  return [
    { role: 'system', content: systemPrompt(context) },
    ...trimmedHistory,
    { role: 'user', content: message },
  ];
}

function systemPrompt(context: { month: string; currency: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'Tu es l\'assistant financier intégré à Suzanne.',
    'Réponds en français, de façon concise et concrète.',
    'Utilise systématiquement les tools pour consulter les données ou préparer des actions, ne devine jamais des chiffres ou des identifiants.',
    '',
    'LECTURE : list_accounts, list_account_snapshots, list_categories, list_tags, list_recurring, list_goals, get_goal_progress, list_budgets, list_rules, get_dashboard_summary, search_transactions.',
    'list_recurring fournit next_occurrence (prochaine échéance) et monthly_equivalent (coût/revenu mensuel moyen) : utilise-les pour les questions sur les abonnements et le total des récurrents.',
    'list_goals et get_goal_progress fournissent progress_pct et remaining (montant restant) : utilise-les pour les questions sur les objectifs d\'épargne.',
    'Pour analyser un écart de patrimoine, consulte toujours les comptes, les snapshots et les transferts autour des dates concernées.',
    'Si l\'utilisateur répond par une validation courte ("oui", "vas-y", "ok"), utilise l\'historique de conversation pour reprendre la tâche précédente et relance les tools nécessaires.',
    '',
    'ÉCRITURE : tu peux créer, modifier et supprimer presque tout via les tools propose_* (transactions, catégories, tags, objectifs, récurrents, budgets, règles, et versements sur objectifs).',
    'Chaque propose_* prépare l\'action et la renvoie pour confirmation : ne prétends JAMAIS qu\'une donnée a été créée ou modifiée. Décris ce que tu vas faire et explique que l\'utilisateur doit cliquer "Confirmer".',
    'Pour catégoriser BEAUCOUP de transactions sans catégorie, ne procède PAS une par une : regroupe par marchand récurrent et utilise propose_create_rules (une entrée {pattern, category_id} par marchand). À la confirmation, les règles sont créées ET appliquées à toutes les transactions correspondantes d\'un coup. Pour un cas isolé, propose_update_transaction (transaction_id + category_id) suffit.',
    'search_transactions renvoie total, returned et has_more : si has_more est vrai, tu n\'as pas tout vu — affine la recherche ou augmente limit, et ne conclus jamais que c\'est terminé sur un résultat tronqué.',
    'Toujours vérifier l\'existence et l\'id réel des entités avant d\'appeler un propose_* (utilise les list_*).',
    'Pour les suppressions, redemande explicitement avant d\'appeler propose_delete_*.',
    '',
    `Date du jour: ${today}. Mois affiché: ${context.month}. Devise affichée: ${context.currency}.`,
  ].join('\n');
}
