import { KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, Send, Sparkles, Wrench, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AiPendingAction } from '@suzanne-lite/shared';
import { api, type AiHealthStatus } from '../lib/api';
import type { Run } from '../lib/run';

interface ToolEvent {
  id: string;
  name: string;
  status: 'running' | 'ok' | 'error';
  preview?: string;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  actions?: AiPendingAction[];
  tools?: ToolEvent[];
}

const WELCOME: ChatMessage = {
  id: 1,
  role: 'assistant',
  content: 'Je peux analyser tes finances, rechercher des transactions, créer / modifier / supprimer (catégories, tags, objectifs, récurrents, budgets, règles, transactions). Toute écriture demande confirmation.',
};

export function Assistant({ userId, month, currency, run }: { userId: number; month: string; currency: string; run: Run }) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [health, setHealth] = useState<AiHealthStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshHealth = async () => {
    setTesting(true);
    try {
      setHealth(await api.aiHealth());
    } catch (e) {
      setHealth({ configured: false, model: '?', baseUrl: '?', provider: '?', ok: false, error: { kind: 'network', message: (e as Error).message, detail: '' } });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => { void refreshHealth(); }, []);

  // Auto-scroll the chat to the bottom whenever messages change or content
  // streams in. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Autosize the composer textarea up to a sensible max height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  const updateAssistant = (id: number, patch: Partial<ChatMessage>) => {
    setMessages((current) => current.map((msg) => msg.id === id ? { ...msg, ...patch } : msg));
  };

  const upsertTool = (id: number, tool: ToolEvent) => {
    setMessages((current) => current.map((msg) => {
      if (msg.id !== id) return msg;
      const next = [...(msg.tools ?? [])];
      const idx = next.findIndex((t) => t.id === tool.id);
      if (idx >= 0) next[idx] = tool; else next.push(tool);
      return { ...msg, tools: next };
    }));
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || streaming) return;
    const userId2 = Date.now();
    const assistantId = userId2 + 1;
    setMessages((current) => [
      ...current,
      { id: userId2, role: 'user', content: message },
      { id: assistantId, role: 'assistant', content: '', streaming: true, tools: [] },
    ]);
    setDraft('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for await (const event of api.aiChatStream(userId, { message, month, currency }, controller.signal)) {
        if (event.kind === 'token') {
          setMessages((current) => current.map((msg) =>
            msg.id === assistantId ? { ...msg, content: msg.content + event.text } : msg,
          ));
        } else if (event.kind === 'tool_start') {
          upsertTool(assistantId, { id: event.id, name: event.name, status: 'running' });
        } else if (event.kind === 'tool_result') {
          upsertTool(assistantId, { id: event.id, name: event.name, status: event.ok ? 'ok' : 'error', preview: event.preview });
        } else if (event.kind === 'done') {
          updateAssistant(assistantId, {
            content: event.answer,
            streaming: false,
            actions: event.pendingActions,
          });
        } else if (event.kind === 'error') {
          updateAssistant(assistantId, {
            content: `❌ ${event.error.message}`,
            streaming: false,
          });
        }
      }
    } catch (e) {
      updateAssistant(assistantId, {
        content: `❌ ${(e as Error).message}`,
        streaming: false,
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((current) => current.map((msg) =>
      msg.streaming ? { ...msg, streaming: false, content: msg.content || '(interrompu)' } : msg,
    ));
  };

  const resetConversation = () => {
    if (streaming) cancel();
    setMessages([{ ...WELCOME, id: Date.now() }]);
  };

  const dismissAction = (messageId: number, actionIndex: number) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message;
      return { ...message, actions: message.actions?.filter((_, index) => index !== actionIndex) };
    }));
  };

  const confirmAction = (messageId: number, actionIndex: number, action: AiPendingAction) => {
    run(
      async () => {
        const result = await api.confirmAiAction(userId, action);
        dismissAction(messageId, actionIndex);
        return result;
      },
      'Action IA appliquée',
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <section className="assistant-layout">
      <div className="panel assistant-panel">
        <div className="panel-header">
          <div>
            <h2>Assistant IA</h2>
            <p className="panel-note">Lecture des données en direct. Écriture uniquement après confirmation.</p>
          </div>
          <div className="assistant-header-actions">
            <span className="assistant-context">{month} · {currency}</span>
            <button type="button" className="ghost-button" onClick={resetConversation} title="Nouvelle conversation">
              <RotateCcw size={14} /> Nouvelle conversation
            </button>
          </div>
        </div>

        <div className={`assistant-health ${health?.ok ? 'ok' : health?.configured === false ? 'warn' : health?.ok === false ? 'err' : ''}`}>
          {health ? (
            <>
              <span><strong>Modèle :</strong> {health.model} · <strong>endpoint :</strong> {health.baseUrl}</span>
              <span>
                {!health.configured && <>Clé absente — définir <code>AI_API_KEY</code> côté backend ou via Paramètres.</>}
                {health.configured && health.ok && <>Connexion OK.</>}
                {health.configured && health.ok === false && health.error && (
                  <>
                    <AlertTriangle size={14} /> {health.error.message} <em>({health.error.kind})</em>
                    {health.error.kind === 'insufficient_quota' && (
                      <> — <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">ouvrir la facturation OpenAI</a></>
                    )}
                  </>
                )}
              </span>
              <button type="button" className="ghost-button" onClick={refreshHealth} disabled={testing}>
                {testing ? <Loader2 className="spin-icon" size={14} /> : null} Tester la clé
              </button>
            </>
          ) : (
            <span>Vérification de la configuration IA…</span>
          )}
        </div>

        <div className="assistant-chat" ref={chatRef} aria-live="polite">
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <div className="assistant-avatar" aria-hidden="true">
                {message.role === 'assistant' ? <Sparkles size={16} /> : null}
              </div>
              <div className="assistant-bubble">
                {message.tools && message.tools.length > 0 && (
                  <div className="assistant-tools">
                    {message.tools.map((tool) => (
                      <div className={`assistant-tool ${tool.status}`} key={tool.id}>
                        {tool.status === 'running'
                          ? <Loader2 className="spin-icon" size={12} />
                          : tool.status === 'ok'
                            ? <Check size={12} />
                            : <AlertTriangle size={12} />}
                        <span className="assistant-tool-name">{toolLabel(tool.name)}</span>
                        {tool.preview && <span className="assistant-tool-preview">{tool.preview}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {message.role === 'assistant' ? (
                  <div className="assistant-markdown">
                    {message.content
                      ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      : message.streaming
                        ? <span className="assistant-thinking"><Loader2 className="spin-icon" size={14} /> Analyse en cours…</span>
                        : null}
                    {message.streaming && message.content && <span className="assistant-cursor">▍</span>}
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
                {message.actions && message.actions.length > 0 && (
                  <div className="assistant-actions">
                    {message.actions.map((action, index) => (
                      <div className="assistant-action" key={`${action.type}-${index}`}>
                        <strong>{action.label}</strong>
                        <div>
                          <button className="secondary" type="button" onClick={() => confirmAction(message.id, index, action)}>
                            <Check size={16} /> Confirmer
                          </button>
                          <button className="ghost-button" type="button" onClick={() => dismissAction(message.id, index)}>
                            <X size={16} /> Ignorer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <form className="assistant-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ex: Combien j'ai dépensé ce mois-ci en courses ? (Cmd/Ctrl+Entrée pour envoyer)"
            rows={2}
          />
          {streaming ? (
            <button type="button" className="secondary" onClick={cancel}>
              <X size={16} /> Stopper
            </button>
          ) : (
            <button className="primary" type="submit" disabled={!draft.trim()}>
              <Send size={16} /> Envoyer
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_accounts: 'Lecture des comptes',
    list_categories: 'Lecture des catégories',
    list_tags: 'Lecture des tags',
    list_recurring: 'Lecture des récurrents',
    list_goals: 'Lecture des objectifs',
    list_budgets: 'Lecture des budgets',
    list_rules: 'Lecture des règles',
    get_dashboard_summary: 'Résumé du dashboard',
    search_transactions: 'Recherche de transactions',
  };
  if (labels[name]) return labels[name]!;
  if (name.startsWith('propose_create_')) return `Préparation création ${name.slice('propose_create_'.length)}`;
  if (name.startsWith('propose_update_')) return `Préparation modification ${name.slice('propose_update_'.length)}`;
  if (name.startsWith('propose_delete_')) return `Préparation suppression ${name.slice('propose_delete_'.length)}`;
  if (name.startsWith('propose_')) return `Préparation : ${name.slice('propose_'.length)}`;
  return name;
}
