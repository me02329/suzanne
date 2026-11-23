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

import { IS_APP, startLocal } from './local/mode';

// Mode local (build « local », ADR 0011) : base et serveur embarqués démarrés
// avant l'app. Build normal : startLocal() ne fait rien.
void startLocal()
  .catch((error: unknown) => {
    console.error('[suzanne] démarrage du mode local', error);
    document.getElementById('root')!.textContent = `Démarrage impossible : ${(error as Error)?.message ?? error}`;
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
