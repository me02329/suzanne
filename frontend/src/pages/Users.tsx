import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Loader2, LogIn, Plus, Server, Smartphone, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '@suzanne/shared';
import { api } from '../lib/api';
import { localeTag } from '../i18n';
import { Modal } from '../components/Modal';
import { RowMenu, type RowMenuItem } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import type { Backend } from '../lib/activeProfile';
import { activeBackend, availableBackends, fetchFrom, switchProfile } from '../local/mode';
import { saveBlob } from '../lib/download';
import { stepsFor, transferProfile, type TransferMode, type TransferStep } from '../lib/profileTransfer';
import '../styles/pages/settings.css';

const SIDE_ICON: Record<Backend, typeof Server> = { server: Server, phone: Smartphone };

/** Profils de l'autre côté (app Android) : chargés à part, sans changer de côté. */
function useOtherSide(other: Backend | null) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!other) return;
    setError(null);
    try {
      const response = await fetchFrom(other, '/api/users');
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `Erreur ${response.status}`);
      setUsers(await response.json() as User[]);
    } catch (e) {
      setUsers(null);
      setError((e as Error).message);
    }
  }, [other]);
  useEffect(() => { void load(); }, [load]);
  return { users, error, reload: load };
}

export function UsersPage({ users, currentUserId, run, onOpen }: {
  users: User[]; currentUserId: number | null; run: Run; onOpen: (id: number) => void;
}) {
  const { t } = useTranslation();
  const sides = availableBackends();
  const active = activeBackend();
  const twoSides = sides.length > 1;
  const other = twoSides ? sides.find((s) => s !== active) ?? null : null;
  const otherSide = useOtherSide(other);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<{ user: User; from: Backend } | null>(null);

  const openProfile = (side: Backend, id: number) => (side === active ? onOpen(id) : switchProfile(side, id));

  const refreshAll = () => {
    void otherSide.reload();
    void run(async () => undefined, t('reglages.sides.lists_updated'));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const side = (form.get('side') as Backend | null) ?? active;
    if (!name) return;
    if (side === active) {
      void run(() => api.createUser({ name }), t('reglages.profile_created')).then((ok) => { if (ok) setCreating(false); });
      return;
    }
    void run(async () => {
      const response = await fetchFrom(side, '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `Erreur ${response.status}`);
      await otherSide.reload();
      setCreating(false);
    }, t('reglages.profile_created'));
  };

  const deleteOther = (side: Backend, u: User) => void run(async () => {
    const response = await fetchFrom(side, `/api/users/${u.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Erreur ${response.status}`);
    await otherSide.reload();
  }, t('reglages.profile_deleted'));

  const renderList = (side: Backend, list: User[]) => (
    <ul className="st-people">
      {list.map((u) => {
        const isActive = side === active && u.id === currentUserId;
        const target = sides.find((s) => s !== side);
        const items: RowMenuItem[] = [];
        if (!isActive) items.push({ label: t('reglages.sides.open'), icon: <LogIn />, onSelect: () => openProfile(side, u.id) });
        if (target) items.push({ label: t(target === 'phone' ? 'reglages.sides.move_to_phone' : 'reglages.sides.move_to_server'), icon: <ArrowLeftRight />, onSelect: () => setMoving({ user: u, from: side }) });
        items.push({
          label: t('reglages.delete_profile'), icon: <Trash2 />, danger: true,
          confirm: t('reglages.delete_name_and_all_their', { name: u.name }),
          onSelect: () => (side === active ? void run(() => api.deleteUser(u.id), t('reglages.profile_deleted')) : deleteOther(side, u)),
        });
        return (
          <li key={`${side}-${u.id}`} className={isActive ? 'active' : undefined}>
            <span className="st-avatar" aria-hidden="true">{u.name.trim().charAt(0).toUpperCase() || '?'}</span>
            <span className="st-person">
              <strong title={u.name}>{u.name}</strong>
              <small>{t('reglages.created_on')} {new Date(u.created_at).toLocaleDateString(localeTag())}</small>
            </span>
            {isActive && <span className="st-badge">{t('reglages.active_profile')}</span>}
            <RowMenu items={items} />
          </li>
        );
      })}
    </ul>
  );

  const total = users.length + (otherSide.users?.length ?? 0);
  const ordered: Backend[] = twoSides ? ['server', 'phone'] : [active];

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{total}</strong> {total > 1 ? t('reglages.profiles') : t('reglages.profile')}
          <span className="st-sub">{twoSides ? t('reglages.sides.intro') : t('reglages.each_with_their_own_accounts')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('reglages.new_profile')}
        </button>
      </div>

      {ordered.map((side) => {
        const list = side === active ? users : otherSide.users;
        const Icon = SIDE_ICON[side];
        return (
          <div key={side} className="panel st-list">
            {twoSides && (
              <h3 className="st-side-title">
                <Icon size={16} aria-hidden="true" /> {t(side === 'server' ? 'reglages.sides.server' : 'reglages.sides.phone')}
              </h3>
            )}
            {side !== active && otherSide.error && <p className="empty">{t('reglages.sides.unreachable', { error: otherSide.error })}</p>}
            {side !== active && !otherSide.error && list == null && <p className="empty"><Loader2 className="spin-icon" size={16} /> {t('reglages.settings.loading')}</p>}
            {list && list.length === 0 && <p className="empty">{t('reglages.no_profiles')}</p>}
            {list && renderList(side, list)}
          </div>
        );
      })}

      {creating && (
        <Modal title={t('reglages.new_profile')} onClose={() => setCreating(false)}>
          <form className="form st-form" onSubmit={submit}>
            <label className="full">{t('commun.name')}<input name="name" required maxLength={60} placeholder={t('reglages.e_g_demo_family')} autoComplete="off" /></label>
            {twoSides && (
              <label className="full">{t('reglages.sides.where')}
                <select name="side" defaultValue={active}>
                  <option value="server">{t('reglages.sides.server')}</option>
                  <option value="phone">{t('reglages.sides.phone')}</option>
                </select>
              </label>
            )}
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>{t('commun.cancel')}</button>
              <button className="primary">{t('reglages.create')}</button>
            </div>
          </form>
        </Modal>
      )}

      {moving && (
        <TransferModal
          user={moving.user}
          from={moving.from}
          to={moving.from === 'server' ? 'phone' : 'server'}
          onOpen={openProfile}
          onClose={(changed) => { setMoving(null); if (changed) refreshAll(); }}
        />
      )}
    </section>
  );
}

const STEP_KEYS: Record<TransferStep, string> = {
  check: 'reglages.sides.step_check',
  export: 'reglages.sides.step_export',
  save: 'reglages.sides.step_save',
  import: 'reglages.sides.step_import',
  verify: 'reglages.sides.step_verify',
  delete: 'reglages.sides.step_delete',
};

function TransferModal({ user, from, to, onOpen, onClose }: {
  user: User; from: Backend; to: Backend; onOpen: (side: Backend, id: number) => void; onClose: (changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TransferMode>('move');
  const [step, setStep] = useState<TransferStep | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ userId: number; created: boolean } | null>(null);
  const toLabel = t(to === 'phone' ? 'reglages.sides.phone_short' : 'reglages.sides.server_short');
  const fromLabel = t(from === 'phone' ? 'reglages.sides.phone_short' : 'reglages.sides.server_short');
  const steps = stepsFor(mode, to);

  const start = async () => {
    setRunning(true);
    setError(null);
    try {
      setDone(await transferProfile({ fetchFrom, saveBlob }, { from, to, user, mode, onStep: setStep }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const modes: Array<{ id: TransferMode; title: string; hint: string }> = [
    { id: 'move', title: t('reglages.sides.mode_move'), hint: t('reglages.sides.mode_move_hint', { to: toLabel, from: fromLabel }) },
    { id: 'copy', title: t('reglages.sides.mode_copy'), hint: t('reglages.sides.mode_copy_hint', { to: toLabel, from: fromLabel }) },
    { id: 'fresh', title: t('reglages.sides.mode_fresh'), hint: t('reglages.sides.mode_fresh_hint', { to: toLabel, from: fromLabel }) },
  ];
  const started = running || done != null || error != null;

  return (
    <Modal title={t(to === 'phone' ? 'reglages.sides.title_to_phone' : 'reglages.sides.title_to_server', { name: user.name })} onClose={() => !running && onClose(done != null)}>
      <div className="st-transfer">
        {!started && (
          <>
            <fieldset className="st-choices">
              {modes.map((m) => (
                <label key={m.id} className={mode === m.id ? 'st-choice on' : 'st-choice'}>
                  <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span><strong>{m.title}</strong><small>{m.hint}</small></span>
                </label>
              ))}
            </fieldset>
            <p className="st-hint">{t('reglages.sides.merge_note', { to: toLabel })}</p>
            {to === 'phone' && <p className="st-hint warn">{t('reglages.sides.phone_limits')}</p>}
          </>
        )}

        {started && (
          <ol className="st-steps">
            {steps.map((s) => {
              const index = steps.indexOf(s);
              const current = step ? steps.indexOf(step) : -1;
              const state = done || index < current ? 'done' : index === current ? (error ? 'failed' : 'doing') : 'todo';
              return (
                <li key={s} className={`st-step ${state}`}>
                  {state === 'done' ? <Check size={14} /> : state === 'doing' ? <Loader2 size={14} className="spin-icon" /> : <span className="st-dot" />}
                  {t(STEP_KEYS[s], { to: toLabel, from: fromLabel })}
                </li>
              );
            })}
          </ol>
        )}

        {error && <div className="error">{error}</div>}
        {done && <div className="notice">{t(done.created ? 'reglages.sides.done_created' : 'reglages.sides.done_merged', { name: user.name, to: toLabel })}</div>}

        <div className="modal-actions">
          {!started && (
            <>
              <button type="button" className="secondary" onClick={() => onClose(false)}>{t('commun.cancel')}</button>
              <button type="button" className="primary" onClick={() => void start()}>{t('reglages.sides.start')}</button>
            </>
          )}
          {error && <button type="button" className="secondary" onClick={() => onClose(false)}>{t('reglages.sides.close')}</button>}
          {done && (
            <>
              <button type="button" className="secondary" onClick={() => onClose(true)}>{t('reglages.sides.close')}</button>
              <button type="button" className="primary" onClick={() => { onOpen(to, done.userId); onClose(true); }}>{t('reglages.sides.open_there', { to: toLabel })}</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
