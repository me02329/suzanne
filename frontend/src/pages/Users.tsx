import { FormEvent } from 'react';
import { ChevronDown, ChevronUp, Plus, Users as UsersIcon } from 'lucide-react';
import type { User } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { usePersistedState } from '../lib/storage';
import { Panel } from '../components/Panel';
import { Row } from '../components/Row';

import type { Run } from '../lib/run';

export function UsersPage({ users, currentUserId, run }: { users: User[]; currentUserId: number | null; run: Run }) {
  const [addOpen, setAddOpen] = usePersistedState<boolean>('users_add_open', users.length === 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createUser({ name: String(data.get('name')) }), 'Utilisateur créé');
    event.currentTarget.reset();
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvel utilisateur</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Nom<input name="name" required placeholder="Ex: Démo, Famille..." /></label>
              <button className="primary"><UsersIcon size={16} /> Créer</button>
            </form>
          </div>
        )}
      </div>
      <Panel title="Utilisateurs" icon={<UsersIcon />}>
        {users.map((u) => (
          <Row
            key={u.id}
            title={`${u.name}${u.id === currentUserId ? ' · actif' : ''}`}
            detail={`Créé le ${new Date(u.created_at).toLocaleDateString('fr-FR')}`}
            onDelete={() => {
              if (window.confirm(`Supprimer ${u.name} et toutes ses données ?`)) {
                void run(() => api.deleteUser(u.id), 'Utilisateur supprimé');
              }
            }}
          />
        ))}
        {users.length === 0 && <p className="empty">Aucun utilisateur.</p>}
      </Panel>
    </section>
  );
}
