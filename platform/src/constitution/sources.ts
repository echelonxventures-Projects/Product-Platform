import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { platformPath, type PlatformConfig } from '../kernel/config.ts';

/**
 * Reads the constitutional sources verbatim. Nothing here restates the
 * constitution: every identifier, name and statement is parsed out of the
 * UCOS documents and registry seeds, so the documents remain the single
 * authored source (UCI-003) and the registry holds their identity.
 */

export interface RuleText {
  id: string;
  text: string;
  source: string;
  locator: string;
}

export interface IdBlock {
  id: string;
  name: string | null;
  statement: string;
  headingContext: string | null;
}

export class ConstitutionSources {
  private readonly cfg: PlatformConfig;
  private readonly cache = new Map<string, unknown>();

  constructor(cfg: PlatformConfig) {
    this.cfg = cfg;
  }

  seed<T = Record<string, unknown>>(file: string): T {
    const key = `seed:${file}`;
    if (!this.cache.has(key)) this.cache.set(key, JSON.parse(readFileSync(join(platformPath(this.cfg.paths.seedRegistries), file), 'utf8')));
    return this.cache.get(key) as T;
  }

  metadata<T = Record<string, unknown>>(file: string): T {
    const key = `meta:${file}`;
    if (!this.cache.has(key)) this.cache.set(key, JSON.parse(readFileSync(join(platformPath(this.cfg.paths.platformMetadata), file), 'utf8')));
    return this.cache.get(key) as T;
  }

  masterIndexText(): string {
    return readFileSync(platformPath(this.cfg.paths.masterIndex), 'utf8');
  }

  phaseDocuments(): { file: string; text: string; documentId: string | null; title: string }[] {
    const root = platformPath(this.cfg.paths.constitutionRoot);
    return readdirSync(root)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((file) => {
        const text = readFileSync(join(root, file), 'utf8');
        const documentId = /\*\*Document ID:\*\*\s*([A-Z0-9-]+)/.exec(text)?.[1] ?? null;
        const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? file;
        return { file, text, documentId, title };
      });
  }

  /** Markdown table rows `| ID | … |` whose first cell matches the pattern. */
  static tableRows(text: string, idPattern: RegExp): string[][] {
    const rows: string[][] = [];
    for (const line of text.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      if (cells.length && idPattern.test(cells[0])) rows.push(cells);
    }
    return rows;
  }

  /** Master Index §3 invariants: | UCI-nnn | Name | Statement |. */
  masterInvariants(): { id: string; name: string; statement: string }[] {
    return ConstitutionSources.tableRows(this.masterIndexText(), /^UCI-\d{3}$/).map((c) => ({ id: c[0], name: c[1], statement: c[2] }));
  }

  /** Master Index §4 laws: | UCL-Xnn | Law |, grouped by their §4.x heading. */
  masterLaws(): { id: string; statement: string; group: string }[] {
    const out: { id: string; statement: string; group: string }[] = [];
    let group = '';
    for (const line of this.masterIndexText().split('\n')) {
      const h = /^###\s+4\.\d+\s+(.+)$/.exec(line);
      if (h) group = h[1].trim();
      const cells = line.trim().startsWith('|') ? line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : [];
      if (cells.length >= 2 && /^UCL-[A-Z]\d{2}$/.test(cells[0])) out.push({ id: cells[0], statement: cells[1], group });
    }
    return out;
  }

  /** Master Index §7 canonical artifact template (20 fields). */
  artifactTemplate(): { number: string; field: string; meaning: string }[] {
    const text = this.masterIndexText();
    const block = text.slice(text.indexOf('ARTIFACT\n'), text.indexOf('### 7.1'));
    const out: { number: string; field: string; meaning: string }[] = [];
    for (const line of block.split('\n')) {
      const m = /[├└]──\s+(\d{2})\s+(.+?)\s+—\s+(.+)$/.exec(line);
      if (m) out.push({ number: m[1], field: m[2].trim(), meaning: m[3].trim() });
    }
    return out;
  }

  /** Master Index §2 constitution text block. */
  constitutionText(): string {
    const text = this.masterIndexText();
    const m = /```text\n(CONSTITUTION OF UCOS[\s\S]*?)```/.exec(text);
    return m ? m[1].trim() : '';
  }

  /** Master Index §8 identification layers: | Layer | Code | Example |. */
  identificationLayers(): { layer: string; code: string; example: string }[] {
    return ConstitutionSources.tableRows(this.masterIndexText(), /^[A-Z][a-z]+$/)
      .filter((c) => c.length >= 3 && /^`[A-Z]+`$/.test(c[1]))
      .map((c) => ({ layer: c[0], code: c[1].replace(/`/g, ''), example: c[2].replace(/`/g, '') }));
  }

  /** Master Index §9 forbidden confusions. */
  forbiddenConfusions(): { confusion: string; correction: string }[] {
    const text = this.masterIndexText();
    const section = text.slice(text.indexOf('## 9. TERMINOLOGICAL DISCIPLINE'), text.indexOf('## 10.'));
    return ConstitutionSources.tableRows(section, /≡/).map((c) => ({ confusion: c[0], correction: c[1].replace(/\*\*/g, '') }));
  }

  /**
   * Every identified rule stated in the phase documents: validation (V-),
   * evolution (E-), compliance (C-), discovery (D-), certification (X-),
   * principles (XX-Pn), security controls (XX-S-nn, FR-SEC-nn), governance
   * separations (GI-n), meta-ontology (M-nn), relationship integrity (R-nn)
   * and autonomy constraints (IN-An). Both code-block lines ("ID␣␣text" with
   * indented continuations) and inline prose ("**Validation:** V-ID-01 …")
   * are read.
   */
  phaseRules(): RuleText[] {
    const out = new Map<string, RuleText>();
    const blockId = /^\s*((?:[A-Z]{1,3}-){1,2}(?:[A-Z]{0,3}\d{1,3}|SEC-\d{2})|GI-\d|M-\d{2}|R-\d{2})\s{1,}(.+)$/;
    for (const doc of [{ file: '00-Master-Index.md', text: this.masterIndexText() }, ...this.phaseDocuments()]) {
      const lines = doc.text.split('\n');
      let inCode = false;
      let heading = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('```')) {
          inCode = !inCode;
          continue;
        }
        const h = /^#{1,4}\s+(.+)$/.exec(line);
        if (h && !inCode) heading = h[1].trim();
        if (inCode) {
          const m = blockId.exec(line);
          if (!m || !isRuleId(m[1])) continue;
          let text = m[2].trim();
          const indent = line.indexOf(m[2]);
          for (let j = i + 1; j < lines.length; j++) {
            const nxt = lines[j];
            if (nxt.startsWith('```') || blockId.test(nxt) || nxt.trim() === '') break;
            const lead = nxt.length - nxt.trimStart().length;
            if (lead < Math.min(indent, 5)) break;
            text += ' ' + nxt.trim();
          }
          addRule(out, { id: m[1], text: text.replace(/\s+/g, ' '), source: doc.file, locator: heading });
        } else {
          const inline = /\b(V-[A-Z]{2}-\d{2})\s+(.+?)(?=\s+V-[A-Z]{2}-\d{2}\s|$)/g;
          if (!/\bV-[A-Z]{2}-\d{2}\s/.test(line) || line.includes('|')) continue;
          const body = line.replace(/^\*\*[^*]+\*\*\s*/, '');
          let m2: RegExpExecArray | null;
          while ((m2 = inline.exec(body))) addRule(out, { id: m2[1], text: m2[2].trim(), source: doc.file, locator: heading });
        }
      }
    }
    return [...out.values()];
  }

  /** Reads `new N.txt` style notes and the generic ID/name/statement blocks within them. */
  static idBlocks(text: string, idPattern = /^\s*([A-Z][A-Z0-9]{1,10}-\d{3})\s*$/): IdBlock[] {
    const lines = text.split('\n');
    const out: IdBlock[] = [];
    let context: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const m = idPattern.exec(lines[i]);
      if (!m) {
        const t = lines[i].trim();
        if (t && !/[.,;:]$/.test(t) && t.length < 80 && /(Laws?|Invariants?)$/i.test(t)) context = t;
        continue;
      }
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (idPattern.test(lines[j])) break;
        body.push(lines[j].trim());
      }
      while (body.length && body[body.length - 1] === '') body.pop();
      let name: string | null = null;
      const firstNonEmpty = body.findIndex((b) => b !== '');
      if (firstNonEmpty >= 0 && /(Law|Invariant|Principle)$/.test(body[firstNonEmpty]) && !/[.]$/.test(body[firstNonEmpty])) {
        name = body[firstNonEmpty];
        body.splice(0, firstNonEmpty + 1);
      }
      // A statement runs until, after its first completed sentence, a line
      // appears that is not itself a sentence — that line is a heading.
      const statementLines: string[] = [];
      let seenSentence = false;
      let stop = body.length;
      for (let k = 0; k < body.length; k++) {
        const b = body[k];
        if (b === '') continue;
        if (seenSentence && !/[.]$/.test(b)) {
          stop = k;
          break;
        }
        statementLines.push(b);
        if (/[.]$/.test(b)) seenSentence = true;
      }
      const trailing = body.slice(stop).filter(Boolean);
      const statement = statementLines.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      out.push({ id: m[1], name, statement, headingContext: context });
      const trailingHeading = trailing.find((t) => /(Laws?|Invariants?)$/i.test(t));
      if (trailingHeading) context = trailingHeading;
      i = j - 1;
    }
    return out;
  }
}

const RULE_PREFIXES = /^(V|E|C|D|X)-[A-Z]{2}-\d{2}$|^(RG|TX|CX|CM|GN|IN|MM|US)-P\d{1,2}$|^(RG|TX|CX|CM|GN|IN|US)-S-\d{2}$|^FR-SEC-\d{2}$|^GI-\d$|^M-\d{2}$|^R-\d{2}$|^IN-A\d$|^TX-G\d$/;

export function isRuleId(id: string): boolean {
  return RULE_PREFIXES.test(id);
}

function addRule(map: Map<string, RuleText>, r: RuleText): void {
  const existing = map.get(r.id);
  if (!existing || r.text.length > existing.text.length) map.set(r.id, existing ? { ...r, source: existing.source, locator: existing.locator } : r);
}

export function ruleClass(id: string): { kind: 'ValidationRule' | 'CertificationScheme' | 'Rule'; ruleClass: string } {
  if (id.startsWith('V-')) return { kind: 'ValidationRule', ruleClass: 'validation' };
  if (id.startsWith('X-')) return { kind: 'CertificationScheme', ruleClass: 'certification' };
  if (id.startsWith('E-')) return { kind: 'Rule', ruleClass: 'evolution' };
  if (id.startsWith('C-')) return { kind: 'Rule', ruleClass: 'compliance' };
  if (id.startsWith('D-')) return { kind: 'Rule', ruleClass: 'discovery' };
  if (/-P\d/.test(id)) return { kind: 'Rule', ruleClass: 'principle' };
  if (/-S-|SEC/.test(id)) return { kind: 'Rule', ruleClass: 'security' };
  if (id.startsWith('GI-')) return { kind: 'Rule', ruleClass: 'separation' };
  if (id.startsWith('M-')) return { kind: 'Rule', ruleClass: 'meta-ontology' };
  if (id.startsWith('R-')) return { kind: 'Rule', ruleClass: 'relationship-integrity' };
  if (id.startsWith('IN-A')) return { kind: 'Rule', ruleClass: 'autonomy-constraint' };
  if (id.startsWith('TX-G')) return { kind: 'Rule', ruleClass: 'classification-governance' };
  return { kind: 'Rule', ruleClass: 'rule' };
}
