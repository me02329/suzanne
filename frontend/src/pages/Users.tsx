import { FormEvent } from 'react';
import { ChevronDown, ChevronUp, Plus, Users as UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '@suzanne/shared';
import { api } from '../lib/api';
import { localeTag } from '../i18n';
import { usePersistedState } from '../lib/storage';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';
import { Row } from '../components/Row';

import type { Run } from '../lib/run';

export function UsersPage({ users, currentUserId, run }: { users: User[]; currentUserId: number | null; run: Run }) {
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = usePersistedState<boolean>('users_add_open', users.length === 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createUser({ name: String(data.get('name')) }), t('Utilisateur créé'));
    event.currentTarget.reset();
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> {t('Nouvel utilisateur')}</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">{t('Nom')}<input name="name" required placeholder={t('Ex: Démo, Famille...')} /></label>
              <button className="primary"><UsersIcon size={16} /> {t('Créer')}</button>
            </form>
          </Collapsible>
      </div>
      <Panel title={t('Utilisateurs')} icon={<UsersIcon />}>
        {users.map((u) => (
          <Row
            key={u.id}
            title={`${u.name}${u.id === currentUserId ? ` · ${t('actif')}` : ''}`}
            detail={`${t('Créé le')} ${new Date(u.created_at).toLocaleDateString(localeTag())}`}
            onDelete={() => {
              if (window.confirm(t('Supprimer {{name}} et toutes ses données ?', { name: u.name }))) {
                void run(() => api.deleteUser(u.id), t('Utilisateur supprimé'));
              }
            }}
          />
        ))}
        {users.length === 0 && <p className="empty">{t('Aucun utilisateur.')}</p>}
      </Panel>
    </section>
  );
}
