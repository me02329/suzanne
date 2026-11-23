import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type AiSettings } from '../lib/api';
import { currentLang, setLanguage, type Lang } from '../i18n';
import { HINT_DELAY_OPTIONS, setHintDelay, useHintDelay } from '../lib/prefs';
import { TABBAR_MAX, TABBAR_MIN } from '../lib/tabbar';
import { TabbarEditor } from '../components/TabbarEditor';
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

  // Arrivée depuis l'assistant (« Configurer la clé ») : on va droit à la section IA.
  useEffect(() => {
    if (loading || window.location.hash !== '#assistant') return;
    document.getElementById('assistant')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [loading]);

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
          <h2>{t('reglages.language')}</h2>
          <p>{t('reglages.interface_language_number_and_date')}</p>
        </div>
        <label className="st-field">
          <span className="sr-only">{t('reglages.language')}</span>
          <select value={currentLang()} onChange={(e) => setLanguage(e.target.value as Lang)}>
            <option value="fr">{t('reglages.francais')}</option>
            <option value="en">{t('reglages.english')}</option>
          </select>
        </label>
      </section>

      <section className="panel st-pref">
        <div className="st-pref-head">
          <h2>{t('reglages.category_tooltips')}</h2>
          <p>{t('reglages.hover_delay_before_showing_category')}</p>
        </div>
        <label className="st-field">
          <span className="sr-only">{t('reglages.tooltip_delay')}</span>
          <select value={hintDelay} onChange={(e) => setHintDelay(Number(e.target.value))}>
            {HINT_DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
        </label>
      </section>

      <section className="panel st-pref">
        <div className="st-pref-head">
          <h2>{t('reglages.tabbar.title')}</h2>
          <p>{t('reglages.tabbar.hint', { min: TABBAR_MIN, max: TABBAR_MAX })}</p>
        </div>
        <TabbarEditor />
      </section>

      <section className="panel st-pref st-pref-ai" id="assistant">
        <div className="st-pref-head">
          <h2>{t('reglages.settings.ai_assistant')}</h2>
          <p>{t('reglages.settings.key_and_model_used_by')} <code>AI_*</code>  {t('reglages.settings.variables')}</p>{/* i18n-ignore */}
        </div>

        {loading && <p className="empty"><Loader2 className="spin-icon" size={16} />  {t('reglages.settings.loading')}</p>}
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
              <label className="full">{t('reglages.settings.provider_address_endpoint')}
                <input
                  name="base_url"
                  type="url"
                  inputMode="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1" /* i18n-ignore */
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="full">
                <span>{t('reglages.settings.api_key')}{keyRequired && <em className="st-required">  {t('reglages.settings.required')}</em>}</span>
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
              <label>{t('reglages.settings.model')}<input name="model" defaultValue={data.model} placeholder="gpt-4.1-mini" /* i18n-ignore */ autoComplete="off" spellCheck={false} /></label>
              <label>{t('reglages.settings.provider')}<input name="provider" defaultValue={data.provider} placeholder="openai" /* i18n-ignore */ autoComplete="off" spellCheck={false} /></label>
              <div className="st-form-actions full">
                {data.has_key && (
                  <button type="button" className="secondary" onClick={() => void clearKey()} disabled={saving}>
                    <Trash2 size={16} />  {t('reglages.settings.clear_key')}
                  </button>
                )}
                <button className="primary" type="submit" disabled={saving || (keyRequired && !apiKey.trim())}>
                  {saving && <Loader2 className="spin-icon" size={16} />}  {t('reglages.settings.save')}
                </button>
              </div>
            </form>

            <details className="st-help">
              <summary>{t('reglages.settings.where_to_find_key')}</summary>
              <p>
                
                {t('reglages.settings.openai')} <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>{t('reglages.settings.recommended_model')} <code>gpt-4.1-mini</code>  {t('reglages.settings.cheap_can_use_tools')}{/* i18n-ignore */}
              </p>
              <p>
                
                {t('reglages.settings.any_openai_compatible_endpoint_works')}<code>http://localhost:11434/v1</code>{t('reglages.settings.a_proxy_to_another_provider')}{/* i18n-ignore */}
              </p>
            </details>
          </div>
        )}
      </section>
    </section>
  );
}
