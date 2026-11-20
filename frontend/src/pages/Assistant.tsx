import { Dispatch, KeyboardEvent, MutableRefObject, SetStateAction, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, KeyRound, Loader2, RotateCcw, Send, Sparkles, Wand2, Wrench, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AiPendingAction } from '@suzanne/shared';
import { api, type AiChatHistoryMessage, type AiHealthStatus } from '../lib/api';
import type { Run } from '../lib/run';
import { Modal } from '../components/Modal';
import { WELCOME, type ChatMessage, type ToolEvent } from '../lib/assistantState';
import '../styles/pages/assistant.css';
import { useTranslation } from 'react-i18next';

// Catalogue lisible des capacités de l'assistant, affiché dans la modale
// « Que puis-je demander ? ». Reflète les tools de backend/src/ai/tools.ts.
const CAPABILITIES: Array<{
  title: string;
  note: string;
  items: string[];
  examples: string[];
}> = [
  {
    title: 'Analyser & consulter',
    note: 'Exécuté immédiatement, en lecture seule.',
    items: [
      'Comptes, soldes et snapshots',
      'Transactions (recherche par mois, type, catégorie, tag, non-catégorisées…)',
      'Catégories, tags et règles d’auto-catégorisation',
      'Budgets mensuels',
      'Récurrents : prochaine échéance et coût mensuel équivalent',
      'Objectifs d’épargne : progression et montant restant',
      'Résumé financier d’un mois (revenus, dépenses, net)',
    ],
    examples: [
      'Combien j’ai dépensé ce mois-ci en courses ?',
      'Quels sont mes abonnements et leur coût mensuel total ?',
      'Quelle est la prochaine échéance de mes récurrents ?',
      'Où en est mon objectif vacances ?',
      'Montre mes transactions non catégorisées de ce mois.',
    ],
  },
  {
    title: 'Créer & modifier',
    note: 'L’assistant prépare l’action ; rien n’est enregistré sans ton clic « Confirmer ».',
    items: [
      'Transactions : créer, modifier, supprimer, catégoriser',
      'Catégories, tags : créer, modifier, supprimer',
      'Objectifs : créer, modifier, supprimer, verser',
      'Récurrents : créer, modifier, supprimer',
      'Budgets : définir, modifier, supprimer',
      'Règles d’auto-catégorisation : créer, supprimer',
    ],
    examples: [
      'Crée une dépense de 12,50 € aujourd’hui pour le déjeuner.',
      'Catégorise mes transactions Carrefour en Courses.',
      'Crée un objectif d’épargne Vacances de 2000 €.',
      'Ajoute un budget de 300 € pour Restaurants ce mois-ci.',
    ],
  },
];

export function Assistant({ userId, month, currency, run, messages, setMessages, streaming, setStreaming, abortRef }: {
  userId: number;
  month: string;
  currency: string;
  run: Run;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  // Streaming state and the abort controller are owned by App so that leaving
  // the tab mid-stream keeps the cancel button wired up on return.
  streaming: boolean;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  abortRef: MutableRefObject<AbortController | null>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [health, setHealth] = useState<AiHealthStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    // Mobile / tablette : le fil n'a pas de défilement propre (la page défile,
    // le champ de saisie reste collé en bas) → on amène le dernier message.
    if (window.matchMedia?.('(max-width: 1023px)').matches && messages.length > 1) {
      el.lastElementChild?.scrollIntoView({ block: 'end' });
    }
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

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || streaming) return;
    const userId2 = Date.now();
    const assistantId = userId2 + 1;
    const history: AiChatHistoryMessage[] = messages
      .filter((msg) => msg.content.trim() && msg.content !== WELCOME.content)
      .slice(-10)
      .map((msg) => ({ role: msg.role, content: msg.content }));
    setMessages((current) => [
      ...current,
      { id: userId2, role: 'user', content: message },
      { id: assistantId, role: 'assistant', content: '', streaming: true, tools: [] },
    ]);
    setDraft('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let receivedTerminalEvent = false;
    try {
      for await (const event of api.aiChatStream(userId, { message, month, currency, history }, controller.signal)) {
        if (event.kind === 'token') {
          setMessages((current) => current.map((msg) =>
            msg.id === assistantId ? { ...msg, content: msg.content + event.text } : msg,
          ));
        } else if (event.kind === 'tool_start') {
          upsertTool(assistantId, { id: event.id, name: event.name, status: 'running' });
        } else if (event.kind === 'tool_result') {
          upsertTool(assistantId, { id: event.id, name: event.name, status: event.ok ? 'ok' : 'error', preview: event.preview });
        } else if (event.kind === 'done') {
          receivedTerminalEvent = true;
          updateAssistant(assistantId, {
            content: event.answer,
            streaming: false,
            actions: event.pendingActions,
          });
        } else if (event.kind === 'error') {
          receivedTerminalEvent = true;
          updateAssistant(assistantId, {
            content: `❌ ${event.error.message}`,
            streaming: false,
          });
        }
      }
      if (!receivedTerminalEvent && !controller.signal.aborted) {
        updateAssistant(assistantId, {
          content: '❌ La réponse IA s’est interrompue avant la fin. Réessaie dans quelques secondes.',
          streaming: false,
        });
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
      (result) => {
        // Bulk rule application reports how many transactions it classified.
        const r = (result as { result?: { categorized?: number; rules_created?: number } }).result;
        if (r && typeof r.categorized === 'number') {
          return r.categorized > 0
            ? `${r.categorized} transaction${r.categorized > 1 ? 's' : ''} catégorisée${r.categorized > 1 ? 's' : ''} via ${r.rules_created} règle${(r.rules_created ?? 0) > 1 ? 's' : ''}`
            : 'Règles créées — aucune transaction sans catégorie à classer';
        }
        return 'Action IA appliquée';
      },
    );
  };

  // Depuis la modale « Capacités » : envoie directement l'exemple choisi, ou,
  // si une réponse est déjà en cours, le place dans le champ pour plus tard.
  const askExample = (question: string) => {
    setCapsOpen(false);
    if (streaming) {
      setDraft(question);
      textareaRef.current?.focus();
    } else {
      void send(question);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  const healthTone = health?.ok ? 'ok' : health?.configured === false ? 'warn' : health?.ok === false ? 'err' : '';

  return (
    <section className="ai">
      <header className="ai-head">
        <div className="ai-head-text">
          <p>
            <span className={`ai-dot ${healthTone}`} aria-hidden="true" />
            {health
              ? health.configured
                ? health.ok ? `${health.model} · prêt` : `${health.model} · indisponible`
                : 'Clé IA absente'
              : 'Vérification…'}
            <span className="ai-context"> · {month} · {currency}</span>
          </p>
        </div>
        <div className="ai-head-actions">
          <button type="button" className="secondary" onClick={() => setCapsOpen(true)}>
            <Wand2 size={15} /> <span>{t('reglages.assistant.examples')}</span>
          </button>
          <button type="button" className="secondary" onClick={resetConversation} aria-label={t('reglages.assistant.new_conversation')} title={t('reglages.assistant.new_conversation')}>
            <RotateCcw size={15} /> <span className="ai-hide-sm">{t('reglages.assistant.new')}</span>
          </button>
        </div>
      </header>

      {health && !health.ok && (
        <div className={`ai-health ${healthTone}`} role="status">
          <AlertTriangle size={15} />
          <span>
            {!health.configured && <>{t('reglages.assistant.set')} <code>AI_API_KEY</code>  {t('reglages.assistant.on_server_or_in_preferences')}</>}{/* i18n-ignore */}
            {health.configured && health.error && (
              <>
                {health.error.message} <em>({health.error.kind})</em>
                {health.error.kind === 'insufficient_quota' && (
                  <> — <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer nofollow">{t('reglages.assistant.openai_billing')}</a></>
                )}
              </>
            )}
            <span className="ai-endpoint"> · {health.baseUrl}</span>
          </span>
          {/* Clé absente ou refusée : accès direct au réglage (Réglages › Préférences). */}
          {(!health.configured || health.error?.kind === 'auth' || health.error?.kind === 'model_unavailable') && (
            <button type="button" className="secondary ai-configure" onClick={() => navigate('/settings#assistant')}>
              <KeyRound size={14} /> {t('reglages.assistant.configure')}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={refreshHealth} disabled={testing}>
            {testing ? <Loader2 className="spin-icon" size={14} /> : null}  {t('reglages.assistant.retry')}
          </button>
        </div>
      )}

      <div className="ai-chat" ref={chatRef} aria-live="polite">
        {messages.map((message) => (
          <article className={`ai-msg ${message.role}`} key={message.id}>
            {message.role === 'assistant' && (
              <div className="ai-avatar" aria-hidden="true"><Sparkles size={15} /></div>
            )}
            <div className="ai-bubble">
              {message.tools && message.tools.length > 0 && (
                <div className="ai-tools">
                  {message.tools.map((tool) => (
                    <div className={`ai-tool ${tool.status}`} key={tool.id}>
                      {tool.status === 'running'
                        ? <Loader2 className="spin-icon" size={12} />
                        : tool.status === 'ok'
                          ? <Check size={12} />
                          : <AlertTriangle size={12} />}
                      <span className="ai-tool-name">{toolLabel(tool.name)}</span>
                      {tool.preview && <span className="ai-tool-preview">{tool.preview}</span>}
                    </div>
                  ))}
                </div>
              )}
              {message.role === 'assistant' ? (
                <div className="ai-md">
                  {message.content
                    ? <SafeMarkdown>{message.content}</SafeMarkdown>
                    : message.streaming
                      ? <span className="ai-thinking"><Loader2 className="spin-icon" size={14} />  {t('reglages.assistant.thinking')}</span>
                      : null}
                  {message.streaming && message.content && <span className="ai-cursor">▍</span>}
                </div>
              ) : (
                <p>{message.content}</p>
              )}
              {message.actions && message.actions.length > 0 && (
                <div className="ai-actions">
                  {message.actions.map((action, index) => (
                    <div className="ai-action" key={`${action.type}-${index}`}>
                      <strong>{action.label}</strong>
                      <div>
                        <button className="primary" type="button" onClick={() => confirmAction(message.id, index, action)}>
                          <Check size={16} />  {t('reglages.assistant.confirm')}
                        </button>
                        <button className="secondary" type="button" onClick={() => dismissAction(message.id, index)}>
                          <X size={16} />  {t('reglages.assistant.skip')}
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

      <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('reglages.assistant.how_much_did_i_spend')}
          aria-label={t('reglages.assistant.your_question')}
          rows={1}
        />
        {streaming ? (
          <button type="button" className="secondary ai-send" onClick={cancel} aria-label={t('reglages.assistant.stop')}>
            <X size={18} /> <span className="ai-hide-sm">{t('reglages.assistant.stop')}</span>
          </button>
        ) : (
          <button className="primary accent ai-send" type="submit" disabled={!draft.trim()} aria-label={t('reglages.assistant.send')}>
            <Send size={17} /> <span className="ai-hide-sm">{t('reglages.assistant.send')}</span>
          </button>
        )}
      </form>
      <p className="ai-hint">{t('reglages.assistant.live_reading_any_change_asks')}</p>

      {capsOpen && (
        <Modal title={t('reglages.assistant.what_can_i_ask')} onClose={() => setCapsOpen(false)} wide>
          <div className="assistant-caps">
            <p className="panel-note">{t('reglages.assistant.click_example_to_run_it')}</p>
            {CAPABILITIES.map((group) => (
              <div className="assistant-caps-group" key={group.title}>
                <h3>{group.title}</h3>
                <p className="panel-note">{group.note}</p>
                <ul className="assistant-caps-list">
                  {group.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <div className="assistant-caps-examples">
                  {group.examples.map((example) => (
                    <button type="button" className="assistant-example" key={example} onClick={() => askExample(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---- Rendu Markdown sûr ---------------------------------------------------
// Le texte vient d'un modèle (donc potentiellement d'une injection de prompt
// via les libellés de transactions) : pas d'images (pas de requêtes sortantes
// ni de pixels espions), pas de HTML brut, et seuls les liens http(s) sont
// cliquables — ouverts dans un nouvel onglet, sans referrer ni suivi.
export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span className="ai-link-text">{children}</span>;
    return <a href={safe} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
  },
  img: () => null,
};

function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_COMPONENTS}
      disallowedElements={['img', 'image']}
      skipHtml
    >
      {children}
    </ReactMarkdown>
  );
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_accounts: 'Lecture des comptes',
    list_account_snapshots: 'Lecture des snapshots',
    list_categories: 'Lecture des catégories',
    list_tags: 'Lecture des tags',
    list_recurring: 'Lecture des récurrents',
    list_goals: 'Lecture des objectifs',
    list_budgets: 'Lecture des budgets',
    list_rules: 'Lecture des règles',
    get_dashboard_summary: 'Résumé du dashboard',
    search_transactions: 'Recherche de transactions',
    propose_create_rules: 'Préparation des règles de catégorisation',
  };
  if (labels[name]) return labels[name]!;
  if (name.startsWith('propose_create_')) return `Préparation création ${name.slice('propose_create_'.length)}`;
  if (name.startsWith('propose_update_')) return `Préparation modification ${name.slice('propose_update_'.length)}`;
  if (name.startsWith('propose_delete_')) return `Préparation suppression ${name.slice('propose_delete_'.length)}`;
  if (name.startsWith('propose_')) return `Préparation : ${name.slice('propose_'.length)}`;
  return name;
}
