import { FormEvent, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '@suzanne/shared';
import { api } from '../lib/api';
import { localeTag } from '../i18n';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';

export function UsersPage({ users, currentUserId, run }: { users: User[]; currentUserId: number | null; run: Run }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) return;
    void run(() => api.createUser({ name }), t('Profil créé')).then((ok) => { if (ok) setCreating(false); });
  };

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{users.length}</strong> {users.length > 1 ? t('profils') : t('profil')}
          <span className="st-sub">{t('chacun a ses comptes et ses opérations')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('Nouveau profil')}
        </button>
      </div>

      <div className="panel st-list">
        {users.length === 0 && <p className="empty">{t('Aucun profil.')}</p>}
        <ul className="st-people">
          {users.map((u) => {
            const active = u.id === currentUserId;
            return (
              <li key={u.id} className={active ? 'active' : undefined}>
                <span className="st-avatar" aria-hidden="true">{u.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <span className="st-person">
                  <strong title={u.name}>{u.name}</strong>
                  <small>{t('Créé le')} {new Date(u.created_at).toLocaleDateString(localeTag())}</small>
                </span>
                {active && <span className="st-badge">{t('Profil actif')}</span>}
                <RowMenu items={[{
                  label: t('Supprimer le profil'), icon: <Trash2 />, danger: true,
                  confirm: t('Supprimer {{name}} et toutes ses données ?', { name: u.name }),
                  onSelect: () => void run(() => api.deleteUser(u.id), t('Profil supprimé')),
                }]} />
              </li>
            );
          })}
        </ul>
      </div>

      {creating && (
        <Modal title={t('Nouveau profil')} onClose={() => setCreating(false)}>
          <form className="form st-form" onSubmit={submit}>
            <label className="full">{t('Nom')}<input name="name" required maxLength={60} placeholder={t('Ex: Démo, Famille...')} autoComplete="off" /></label>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>{t('Annuler')}</button>
              <button className="primary">{t('Créer')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
