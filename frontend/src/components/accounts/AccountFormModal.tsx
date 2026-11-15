import { FormEvent, useEffect, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { ACCOUNT_TYPES, accountFeatures, REPORT_CURRENCIES, type Account, type AccountType, type Institution } from '@suzanne/shared';
import { api } from '../../lib/api';
import { accountsApi, FISCAL_DATE_TYPES, ORDER_CASH_TYPES, type AccountWithInvestment } from '../../lib/api-accounts';
import { parseDecimal } from '../../lib/pea';
import { todayIso } from '../../lib/format';
import { Modal } from '../Modal';
import type { Run } from '../../lib/run';
import { useTranslation } from 'react-i18next';

const NEW_INSTITUTION = '__new';

// Création / modification d'un compte, avec la gestion des institutions
// (création à la volée, renommage, suppression des institutions vides).
export function AccountFormModal({ userId, account, accounts, institutions: given, run, onClose }: {
  userId: number;
  account: AccountWithInvestment | null;
  accounts: Account[];
  // Absent : la modale charge elle-même les institutions (fiche compte).
  institutions?: Institution[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [institution, setInstitution] = useState<string>(account?.institution_id != null ? String(account.institution_id) : '');
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Institution[] | null>(null);
  useEffect(() => {
    if (given) return;
    let cancelled = false;
    api.institutions(userId).then((rows) => { if (!cancelled) setLoaded(rows); }).catch(() => { if (!cancelled) setLoaded([]); });
    return () => { cancelled = true; };
  }, [given, userId]);
  const institutions = given ?? loaded ?? [];
  const showOrdersCash = ORDER_CASH_TYPES.includes(type);
  const showFiscal = FISCAL_DATE_TYPES.includes(type);
  // Bien (immobilier, objet) : le solde initial est le prix d'achat, prêt lié possible.
  const isProperty = accountFeatures(type).valuation;
  const loans = accounts.filter((a) => a.type === 'loan' && !a.archived && a.id !== account?.id);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!given && loaded == null) return;
    const data = new FormData(event.currentTarget);
    const initial = parseDecimal(data.get('initial_balance') || '0');
    if (!Number.isFinite(initial)) { setError('Solde initial invalide.'); return; }
    const newInstitution = String(data.get('new_institution') ?? '').trim();
    if (institution === NEW_INSTITUTION && !newInstitution) { setError('Donne un nom à la nouvelle institution.'); return; }
    setError(null);
    const body = {
      name: String(data.get('name')).trim(),
      type,
      currency: String(data.get('currency') || 'EUR'),
      initial_balance: initial,
      initial_balance_date: String(data.get('initial_balance_date')),
      ...(showOrdersCash ? { orders_affect_cash: data.get('orders_affect_cash') === 'on' } : {}),
      ...(showFiscal ? { fiscal_start_date: String(data.get('fiscal_start_date') || '') || null } : {}),
      ...(isProperty ? { linked_account_id: data.get('linked_account_id') ? Number(data.get('linked_account_id')) : null } : {}),
      professional: data.get('professional') === 'on',
    };
    void run(async () => {
      let institution_id: number | null = institution && institution !== NEW_INSTITUTION ? Number(institution) : null;
      if (institution === NEW_INSTITUTION) institution_id = (await api.createInstitution(userId, { name: newInstitution })).id;
      return account
        ? accountsApi.update(userId, account.id, { ...body, institution_id })
        : accountsApi.create(userId, { ...body, institution_id });
    }, account ? 'Compte modifié' : 'Compte ajouté').then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={account ? `Modifier ${account.name}` : 'Ajouter un compte'} onClose={onClose}>
      <form className="form acc-form sheet-ok" onSubmit={submit}>
        <label className="full">{t('comptes.account_form_modal.name')}<input name="name" defaultValue={account?.name ?? ''} required maxLength={120} autoFocus={!account} /></label>
        <label>{t('comptes.account_form_modal.type')}
          <select name="type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>{t('comptes.account_form_modal.currency')}
          <select name="currency" defaultValue={account?.currency ?? 'EUR'} required>
            {REPORT_CURRENCIES.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
          </select>
        </label>
        <label className="full">{t('comptes.account_form_modal.institution')}
          <select value={institution} onChange={(e) => setInstitution(e.target.value)}>
            <option value="">{t('comptes.account_form_modal.none')}</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            <option value={NEW_INSTITUTION}>{t('comptes.account_form_modal.new_institution')}</option>
          </select>
        </label>
        {institution === NEW_INSTITUTION && (
          <label className="full">{t('comptes.account_form_modal.institution_name')}<input name="new_institution" placeholder={t('comptes.account_form_modal.bank_broker')} maxLength={120} autoFocus /></label>
        )}
        <label>{isProperty ? t('comptes.account_form_modal.purchase_price') : t('comptes.account_form_modal.opening_balance')}
          <input name="initial_balance" inputMode="decimal" autoComplete="off" defaultValue={account ? String(account.initial_balance).replace('.', ',') : '0'} />
        </label>
        <label>{isProperty ? t('comptes.account_form_modal.purchase_date') : t('comptes.account_form_modal.as')}
          <input name="initial_balance_date" type="date" defaultValue={account?.initial_balance_date?.slice(0, 10) ?? todayIso()} required />
        </label>
        {isProperty && (
          <>
            <label className="full">{t('comptes.account_form_modal.linked_loan')}
              <select name="linked_account_id" defaultValue={(account as { linked_account_id?: number | null } | null | undefined)?.linked_account_id ?? ''}>
                <option value="">{t('comptes.account_form_modal.no_linked_loan')}</option>
                {loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <small className="acc-hint full">{t('comptes.account_form_modal.property_hint')}</small>
          </>
        )}
        {showFiscal && (
          <label className="full">{t('comptes.account_form_modal.tax_opening_date')}
            <input name="fiscal_start_date" type="date" defaultValue={account?.fiscal_start_date?.slice(0, 10) ?? ''} />
            <small className="acc-hint">{t('comptes.account_form_modal.start_holding_period_5_years')}</small>
          </label>
        )}
        {showOrdersCash && (
          <label className="acc-check full">
            <input type="checkbox" name="orders_affect_cash" defaultChecked={account ? Boolean(account.orders_affect_cash) : true} />
            <span>{t('comptes.account_form_modal.stock_orders_debit_credit_this')}</span>
          </label>
        )}
        <label className="acc-check full">
          <input type="checkbox" name="professional" defaultChecked={Boolean((account as { professional?: boolean } | null | undefined)?.professional)} />
          <span>
            {t('comptes.account_form_modal.professional')}
            <small className="acc-hint">{t('comptes.account_form_modal.professional_hint')}</small>
          </span>
        </label>
        {error && <p className="acc-error full" role="alert">{error}</p>}
        <div className="acc-form-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('comptes.account_form_modal.cancel')}</button>
          <button className="primary">{account ? 'Enregistrer' : 'Ajouter le compte'}</button>
        </div>
      </form>

      <details className="acc-manage" open={manageOpen} onToggle={(e) => setManageOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>{t('comptes.account_form_modal.manage_institutions')}{institutions.length})</summary>
        {institutions.length === 0 ? (
          <p className="acc-muted">{t('comptes.account_form_modal.no_institutions_pick_new_institution')}</p>
        ) : (
          <ul className="acc-inst-list">
            {institutions.map((i) => (
              <InstitutionRow key={i.id} userId={userId} institution={i} used={accounts.some((a) => a.institution_id === i.id)} run={run} />
            ))}
          </ul>
        )}
      </details>
    </Modal>
  );
}

function InstitutionRow({ userId, institution, used, run }: { userId: number; institution: Institution; used: boolean; run: Run }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(institution.name);
  const save = () => {
    const next = name.trim();
    if (!next || next === institution.name) { setEditing(false); return; }
    void run(() => api.updateInstitution(userId, institution.id, { name: next }), 'Institution renommée')
      .then((ok) => { if (ok) setEditing(false); });
  };
  return (
    <li>
      {editing ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('comptes.account_form_modal.new_name')} maxLength={120} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
          <button type="button" className="row-btn" aria-label={t('comptes.account_form_modal.save')} title={t('comptes.account_form_modal.save')} onClick={save}><Check size={16} /></button>
          <button type="button" className="row-btn" aria-label={t('comptes.account_form_modal.cancel')} title={t('comptes.account_form_modal.cancel')} onClick={() => { setName(institution.name); setEditing(false); }}><X size={16} /></button>
        </>
      ) : (
        <>
          <span className="acc-inst-name">{institution.name}</span>
          <button type="button" className="row-btn" aria-label={`Renommer ${institution.name}`} title={t('comptes.account_form_modal.rename')} onClick={() => setEditing(true)}><Pencil size={15} /></button>
          <button
            type="button"
            className="row-btn"
            aria-label={`Supprimer ${institution.name}`}
            title={used ? 'Des comptes y sont rattachés' : 'Supprimer'}
            disabled={used}
            onClick={() => void run(
              () => api.deleteInstitution(userId, institution.id),
              'Institution supprimée',
              { undo: () => api.createInstitution(userId, { name: institution.name }) },
            )}
          ><Trash2 size={15} /></button>
        </>
      )}
    </li>
  );
}
