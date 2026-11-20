// Mode local : remplace les modules Node sans équivalent sur l'appareil
// (node:fs, node:path, node:url, dotenv/config, compression, cors…). Seule la
// synchro bancaire et le serveur HTTP s'en servent, absents en local : tout
// appel lève une erreur explicite plutôt qu'un échec obscur.
const fail = (name: string) => () => { throw new Error(`${name} indisponible en mode local`); };

export const readFileSync = fail('readFileSync');
export const existsSync = () => false;
export const resolve = (...parts: string[]) => parts.join('/');
export const join = (...parts: string[]) => parts.join('/');
export const dirname = (p: string) => p.replace(/\/[^/]*$/, '');
export const fileURLToPath = (u: string) => u;
export default { readFileSync, existsSync, resolve, join, dirname, fileURLToPath };
