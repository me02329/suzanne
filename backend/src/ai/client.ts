import { config } from '../config.js';
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

export async function runAiChat(userId: number, message: string, context: { month: string; currency: string }): Promise<AiChatResult> {
  if (!config.ai.apiKey) {
    throw new Error('Assistant IA non configuré: définis AI_API_KEY ou OPENAI_API_KEY côté backend.');
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

async function createChatCompletion(messages: AiMessage[]) {
  const res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages,
      tools: aiToolDefinitions,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Erreur provider IA (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json() as ChatResponse;
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('Réponse IA invalide');
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
    'Tu es l’assistant financier intégré à Suzanne Lite.',
    'Réponds en français, de façon concise et concrète.',
    'Utilise les tools pour consulter les données ou préparer des actions.',
    'Ne prétends jamais avoir créé ou modifié une donnée si le tool indique une confirmation requise.',
    'Pour les créations/modifications, explique l’action proposée et demande confirmation.',
    `Date du jour: ${today}. Mois affiché: ${context.month}. Devise affichée: ${context.currency}.`,
  ].join('\n');
}
