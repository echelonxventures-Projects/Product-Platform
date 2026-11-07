import type { Store } from './store.ts';

/**
 * Identification scheme UCOS-<LAYER>-<TYPE>-<SEQUENCE> (Master Index §8).
 * Canonical ids are minted only here, by the Registry Office function
 * (Phase 003 §2). Aliases are resolvable shorthand, never identities.
 */
export class IdentityMint {
  private readonly store: Store;
  private readonly prefix: string;
  private readonly width: number;
  private readonly sep: string;

  constructor(store: Store, prefix: string, width: number, sep: string) {
    this.store = store;
    this.prefix = prefix;
    this.width = width;
    this.sep = sep;
  }

  mint(layer: string, type: string): string {
    const scope = `${layer}${this.sep}${type}`;
    const n = this.store.nextSequence(scope);
    return this.format(layer, type, n);
  }

  format(layer: string, type: string, n: number): string {
    return [this.prefix, layer, type, String(n).padStart(this.width, '0')].join(this.sep);
  }

  /** Records a pre-minted canonical id so the sequence never re-issues it. */
  observe(canonicalId: string): void {
    const parsed = this.parse(canonicalId);
    if (parsed) this.store.observeSequence(`${parsed.layer}${this.sep}${parsed.type}`, parsed.sequence);
  }

  parse(canonicalId: string): { layer: string; type: string; sequence: number } | null {
    const parts = canonicalId.split(this.sep);
    if (parts.length !== 4 || parts[0] !== this.prefix) return null;
    const sequence = Number(parts[3]);
    if (!Number.isInteger(sequence) || parts[3].length !== this.width) return null;
    return { layer: parts[1], type: parts[2], sequence };
  }

  isCanonical(id: string): boolean {
    return this.parse(id) !== null;
  }
}
