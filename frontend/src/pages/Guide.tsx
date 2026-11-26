import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// Source unique : le même texte que docs/GUIDE.md dans le dépôt.
import guide from '../../../docs/GUIDE.md?raw';
import '../styles/pages/guide.css';

// Liens internes (« /recurring ») : navigation dans l'app, sans recharger.
const components: Components = {
  a: ({ href, children }) => (href?.startsWith('/')
    ? <Link to={href}>{children}</Link>
    : <a href={href} target="_blank" rel="noreferrer">{children}</a>),
  table: ({ children }) => <div className="guide-table"><table>{children}</table></div>,
};

export function Guide() {
  const { i18n } = useTranslation();
  // La ligne sur le fichier source sert dans le dépôt, pas dans l'app.
  const body = guide.replace(/^_Affiché dans l'app.*_\n\n/m, '')
    // Typographie française : pas de « : » ou de « ? » seul en début de ligne.
    .replace(/ ([:;!?»])/g, ' $1')
    .replace(/« /g, '« ');
  return (
    <article className="pg-card guide">
      {!i18n.language.startsWith('fr') && <p className="guide-lang">This guide is written in French.</p>}{/* i18n-ignore */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body}</ReactMarkdown>
    </article>
  );
}
