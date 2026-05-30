import { useState } from 'react';
import { Modal } from './Modal';
import { setAppToken } from '../lib/authToken';

// Affiché quand le backend répond 401 : il exige un APP_TOKEN. L'utilisateur
// saisit le secret partagé, qui est persisté puis renvoyé sur chaque requête.
export function TokenModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setAppToken(value);
    onSaved();
  };

  return (
    <Modal title="Token d’accès requis" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="panel-note">
          Ce serveur est protégé par un token d’accès. Saisissez-le pour continuer.
        </p>
        <label>
          Token
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="APP_TOKEN"
          />
        </label>
        <button className="primary" disabled={!value.trim()}>Valider</button>
      </form>
    </Modal>
  );
}
