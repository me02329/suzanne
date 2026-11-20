// Point d'entrée du mode local (ADR 0011). Build normal (serveur) : rien à
// faire. Build « local » (vite.local.config.ts) : ce module est remplacé par
// ./bootstrap.ts, qui démarre la base et le serveur embarqués avant l'app.
export const LOCAL_MODE = false;

export async function startLocal(): Promise<void> {
  /* mode serveur : l'API est sur le réseau */
}
