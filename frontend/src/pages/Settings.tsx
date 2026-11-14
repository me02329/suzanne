import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type AiSettings } from '../lib/api';
import { currentLang, setLanguage, type Lang } from '../i18n';
import { HINT_DELAY_OPTIONS, setHintDelay, useHintDelay } from '../lib/prefs';
import '../styles/pages/settings.css';

const SOURCE_LABELS: Record<string, string> = {
  database: 'réglée ici',
  environment: 'variable d’environnement',
  mixed: 'ici + variable d’environnement',
  none: 'aucune clé',
};

export function Settings() {
  const { t } = useTranslation();
  const hintDelay = useHintDelay();
  const [data, setData] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [formKey, setFormKey] = useState(0);

  const load = (next: AiSettings) => {
    setData(next);
    setBaseUrl(next.base_url ?? '');
    setApiKey('');
    setFormKey((k) => k + 1);
  };

  useEffect(() => {
    api.aiSettings()
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Le serveur refuse (400) de changer l'adresse sans nouvelle clé : une clé
  // déjà enregistrée ne doit pas partir vers un autre serveur.
  const urlChanged = data != null && baseUrl.trim() !== (data.base_url ?? '');
  const keyRequired = urlChanged && data?.has_key === true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const formData = new FormData(event.currentTarget);
    const key = apiKey.trim();
    if (keyRequired && !key) {
      setError('Nouvelle adresse : ressaisis la clé API.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.updateAiSettings({
        api_key: key.length > 0 ? key : undefined,
        model: String(formData.get('model') ?? '').trim() || null,
        provider: String(formData.get('provider') ?? '').trim() || null,
        // N'envoyer l'adresse que si elle a changé (sinon le serveur exigerait la clé).
        base_url: urlChanged ? baseUrl.trim() || null : undefined,
      });
      load(next);
      setNotice('Réglages de l’assistant enregistrés.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!window.confirm('Supprimer la clé API enregistrée ?')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      load(await api.updateAiSettings({ api_key: null }));
      setNotice('Clé supprimée. L’assistant utilise AI_API_KEY (serveur) si elle existe.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="st-page st-prefs">
      <section className="panel st-pref">
        <div className="st-pref-head">
          <h2>{t('Langue')}</h2>
          <p>{t('Langue de l’interface, format des nombres et des dates.')}</p>
        </div>
        <label className="st-field">
          <span className="sr-only">{t('Langue')}</span>
          <select value={currentLang()} onChange={(e) => setLanguage(e.target.value as Lang)}>
            <option value="fr">{t('Français')}</option>
            <option value="en">{t('English')}</option>
          </select>
        </label>
      </section>

      <section className="panel st-pref">
        <div className="st-pref-head">
          <h2>{t('Infobulles des catégories')}</h2>
          <p>{t('Délai de survol avant d’afficher la description d’une catégorie (à saisir dans Catégories).')}</p>
        </div>
        <label className="st-field">
          <span className="sr-only">{t('Délai des infobulles')}</span>
          <select value={hintDelay} onChange={(e) => setHintDelay(Number(e.target.value))}>
            {HINT_DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
        </label>
      </section>

      <section className="panel st-pref st-pref-ai">
        <div className="st-pref-head">
          <h2>Assistant IA</h2>
          <p>Clé et modèle utilisés par l’assistant. Ces réglages priment sur les variables <code>AI_*</code> du serveur.</p>
        </div>

        {loading && <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>}
        {!loading && !data && <div className="error">{error ?? 'Impossible de charger les réglages.'}</div>}

        {data && (
          <div className="st-ai">
            <div className={data.configured ? 'st-status ok' : 'st-status warn'} role="status">
              {data.configured ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
              <div>
                <strong>{data.configured ? 'Assistant prêt' : 'Aucune clé API'}</strong>
                <span>{data.model} · {SOURCE_LABELS[data.source] ?? data.source}</span>
              </div>
            </div>

            {error && <div className="error">{error}</div>}
            {notice && <div className="notice">{notice}</div>}

            <form className="form st-form" key={formKey} onSubmit={submit}>
              <label className="full">Adresse du fournisseur (endpoint)
                <input
                  name="base_url"
                  type="url"
                  inputMode="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="full">
                <span>Clé API{keyRequired && <em className="st-required"> · obligatoire</em>}</span>
                <input
                  name="api_key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required={keyRequired}
                  aria-describedby="st-key-hint"
                  aria-invalid={keyRequired && !apiKey.trim() ? true : undefined}
                  placeholder={data.has_key && !keyRequired ? '•••••••••••• (vide = inchangée)' : 'sk-…'}
                />
                <small id="st-key-hint" className={keyRequired ? 'st-hint warn' : 'st-hint'}>
                  {keyRequired
                    ? 'Tu changes d’adresse : ressaisis la clé, elle ne sera pas envoyée à un autre serveur sans toi.'
                    : data.has_key ? 'Laisse vide pour garder la clé actuelle.' : 'Ex. OpenAI : platform.openai.com/api-keys'}
                </small>
              </label>
              <label>Modèle<input name="model" defaultValue={data.model} placeholder="gpt-4.1-mini" autoComplete="off" spellCheck={false} /></label>
              <label>Fournisseur<input name="provider" defaultValue={data.provider} placeholder="openai" autoComplete="off" spellCheck={false} /></label>
              <div className="st-form-actions full">
                {data.has_key && (
                  <button type="button" className="secondary" onClick={() => void clearKey()} disabled={saving}>
                    <Trash2 size={16} /> Effacer la clé
                  </button>
                )}
                <button className="primary" type="submit" disabled={saving || (keyRequired && !apiKey.trim())}>
                  {saving && <Loader2 className="spin-icon" size={16} />} Enregistrer
                </button>
              </div>
            </form>

            <details className="st-help">
              <summary>Où trouver une clé ?</summary>
              <p>
                OpenAI : <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>,
                modèle conseillé <code>gpt-4.1-mini</code> (peu cher, sait utiliser les outils).
              </p>
              <p>
                Tout endpoint compatible OpenAI marche aussi : Ollama en local (<code>http://localhost:11434/v1</code>),
                un proxy vers un autre fournisseur, etc.
              </p>
            </details>
          </div>
        )}
      </section>
    </section>
  );
}
