import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, Transaction } from '@suzanne/shared';
import { api, type LoanCandidate } from '../lib/api';
import { money } from '../lib/format';
import { parseAmount } from './home/amount';
import { formatTxDate } from './transactions/txUtils';
import { CategorySelect } from './CategorySelect';
import { Modal } from './Modal';
import type { Run } from '../lib/run';

// Rattacher une opération existante à un prêt (ADR 0001 : un prêt = un compte).
// Deux entrées : depuis une opération (on choisit le prêt) ou depuis un prêt
// (on choisit l'opération). La mensualité devient un virement vers le prêt ;
// une part « intérêts et assurance », facultative, reste une dépense à part.
export function LoanLinkModal({ userId, accounts, categories, tx, loanAccountId, run, onClose }: {
  userId: number;
  accounts: Account[];
  categories: Category[];
  /** Opération de départ (depuis le menu d'une opération). */
  tx?: Transaction;
  /** Prêt de départ (depuis la page Prêts). */
  loanAccountId?: number;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  // Depuis une opération : une sortie se rattache à un emprunt, une rentrée à un prêt accordé.
  const loans = accounts.filter((a) => !a.archived && (tx ? (tx.type === 'expense' ? a.type === 'loan' : a.type === 'receivable') : a.type === 'loan' || a.type === 'receivable'));
  const [loanId, setLoanId] = useState(String(loanAccountId ?? loans[0]?.id ?? ''));
  const loan = accounts.find((a) => a.id === Number(loanId));
  const borrowed = loan?.type === 'loan';
  const [candidates, setCandidates] = useState<LoanCandidate[] | null>(tx ? [] : null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<LoanCandidate | null>(tx && tx.account_id != null
    ? { transaction_id: tx.id, date: tx.date.slice(0, 10), description: tx.description ?? null, account_id: tx.account_id, amount: tx.amount, category_id: tx.category_id ?? null }
    : null);
  const [interest, setInterest] = useState('');
  const [interestCategory, setInterestCategory] = useState(() => String(categories.find((c) => c.type === 'expense' && /int[ée]r[êe]t|banc|frais/i.test(c.name))?.id ?? ''));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tx || !loanId) return;
    let cancelled = false;
    setCandidates(null);
    api.loanCandidates(userId, Number(loanId)).then((rows) => { if (!cancelled) setCandidates(rows); }).catch((e: unknown) => { if (!cancelled) { setCandidates([]); setError((e as Error).message); } });
    return () => { cancelled = true; };
  }, [userId, loanId, tx]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? []).filter((c) => !q || (c.description ?? '').toLowerCase().includes(q) || String(c.amount).includes(q.replace(',', '.'))).slice(0, 40);
  }, [candidates, query]);

  const interestValue = interest.trim() ? parseAmount(interest) : 0;
  const principal = picked ? Math.round((picked.amount - (borrowed ? interestValue : 0)) * 100) / 100 : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loan) { setError(t('patrimoine.loans.link_pick_loan')); return; }
    if (!picked) { setError(t('patrimoine.loans.link_pick_tx')); return; }
    if (borrowed && (Number.isNaN(interestValue) || interestValue < 0 || interestValue >= picked.amount)) { setError(t('patrimoine.loans.link_interest_invalid')); return; }
    const ok = await run(() => api.linkToLoan(userId, loan.id, {
      transaction_id: picked.transaction_id,
      ...(borrowed && interestValue > 0 ? { interest_amount: interestValue, interest_category_id: interestCategory ? Number(interestCategory) : null } : {}),
    }), t('patrimoine.loans.link_done', { name: loan.name }));
    if (ok) onClose();
  };

  return (
    <Modal title={t('patrimoine.loans.link_title')} onClose={onClose}>
      <form className="form st-form loans-form" onSubmit={submit}>
        {loans.length === 0 ? (
          <p className="full muted">{t(tx?.type === 'income' ? 'patrimoine.loans.link_no_lent' : 'patrimoine.loans.link_no_borrowed')}</p>
        ) : (
          <label className="full">{t('patrimoine.loans.link_loan')}
            <select value={loanId} onChange={(e) => { setLoanId(e.target.value); if (!tx) setPicked(null); }} disabled={loanAccountId != null}>
              {loans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}

        {!tx && loan && (
          <div className="full loan-link-pick">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('patrimoine.loans.link_search')} aria-label={t('patrimoine.loans.link_search')} />
            {candidates === null ? <p className="muted">{t('patrimoine.loans.loading')}</p> : shown.length === 0 ? (
              <p className="muted">{t('patrimoine.loans.link_no_candidate')}</p>
            ) : (
              <ul className="loan-link-list" role="listbox" aria-label={t('patrimoine.loans.link_pick_tx')}>
                {shown.map((c) => (
                  <li key={c.transaction_id}>
                    <button type="button" role="option" aria-selected={picked?.transaction_id === c.transaction_id} className={picked?.transaction_id === c.transaction_id ? 'on' : undefined} onClick={() => setPicked(c)}>
                      <span className="muted">{formatTxDate(c.date)}</span>
                      <span className="loan-link-label">{c.description ?? '—'}<small>{accountName.get(c.account_id) ?? ''}</small></span>
                      <span className="num">{money(c.amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {picked && (
          <p className="full loans-explain">
            <strong>{picked.description ?? '—'}</strong> · {formatTxDate(picked.date)} · <span className="num">{money(picked.amount)}</span>
          </p>
        )}

        {borrowed && picked && (
          <>
            <label>{t('patrimoine.loans.link_interest')}
              <input inputMode="decimal" value={interest} onChange={(e) => { setInterest(e.target.value); setError(null); }} placeholder="0,00" autoComplete="off" />
            </label>
            <div>
              <span className="st-field-label">{t('patrimoine.loans.link_interest_category')}</span>
              <CategorySelect value={interestCategory} onChange={setInterestCategory} categories={categories.filter((c) => c.type === 'expense')} noneLabel={t('patrimoine.loans.no_category')} ariaLabel={t('patrimoine.loans.link_interest_category')} />
            </div>
            <p className="full muted loans-explain">
              {t('patrimoine.loans.link_split', { principal: money(Math.max(0, principal)), interest: money(interestValue > 0 ? interestValue : 0) })}
            </p>
          </>
        )}
        <p className="full muted loans-explain">{t(borrowed || !loan ? 'patrimoine.loans.link_explain_borrowed' : 'patrimoine.loans.link_explain_lent')}</p>
        {error && <p className="full form-error" role="alert">{error}</p>}
        <div className="modal-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary" disabled={!picked || !loan}>{t('patrimoine.loans.link_submit')}</button>
        </div>
      </form>
    </Modal>
  );
}
