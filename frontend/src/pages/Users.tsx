import { FormEvent } from 'react';
import { Users as UsersIcon } from 'lucide-react';
import type { User } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { Panel } from '../components/Panel';
import { Row } from '../components/Row';

import type { Run } from '../lib/run';

export function UsersPage({ users, currentUserId, run }: { users: User[]; currentUserId: number | null; run: Run }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createUser({ name: String(data.get('name')) }), 'Utilisateur créé');
    event.currentTarget.reset();
  };

  return (
    <section className="split">
      <Panel title="Nouvel utilisateur">
        <form className="form" onSubmit={submit}>
          <label>Nom<input name="name" required placeholder="Ex: Démo, Suzanne..." /></label>
          <button className="primary"><UsersIcon size={16} /> Créer</button>
        </form>
      </Panel>
      <Panel title="Utilisateurs">
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
