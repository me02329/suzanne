import { useState } from 'react';
import { Modal } from './Modal';
import { setAppToken } from '../lib/authToken';
import { useTranslation } from 'react-i18next';

// Affiché quand le backend répond 401 : il exige un APP_TOKEN. L'utilisateur
// saisit le secret partagé, qui est persisté puis renvoyé sur chaque requête.
export function TokenModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setAppToken(value);
    onSaved();
  };

  return (
    <Modal title={t('reglages.token_modal.access_token_required')} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="panel-note">
          
          {t('reglages.token_modal.this_server_is_protected_by')}
        </p>
        <label>
          
          {t('reglages.token_modal.token')}
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="APP_TOKEN" /* i18n-ignore */
          />
        </label>
        <button className="primary" disabled={!value.trim()}>{t('reglages.token_modal.confirm')}</button>
      </form>
    </Modal>
  );
}
