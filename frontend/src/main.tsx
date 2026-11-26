import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
// Polices auto-hébergées : Fraunces (titres), Instrument Sans (texte),
// JetBrains Mono (chiffres tabulaires).
import '@fontsource-variable/fraunces';
import '@fontsource-variable/instrument-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/global.css';
import './styles/theme.css';
import './styles/motion.css';

import { IS_APP, serverConfigured, startLocal } from './local/mode';
import { writeActiveProfile } from './lib/activeProfile';

// Mode local (build « local », ADR 0011) : base et serveur embarqués démarrés
// avant l'app. Build normal : startLocal() ne fait rien.
void startLocal()
  .catch((error: unknown) => {
    console.error('[suzanne] démarrage du mode local', error);
    const root = document.getElementById('root')!;
    root.textContent = `Données du téléphone illisibles : ${(error as Error)?.message ?? error}`;
    // Ne pas rester bloqué : les profils du serveur restent accessibles. La
    // base du téléphone n'est ni effacée ni modifiée.
    if (IS_APP && serverConfigured()) {
      const button = document.createElement('button');
      button.className = 'primary';
      button.style.cssText = 'display:block;margin-top:16px';
      button.textContent = 'Ouvrir les profils du serveur';
      button.onclick = () => { writeActiveProfile({ backend: 'server', userId: null }); window.location.reload(); };
      root.append(button);
    }
    root.style.cssText = 'padding:24px;font:16px/1.5 system-ui,sans-serif';
    throw error;
  })
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>,
    );
  });

// Dans l'app Android, pas de service worker : l'interface est déjà sur l'appareil.
if (import.meta.env.PROD && !IS_APP && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA install remains optional. */
    });
  });
}
