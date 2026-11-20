// Mode local : remplace `node:crypto` dans le build navigateur. Seul ce dont le
// métier a besoin en local est fourni :
// - createHash('sha256' | 'sha1') : empreintes d'import (import_fingerprint),
//   octet pour octet identiques à Node (UTF-8 → hachage), sinon un même relevé
//   ne serait plus reconnu entre le téléphone et un serveur ;
// - randomUUID.
// La synchro bancaire (HMAC, signature RSA) n'existe pas en local : ses
// primitives lèvent une erreur explicite.
import { Buffer } from 'buffer';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

type Input = string | Uint8Array;

export function createHash(algorithm: string) {
  const fn = algorithm.toLowerCase() === 'sha256' ? sha256 : algorithm.toLowerCase() === 'sha1' ? sha1 : null;
  if (!fn) throw new Error(`Hachage ${algorithm} indisponible en mode local`);
  const chunks: Uint8Array[] = [];
  const hash = {
    update(data: Input) { chunks.push(typeof data === 'string' ? utf8ToBytes(data) : data); return hash; },
    digest(encoding?: string): string | Buffer {
      const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) { total.set(c, offset); offset += c.length; }
      const out = fn(total);
      if (encoding === 'hex') return bytesToHex(out);
      if (encoding === 'base64') return Buffer.from(out).toString('base64');
      return Buffer.from(out);
    },
  };
  return hash;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

function unavailable(name: string) {
  return () => { throw new Error(`${name} indisponible en mode local (synchro bancaire désactivée)`); };
}
export const createHmac = unavailable('createHmac');
export const createSign = unavailable('createSign');
export const timingSafeEqual = unavailable('timingSafeEqual');

export default { createHash, randomUUID, createHmac, createSign, timingSafeEqual };
