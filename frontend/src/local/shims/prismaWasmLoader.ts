// Mode local : chargeur du moteur de requêtes Prisma (WebAssembly) pour le
// navigateur. Remplace `#wasm-compiler-loader` du client « edge » de Prisma :
// le .wasm est livré comme fichier et compilé côté navigateur.
import wasmUrl from '../../../../node_modules/.prisma/client/query_compiler_fast_bg.wasm?url';

export default (async () => ({ default: await WebAssembly.compileStreaming(fetch(wasmUrl)) }))();
