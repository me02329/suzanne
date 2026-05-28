import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import type { AiPendingAction } from '@suzanne-lite/shared';
import { api, type AiHealthStatus } from '../lib/api';
import type { Run } from '../lib/run';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  actions?: AiPendingAction[];
}

export function Assistant({ userId, month, currency, run }: { userId: number; month: string; currency: string; run: Run }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: 'Je peux analyser tes finances, rechercher des transactions, préparer une création ou une catégorisation. Les modifications demandent toujours confirmation.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<AiHealthStatus | null>(null);
  const [testing, setTesting] = useState(false);

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

  const send = async () => {
    const message = draft.trim();
    if (!message || loading) return;
    const userMessage: ChatMessage = { id: Date.now(), role: 'user', content: message };
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setLoading(true);
    try {
      const response = await api.aiChat(userId, { message, month, currency });
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.answer,
        actions: response.pendingActions,
      }]);
    } catch (e) {
      setMessages((current) => [...current, {
        id: Date.now() + 1,
        role: 'assistant',
        content: (e as Error).message,
      }]);
    } finally {
      setLoading(false);
    }
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

  return (
    <section className="assistant-layout">
      <div className="panel assistant-panel">
        <div className="panel-header">
          <div>
            <h2>Assistant IA</h2>
            <p className="panel-note">Lecture des données en direct. Écriture uniquement après confirmation.</p>
          </div>
          <span className="assistant-context">{month} · {currency}</span>
        </div>

        <div className={`assistant-health ${health?.ok ? 'ok' : health?.configured === false ? 'warn' : health?.ok === false ? 'err' : ''}`}>
          {health ? (
            <>
              <span><strong>Modèle :</strong> {health.model} · <strong>endpoint :</strong> {health.baseUrl}</span>
              <span>
                {!health.configured && <>Clé absente — définir <code>AI_API_KEY</code> côté backend.</>}
                {health.configured && health.ok && <>Connexion OK.</>}
                {health.configured && health.ok === false && health.error && (
                  <><AlertTriangle size={14} /> {health.error.message} <em>({health.error.kind})</em></>
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

        <div className="assistant-chat" aria-live="polite">
          {messages.map((message) => (
            <article className={`assistant-message ${message.role}`} key={message.id}>
              <div className="assistant-avatar" aria-hidden="true">
                {message.role === 'assistant' ? <Sparkles size={16} /> : null}
              </div>
              <div className="assistant-bubble">
                <p>{message.content}</p>
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
          {loading && (
            <article className="assistant-message assistant">
              <div className="assistant-avatar" aria-hidden="true"><Loader2 className="spin-icon" size={16} /></div>
              <div className="assistant-bubble"><p>Analyse en cours...</p></div>
            </article>
          )}
        </div>

        <form className="assistant-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex: Combien j’ai dépensé ce mois-ci en courses ?"
            rows={3}
          />
          <button className="primary" type="submit" disabled={loading || !draft.trim()}>
            <Send size={16} /> Envoyer
          </button>
        </form>
      </div>
    </section>
  );
}
