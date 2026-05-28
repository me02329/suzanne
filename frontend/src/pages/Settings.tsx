import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import { api, type AiSettings } from '../lib/api';
import { Panel } from '../components/Panel';

const SOURCE_LABELS: Record<string, string> = {
  database: 'Configurée depuis cette page',
  environment: 'Définie via variable d\'environnement',
  mixed: 'Mix DB + variable d\'environnement',
  none: 'Aucune source — clé manquante',
};

export function Settings() {
  const [data, setData] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    try {
      setData(await api.aiSettings());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const apiKey = String(formData.get('api_key') ?? '').trim();
      const next = await api.updateAiSettings({
        api_key: apiKey.length > 0 ? apiKey : undefined,
        model: String(formData.get('model') ?? '').trim() || null,
        base_url: String(formData.get('base_url') ?? '').trim() || null,
        provider: String(formData.get('provider') ?? '').trim() || null,
      });
      setData(next);
      setNotice('Paramètres IA enregistrés.');
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!window.confirm('Supprimer la clé API stockée ?')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      setData(await api.updateAiSettings({ api_key: null }));
      setNotice('Clé supprimée. L\'app retombe sur AI_API_KEY (env) si présente.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>;
  if (!data) return <p className="empty">Impossible de charger les paramètres.</p>;

  return (
    <section className="stack">
      <Panel title="Assistant IA">
        <p className="panel-note">
          Configure ici la clé API et le modèle utilisés par l'assistant. Les valeurs définies depuis cette page
          ont priorité sur les variables d'environnement <code>AI_API_KEY</code> / <code>AI_MODEL</code> / <code>AI_BASE_URL</code>.
        </p>

        <div className={`assistant-health ${data.configured ? 'ok' : 'warn'}`}>
          <span>
            {data.configured
              ? <><CheckCircle2 size={14} /> Clé API présente</>
              : <>Aucune clé API configurée</>}
          </span>
          <span>{SOURCE_LABELS[data.source] ?? data.source}</span>
          <span><strong>Modèle :</strong> {data.model}</span>
          <span><strong>Endpoint :</strong> {data.base_url}</span>
        </div>

        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        <form className="form" onSubmit={submit}>
          <label className="full">Clé API
            <input
              name="api_key"
              type="password"
              autoComplete="off"
              placeholder={data.has_key ? '••••••••••••••••• (laisse vide pour ne pas changer)' : 'sk-...'}
            />
          </label>
          <label>Modèle<input name="model" defaultValue={data.model} placeholder="gpt-4.1-mini" /></label>
          <label>Provider<input name="provider" defaultValue={data.provider} placeholder="openai" /></label>
          <label className="full">Endpoint
            <input
              name="base_url"
              type="url"
              defaultValue={data.base_url}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? <Loader2 className="spin-icon" size={16} /> : <Save size={16} />} Enregistrer
          </button>
          {data.has_key && (
            <button type="button" className="secondary" onClick={clearKey} disabled={saving}>
              <Trash2 size={16} /> Effacer la clé stockée
            </button>
          )}
        </form>
      </Panel>

      <Panel title="Comment obtenir une clé ?">
        <p className="panel-note">
          <KeyRound size={14} /> OpenAI : <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a> — modèle conseillé : <code>gpt-4.1-mini</code> (peu cher, sait utiliser les tools).
        </p>
        <p className="panel-note">
          Tu peux aussi viser un endpoint compatible OpenAI (Anthropic via proxy, Ollama local sur <code>http://localhost:11434/v1</code>, etc.) — ajuste l'endpoint.
        </p>
      </Panel>
    </section>
  );
}
