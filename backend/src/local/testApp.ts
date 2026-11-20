// Tests du mode local : remplace `src/app.ts` (alias). Les tests appellent
// createApp() puis request(app) ; ici request() (local/testClient.ts) va
// directement au gestionnaire local, l'objet app n'est donc qu'un jeton.
export function createApp() {
  return {};
}
