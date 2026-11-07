import { createHash, randomBytes } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively, no whitespace. Two
 * semantically equal values always serialise identically, which is what makes
 * hash chains and generator reproducibility (GN-P4) verifiable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value === undefined ? null : value;
  if (Array.isArray(value)) return value.map(normalise);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = normalise(v);
  }
  return out;
}

export function sha256(data: string | Buffer, algorithm = 'sha256'): string {
  return createHash(algorithm).update(data).digest('hex');
}

export function hashValue(value: unknown, algorithm = 'sha256'): string {
  return sha256(canonicalJson(value), algorithm);
}

/** Chains a record onto the previous hash: H(prev || canonical(record)). */
export function chainHash(prevHash: string, record: unknown, algorithm = 'sha256'): string {
  return sha256(prevHash + '|' + canonicalJson(record), algorithm);
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export const GENESIS_HASH = '0'.repeat(64);

/** Normalises a statement for duplicate detection (UCI-003, V-ON-04). */
export function normaliseStatement(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic PRNG (mulberry32) for reproducible property tests and simulations. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
