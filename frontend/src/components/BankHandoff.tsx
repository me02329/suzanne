import { useTranslation } from 'react-i18next';
import { SuzanneMark } from './SuzanneMark';
import '../styles/pages/bank.css';

// Retour de la banque ouvert dans le navigateur d'un téléphone Android (la
// banque ne sait rediriger que vers une adresse web) alors que la connexion a
// été lancée depuis l'app : on renvoie le code à l'app (lien suzanne://, que
// l'app déclare), qui termine la connexion avec son profil et son jeton. Rien
// n'est envoyé au serveur ici : le code reste utilisable par l'app.

/** Page de retour de la banque, dans le navigateur d'un téléphone Android ? */
export function isAndroidBankReturn(): boolean {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  return pathname.startsWith('/bank/callback') && params.has('state') && !params.has('here')
    && /Android/i.test(navigator.userAgent) && !/SuzanneAndroid/.test(navigator.userAgent);
}

export function BankHandoff() {
  const { t } = useTranslation();
  const query = window.location.search.replace(/^\?/, '');
  const appUrl = `intent://bank/callback?${query}#Intent;scheme=suzanne;package=app.suzanne;end`;
  const hereUrl = `${window.location.pathname}?${query}&here=1`;
  return (
    <main className="bank-handoff">
      <SuzanneMark />
      <h1>{t('reglages.bank.handoff_title')}</h1>
      <p>{t('reglages.bank.handoff_text')}</p>
      <a className="primary accent bank-handoff-app" href={appUrl}>{t('reglages.bank.handoff_open_app')}</a>
      <a className="bank-handoff-here" href={hereUrl}>{t('reglages.bank.handoff_stay')}</a>
    </main>
  );
}
