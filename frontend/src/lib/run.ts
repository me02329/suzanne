// Shared signature for the `run` callback that App passes to every page.
// `message` accepts either a fixed string or a function that derives the
// toast text from the operation's return value — useful when the message
// depends on what the server actually did (e.g. "3 créés, 2 mis à jour").
// `options.undo` rend l'action annulable : le toast de succès affiche un
// bouton « Annuler » qui exécute la mutation inverse (ex. recréer la
// transaction qui vient d'être supprimée).
// Resolves to `true` on success, `false` when the mutation failed or was
// dropped (another one in flight) — so forms only reset after a real success.
export type Run = (
  fn: () => Promise<unknown>,
  message?: string | ((result: unknown) => string),
  options?: { undo?: () => Promise<unknown> },
) => Promise<boolean>;
