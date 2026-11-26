import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

// Boîtes de dialogue de l'app (confirmer, informer, demander un texte), à la
// place de window.confirm / alert / prompt du navigateur : même fenêtre que le
// reste de l'app (feuille depuis le bas sur téléphone), même style, mêmes
// animations. Appelables de n'importe où :
//   if (await confirmDialog('Supprimer ?', { danger: true })) …
// <DialogHost /> est monté une fois par App.

interface DialogOptions {
  title?: string;
  /** Action destructive : bouton de confirmation en rouge. */
  danger?: boolean;
  confirmLabel?: string;
  placeholder?: string;
  defaultValue?: string;
}

type Request =
  | { kind: 'confirm'; message: string; options: DialogOptions; resolve: (ok: boolean) => void }
  | { kind: 'alert'; message: string; options: DialogOptions; resolve: () => void }
  | { kind: 'prompt'; message: string; options: DialogOptions; resolve: (value: string | null) => void };

let enqueue: ((request: Request) => void) | null = null;

export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  if (!enqueue) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => enqueue!({ kind: 'confirm', message, options, resolve }));
}

export function alertDialog(message: string, options: DialogOptions = {}): Promise<void> {
  if (!enqueue) { window.alert(message); return Promise.resolve(); }
  return new Promise((resolve) => enqueue!({ kind: 'alert', message, options, resolve }));
}

export function promptDialog(message: string, options: DialogOptions = {}): Promise<string | null> {
  if (!enqueue) return Promise.resolve(window.prompt(message, options.defaultValue ?? ''));
  return new Promise((resolve) => enqueue!({ kind: 'prompt', message, options, resolve }));
}

export function DialogHost() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    enqueue = (request) => setQueue((q) => [...q, request]);
    return () => { enqueue = null; };
  }, []);

  const current = queue[0];
  useEffect(() => { if (current?.kind === 'prompt') setValue(current.options.defaultValue ?? ''); }, [current]);
  if (!current) return null;

  const done = () => setQueue((q) => q.slice(1));
  // Fermer (croix, voile, Échap) = annuler.
  const cancel = () => {
    if (current.kind === 'confirm') current.resolve(false);
    else if (current.kind === 'prompt') current.resolve(null);
    else current.resolve();
    done();
  };
  const accept = (event?: FormEvent) => {
    event?.preventDefault();
    if (current.kind === 'confirm') current.resolve(true);
    else if (current.kind === 'prompt') current.resolve(value.trim() ? value.trim() : null);
    else current.resolve();
    done();
  };

  const { options } = current;
  const title = options.title ?? (current.kind === 'confirm' ? t('ui.dialog.confirm_title') : current.kind === 'prompt' ? t('ui.dialog.prompt_title') : t('ui.dialog.alert_title'));
  return (
    <Modal key={queue.length} title={title} onClose={cancel}>
      <form className="dialog" onSubmit={accept}>
        <p className="dialog-message">{current.message}</p>
        {current.kind === 'prompt' && (
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={options.placeholder} aria-label={current.message} autoComplete="off" />
        )}
        <div className="modal-actions">
          {current.kind !== 'alert' && <button type="button" className="secondary" onClick={cancel}>{t('commun.cancel')}</button>}
          <button type="submit" className={options.danger ? 'primary danger' : 'primary'}>
            {options.confirmLabel ?? (current.kind === 'alert' ? t('ui.dialog.ok') : t('ui.dialog.confirm'))}
          </button>
        </div>
      </form>
    </Modal>
  );
}
