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
    void run(() => api.createUser({ name }), t('reglages.profile_created')).then((ok) => { if (ok) setCreating(false); });
  };

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{users.length}</strong> {users.length > 1 ? t('reglages.profiles') : t('reglages.profile')}
          <span className="st-sub">{t('reglages.each_with_their_own_accounts')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('reglages.new_profile')}
        </button>
      </div>

      <div className="panel st-list">
        {users.length === 0 && <p className="empty">{t('reglages.no_profiles')}</p>}
        <ul className="st-people">
          {users.map((u) => {
            const active = u.id === currentUserId;
            return (
              <li key={u.id} className={active ? 'active' : undefined}>
                <span className="st-avatar" aria-hidden="true">{u.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <span className="st-person">
                  <strong title={u.name}>{u.name}</strong>
                  <small>{t('reglages.created_on')} {new Date(u.created_at).toLocaleDateString(localeTag())}</small>
                </span>
                {active && <span className="st-badge">{t('reglages.active_profile')}</span>}
                <RowMenu items={[{
                  label: t('reglages.delete_profile'), icon: <Trash2 />, danger: true,
                  confirm: t('reglages.delete_name_and_all_their', { name: u.name }),
                  onSelect: () => void run(() => api.deleteUser(u.id), t('reglages.profile_deleted')),
                }]} />
              </li>
            );
          })}
        </ul>
      </div>

      {creating && (
        <Modal title={t('reglages.new_profile')} onClose={() => setCreating(false)}>
          <form className="form st-form" onSubmit={submit}>
            <label className="full">{t('commun.name')}<input name="name" required maxLength={60} placeholder={t('reglages.e_g_demo_family')} autoComplete="off" /></label>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>{t('commun.cancel')}</button>
              <button className="primary">{t('reglages.create')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
