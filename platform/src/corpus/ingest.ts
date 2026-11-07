import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry, Candidate } from '../registry/types.ts';
import type { LifecycleDefinition } from '../registry/fabric.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { ConstitutionSources } from '../constitution/sources.ts';
import { items, keyValues, type Block, type CorpusDocument, type Interpretation, type ParsedSource, type Section, type Subsection } from './parser.ts';

export interface Finding {
  severity: 'info' | 'warning' | 'refusal';
  rule: string;
  source: string;
  line: number;
  subject: string;
  message: string;
}

export interface CoverageRow {
  source: string;
  line: number;
  level: number;
  text: string;
  artifact: string | null;
  status: 'registered' | 'referenced' | 'refused';
  note: string;
}

type Roles = { author: Actor; ratifiers: Actor[]; certifier: Actor };

const rx = (s: string, f = '') => new RegExp(s, f);

/**
 * Ingests the constitutional corpus as registered, governed artifacts. Every
 * heading of every source is mapped to the artifact that now holds its
 * content (UCI-016). Restatements are referenced, not duplicated (UCI-003);
 * superseding versions supersede (Phase 001 §6); refusals are recorded with
 * the rule that refused them — nothing is silently dropped.
 */
export class CorpusIngestor {
  private readonly p: Platform;
  private readonly it: Interpretation;
  private readonly findings: Finding[] = [];
  private readonly coverage = new Map<string, CoverageRow>();
  private readonly universeEntries = new Map<string, string>();
  private readonly docEntries = new Map<string, string>();
  private readonly futureDependencies = new Map<string, Set<string>>();
  private readonly pendingDependencies: { from: string; to: string; source: string; line: number; direction: string }[] = [];
  private readonly invariantsForReasoning: { ns: string; id: string; statement: string; source: string; line: number }[] = [];
  private readonly definedCodes = new Set<string>();
  private readonly titleByCode = new Map<string, string>();
  private roles!: Roles;
  private stats: Record<string, number> = {};

  constructor(p: Platform, it: Interpretation) {
    this.p = p;
    this.it = it;
  }

  private count(kind: string): void {
    this.stats[kind] = (this.stats[kind] ?? 0) + 1;
  }

  private cover(source: string, line: number, level: number, text: string, artifact: string | null, status: CoverageRow['status'], note = ''): void {
    const key = `${source}|${line}`;
    const existing = this.coverage.get(key);
    if (existing && existing.status === 'registered' && status !== 'registered') return;
    this.coverage.set(key, { source, line, level, text, artifact, status, note });
  }

  private find(severity: Finding['severity'], rule: string, source: string, line: number, subject: string, message: string): void {
    this.findings.push({ severity, rule, source, line, subject, message });
  }

  /** Admits through the constitutional pipeline; returns null (with a recorded refusal) on failure. */
  private admit(c: Candidate, source: string, line: number): Entry | null {
    try {
      const e = this.p.fabric.admitCertified(c, this.roles, 'CORPUS');
      this.count(c.kind);
      return e;
    } catch (err) {
      const ce = err as ConstitutionalError;
      this.find('refusal', ce.rule ?? 'unknown', source, line, `${c.kind} ${c.name}`, ce.message);
      return null;
    }
  }

  private existing(ns: string, kind: string, name: string, qualifier?: string): Entry | undefined {
    const qn = qualifier ? `${ns}:${qualifier}:${kind}:${name}` : `${ns}:${kind}:${name}`;
    const row = this.p.store.headByQualifiedName(qn);
    return row ? (JSON.parse(row.body) as Entry) : undefined;
  }

  private cite(e: Entry, source: string, line: number, note: string): void {
    this.p.fabric.amend(e.canonicalId, this.roles.author, (x) => {
      const cites = ((x.content.citations as unknown[]) ?? []) as { source: string; line: number; note: string }[];
      if (!cites.some((c) => c.source === source && c.line === line)) cites.push({ source, line, note });
      x.content.citations = cites;
    }, 'CITE');
  }

  // ── entry point ─────────────────────────────────────────────────────────

  ingest(parsed: ParsedSource[], roles: Roles, progress?: (msg: string) => void): { stats: Record<string, number>; findings: Finding[]; coverage: CoverageRow[] } {
    this.roles = roles;
    const docs = parsed.flatMap((s) => s.documents.map((d) => ({ s, d })));
    for (const { d } of docs) if (d.code && d.code !== this.it.rootNamespace) {
      this.definedCodes.add(d.code);
      if (!this.titleByCode.has(d.code) && !d.codeInherited) this.titleByCode.set(d.code, d.title);
    }
    this.universeEntries.set(this.it.rootNamespace, this.p.fabric.resolve(`UNI:${this.it.rootNamespace}`).entry.canonicalId);
    let n = 0;
    const limit = Number(process.env.UCOS_INGEST_LIMIT ?? Infinity);
    for (const { s, d } of docs.slice(0, limit)) {
      n++;
      if (progress && n % 10 === 0) progress(`documents ${n}/${docs.length} · entries ${Object.values(this.stats).reduce((a, b) => a + b, 0)}`);
      this.p.store.tx(() => this.ingestDocument(s, d));
    }
    this.p.store.tx(() => this.resolveDependencies());
    this.p.store.tx(() => this.applyInvariantSemantics());
    for (const s of parsed) {
      for (const h of s.headings) {
        const key = `${s.source.id}|${h.line}`;
        if (!this.coverage.has(key)) this.cover(s.source.id, h.line, h.level, h.text, null, 'refused', 'heading not mapped by any ingestion rule');
      }
    }
    this.persistCoverage();
    return { stats: this.stats, findings: this.findings, coverage: [...this.coverage.values()] };
  }

  // ── universes ───────────────────────────────────────────────────────────

  ensureUniverse(code: string, title: string, source: string, line: number, statement?: string): string | null {
    const known = this.universeEntries.get(code);
    if (known) return known;
    const existing = this.p.fabric.tryResolve(`UNI:${code}`);
    if (existing) {
      this.universeEntries.set(code, existing.entry.canonicalId);
      return existing.entry.canonicalId;
    }
    const e = this.p.universes.register({ code, name: title || `${code} Universe`, statement: statement || `The constitutional universe ${code}: ${title}.`, source, locator: `line ${line}` }, this.roles);
    if (!e) {
      this.find('refusal', 'UCI-016', source, line, `Universe ${code}`, 'universe could not be registered');
      return null;
    }
    this.count('Universe');
    this.universeEntries.set(code, e.canonicalId);
    return e.canonicalId;
  }

  private universeTitle(code: string): string {
    const raw = this.titleByCode.get(code) ?? `${code} Universe`;
    return raw.replace(new RegExp(`\\(?${code}\\s*Ω∞\\)?`), '').replace(/\s+/g, ' ').replace(/[,&]\s*$/, '').trim() || `${code} Universe`;
  }

  // ── documents ───────────────────────────────────────────────────────────

  private ingestDocument(s: ParsedSource, d: CorpusDocument): void {
    const ns = d.code ?? this.it.rootNamespace;
    const src = s.source.id;
    if (ns !== this.it.rootNamespace) {
      const purpose = d.sections.find((x) => x.role === 'purpose' || x.role === 'rationale');
      const statement = purpose ? firstText(purpose.blocks) : undefined;
      if (!this.ensureUniverse(ns, this.universeTitle(ns), src, d.line, statement ? `${this.universeTitle(ns)} (${ns}). ${statement}` : undefined)) return;
    }
    const docEntry = this.admit(
      {
        kind: 'CorpusDocument',
        namespace: ns,
        name: `${src} ${d.label}${d.sectionRange ? ` ${d.sectionRange}` : ''}`.trim(),
        statement: '',
        content: { qualifier: d.key, source: src, key: d.key, label: d.label, title: d.title, partNumber: d.partNumber, version: d.version, supersedes: d.supersedes, lines: [d.line, d.endLine], declaredAuthorities: d.declaredAuthorities, metadata: d.metadata, universeCodeInherited: d.codeInherited, preamble: d.preamble.map(blockText) },
        labels: { [this.p.cfg.platform.defaultLocale]: d.title || d.label },
        descriptors: [d.title, d.label, ...d.declaredAuthorities].filter(Boolean),
        provenance: { source: src, locator: `lines ${d.line}-${d.endLine}` },
        relationships: this.universeEntries.get(ns) ? [{ type: 'PART-OF', target: this.universeEntries.get(ns)! }] : [],
      },
      src,
      d.line,
    );
    for (const hl of d.headingLines) this.cover(src, hl, 1, `document ${d.label}`, docEntry?.canonicalId ?? null, docEntry ? 'registered' : 'refused');
    if (!docEntry) return;
    const firstSection = d.sections[0]?.line ?? d.endLine + 1;
    for (const h of s.headings) if (h.line >= d.line && h.line < firstSection && h.level > 1) this.cover(src, h.line, h.level, h.text, docEntry.canonicalId, 'registered', 'document subtitle');
    this.docEntries.set(d.key, docEntry.canonicalId);
    if (d.supersedes) this.supersedeDocument(d, docEntry, ns, src);
    else if (d.version && d.partNumber) {
      const base = [...this.docEntries.entries()].map(([, id]) => this.p.fabric.get(id)!).find((e) => e.canonicalId !== docEntry.canonicalId && e.content.partNumber === d.partNumber && e.content.version === d.version && e.content.supersedes);
      if (base) this.p.fabric.relate('PART-OF', docEntry.canonicalId, base.canonicalId, this.roles.author);
    }
    if (d.partNumber && /[A-Z]$/.test(d.partNumber)) {
      const parent = [...this.docEntries.values()].map((id) => this.p.fabric.get(id)!).find((e) => e.content.partNumber === d.partNumber!.replace(/[A-Z]$/, '') && e.classification.namespace === ns);
      if (parent) this.p.fabric.relate('PART-OF', docEntry.canonicalId, parent.canonicalId, this.roles.author, { context: { role: 'addendum incorporated into its part' } });
    }
    for (const b of d.preamble) this.scanUniverseRefs(b, ns, src, 'mention');
    for (const section of d.sections) this.ingestSection(src, d, section, ns, docEntry);
  }

  private supersedeDocument(d: CorpusDocument, docEntry: Entry, ns: string, src: string): void {
    const prior = [...this.docEntries.values()]
      .map((id) => this.p.fabric.get(id)!)
      .filter((e) => e.canonicalId !== docEntry.canonicalId && e.classification.namespace === ns && e.content.partNumber === d.partNumber && (e.content.version ?? '1.0') === d.supersedes && e.lifecycle.status === 'CERTIFIED');
    const target = prior[0] ?? [...this.docEntries.values()].map((id) => this.p.fabric.get(id)!).find((e) => e.canonicalId !== docEntry.canonicalId && e.classification.namespace === ns && e.content.partNumber === d.partNumber && !e.content.version && e.lifecycle.status === 'CERTIFIED');
    if (!target) {
      this.find('warning', 'V-FR-10', src, d.line, d.label, `declares SUPERSEDES ${d.supersedes} but no prior version of part ${d.partNumber} resolves`);
      return;
    }
    try {
      this.p.fabric.supersede(target.canonicalId, docEntry.canonicalId, this.roles.author, 'INCOMPATIBLE');
      this.find('info', 'Phase001-§6', src, d.line, d.label, `supersedes ${target.canonicalId} (${String(target.content.label)})`);
    } catch (err) {
      this.find('refusal', (err as ConstitutionalError).rule, src, d.line, d.label, (err as Error).message);
    }
  }

  // ── sections ────────────────────────────────────────────────────────────

  private ingestSection(src: string, d: CorpusDocument, section: Section, ns: string, docEntry: Entry): void {
    const name = `${section.number ? `${section.number}. ` : ''}${section.title}`.slice(0, 240);
    const entry = this.admit(
      {
        kind: 'CorpusSection',
        namespace: ns,
        name,
        statement: '',
        content: {
          qualifier: `${d.key}@${section.line}`,
          document: docEntry.canonicalId,
          number: section.number,
          title: section.title,
          role: section.role,
          lines: [section.line, section.endLine],
          text: section.blocks.map(blockText),
          subsections: section.subsections.map((sub) => ({ title: sub.title, role: sub.role, line: sub.line, items: sub.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs).map((i) => i.text)) })),
        },
        labels: { [this.p.cfg.platform.defaultLocale]: section.title },
        descriptors: [section.title, section.role],
        provenance: { source: src, locator: `lines ${section.line}-${section.endLine}` },
        relationships: [{ type: 'PART-OF', target: docEntry.canonicalId }],
      },
      src,
      section.line,
    );
    for (const hl of section.headingLines) this.cover(src, hl, 1, section.title, entry?.canonicalId ?? null, entry ? 'registered' : 'refused');
    if (!entry) return;
    const direction = { value: '' };
    for (const b of section.blocks) this.scanUniverseRefs(b, ns, src, section.role === 'dependencies' || section.role === 'status' ? 'dependency' : 'mention', section.title, direction);
    for (const sub of section.subsections) this.cover(src, sub.line, sub.level, sub.title, entry.canonicalId, 'registered', 'held within its section');

    let authority: Entry | null = null;
    if (section.role === 'authority') authority = this.ingestAuthority(src, d, section, ns, entry);
    if (section.role === 'laws' || section.role === 'invariants') this.ingestRuleSection(src, d, section, ns, entry, section.role === 'invariants' ? 'Invariant' : 'Law');
    if (section.role === 'status') this.ingestStatus(src, section, ns);
    if (section.role === 'ontology') this.ingestOntology(src, d, section, ns, entry);
    if (ns === this.it.rootNamespace) this.ingestConstitutionalModels(src, d, section, entry);
    for (const sub of section.subsections) this.ingestSubsection(src, d, section, sub, ns, entry, authority);
  }

  private ingestAuthority(src: string, d: CorpusDocument, section: Section, ns: string, sectionEntry: Entry): Entry | null {
    const title = section.title.replace(/\s+/g, ' ').trim();
    const defSub = section.subsections.find((s) => s.role === 'definition');
    const definition = defSub ? firstText(defSub.blocks) : firstText(section.blocks);
    const owns = section.subsections.filter((s) => s.role === 'ownership').flatMap((s) => s.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs).map((i) => i.text)));
    const notOwns = section.subsections.filter((s) => s.role === 'nonOwnership').flatMap((s) => s.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs).map((i) => i.text)));
    const qualifier = d.version ? `v${d.version}` : undefined;
    const prior = this.existing(ns, 'Authority', title, qualifier) ?? (qualifier ? undefined : this.existing(ns, 'Authority', title));
    if (prior) {
      this.cite(prior, src, section.line, `restated in ${d.label}`);
      this.p.fabric.relate('REFERENCES', sectionEntry.canonicalId, prior.canonicalId, this.roles.author, { context: { role: 'restatement' } });
      this.find('info', 'UCI-003', src, section.line, title, `restatement of ${prior.canonicalId}; referenced, not redefined`);
      return prior;
    }
    const candidate: Candidate = {
      kind: 'Authority',
      namespace: ns,
      name: title,
      statement: definition || `${title} is a constitutional authority of ${ns}.`,
      content: { ...(qualifier ? { qualifier } : {}), section: sectionEntry.canonicalId, document: d.key, owns, notOwns, number: section.number, universe: ns },
      labels: { [this.p.cfg.platform.defaultLocale]: title },
      descriptors: [title, ...owns.slice(0, 20)],
      provenance: { source: src, locator: `line ${section.line}` },
      relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }],
    };
    let e = this.admitQuiet(candidate);
    if (!e.entry && e.rule === 'UCI-003') {
      // Two distinct authorities stated with the same sentence: the statement is scoped by its authority.
      e = this.admitQuiet({ ...candidate, statement: `${title}: ${candidate.statement}` });
      if (e.entry) this.find('info', 'UCI-003', src, section.line, title, 'definition sentence shared with another authority; statement scoped by authority name');
    }
    if (!e.entry) {
      this.find('refusal', e.rule ?? 'unknown', src, section.line, `Authority ${title}`, e.message ?? '');
      return null;
    }
    this.count('Authority');
    if (qualifier) {
      const earlier = this.existing(ns, 'Authority', title);
      if (earlier && earlier.lifecycle.status === 'CERTIFIED' && earlier.canonicalId !== e.entry.canonicalId) {
        try {
          this.p.fabric.supersede(earlier.canonicalId, e.entry.canonicalId, this.roles.author, 'INCOMPATIBLE');
        } catch (err) {
          this.find('warning', (err as ConstitutionalError).rule, src, section.line, title, (err as Error).message);
        }
      }
    }
    for (const hl of section.headingLines) this.cover(src, hl, 1, title, e.entry.canonicalId, 'registered');
    return e.entry;
  }

  private admitQuiet(c: Candidate): { entry: Entry | null; rule?: string; message?: string } {
    try {
      return { entry: this.p.fabric.admitCertified(c, this.roles, 'CORPUS') };
    } catch (err) {
      return { entry: null, rule: (err as ConstitutionalError).rule, message: (err as Error).message };
    }
  }

  // ── laws and invariants ─────────────────────────────────────────────────

  private ingestRuleSection(src: string, d: CorpusDocument, section: Section, ns: string, sectionEntry: Entry, kind: 'Law' | 'Invariant'): void {
    const idRx = rx(this.it.identifiedRule);
    let found = 0;
    // H2-identified rules: "## URL-001" followed by a statement block.
    for (const sub of section.subsections.filter((s) => s.role === 'identified')) {
      const statement = sub.blocks.map((b) => b.lines.map((l) => l.trim()).filter(Boolean).join(' ')).join(' ').trim();
      const id = idRx.test(sub.title) ? sub.title.trim() : `${section.number ? `${section.number}. ` : ''}${section.title} — ${sub.title.trim()}`;
      this.registerRule(kind, id, null, statement, ns, src, sub.line, sub.level, sectionEntry, d);
      found++;
    }
    // ID blocks inside code blocks: "UMQSOL-001\nEvery …".
    for (const b of section.blocks.filter((x) => x.kind === 'code' || x.kind === 'text')) {
      const blocks = ConstitutionSources.idBlocks(b.lines.join('\n'), idRx);
      for (const ib of blocks) {
        const offset = b.lines.findIndex((l) => l.trim() === ib.id);
        this.registerRule(kind, ib.id, ib.name, ib.statement, ns, src, b.line + (b.kind === 'code' ? 1 : 0) + Math.max(offset, 0), 0, sectionEntry, d);
        found++;
      }
    }
    // Unidentified rules: each statement line of the section body is one rule.
    if (found === 0) {
      let k = 0;
      for (const b of section.blocks) {
        for (const it of items(b, this.it.treeGlyphs, this.it.flowGlyphs)) {
          if (it.text.length < 8) continue;
          k++;
          this.registerRule(kind, `${d.key} §${section.number ?? section.title} #${k}`, null, it.text, ns, src, it.line, 0, sectionEntry, d);
        }
      }
      if (k === 0) this.find('warning', 'UCI-016', src, section.line, section.title, `${kind} section states no rule`);
    }
  }

  private registerRule(kind: 'Law' | 'Invariant' | 'Rule', id: string, name: string | null, statement: string, ns: string, src: string, line: number, level: number, sectionEntry: Entry, d: CorpusDocument): void {
    if (!statement) {
      this.find('warning', 'UCI-016', src, line, id, `${kind} ${id} has no statement`);
      if (level) this.cover(src, line, level, id, sectionEntry.canonicalId, 'referenced', 'empty statement');
      return;
    }
    const prior = this.existing(ns, kind, id);
    if (prior) {
      const same = prior.definition.canonicalStatement.replace(/\s+/g, ' ').toLowerCase() === statement.replace(/\s+/g, ' ').toLowerCase();
      if (same) {
        this.cite(prior, src, line, `restated in ${d.label}`);
        if (level) this.cover(src, line, level, id, prior.canonicalId, 'registered', 'restatement referenced');
        return;
      }
      const variant = this.admitRuleOrAlias(this.ruleCandidate(kind, id, name, statement, ns, src, line, sectionEntry, d, d.key), kind, id, ns, src, line);
      if (variant && variant.canonicalId !== prior.canonicalId) {
        this.p.fabric.relate('REFERENCES', variant.canonicalId, prior.canonicalId, this.roles.author, { context: { role: 'same identifier, different statement' } });
        this.find('warning', 'UCI-017', src, line, id, `identifier ${id} is stated twice in ${ns} with different text; the later statement is registered with qualifier ${d.key} and references ${prior.canonicalId}`);
      }
      if (level) this.cover(src, line, level, id, variant?.canonicalId ?? null, variant ? 'registered' : 'refused');
      return;
    }
    const e = this.admitRuleOrAlias(this.ruleCandidate(kind, id, name, statement, ns, src, line, sectionEntry, d), kind, id, ns, src, line);
    if (level) this.cover(src, line, level, id, e?.canonicalId ?? null, e ? 'registered' : 'refused');
    if (e && kind === 'Invariant') this.invariantsForReasoning.push({ ns, id: e.canonicalId, statement, source: src, line });
  }

  /** Admits a rule; the same statement under a second identifier becomes an alias of the first (UCI-003, V-ID-02). */
  private admitRuleOrAlias(candidate: Candidate, kind: string, id: string, ns: string, src: string, line: number): Entry | null {
    const attempt = this.admitQuiet(candidate);
    if (attempt.entry) {
      this.count(kind);
      return attempt.entry;
    }
    if (attempt.rule === 'UCI-003') {
      const holder = /duplicates (UCOS-[A-Z0-9-]+)/.exec(attempt.message ?? '')?.[1];
      const existingEntry = holder ? this.p.fabric.get(holder) : undefined;
      if (existingEntry) {
        const alias = `${ns}:${id}`;
        if (/^[A-Z][A-Z0-9]{1,14}(-[A-Z]{2,10})?-\d{3}$/.test(id) && !this.p.store.resolveAlias(alias)) {
          this.p.fabric.amend(existingEntry.canonicalId, this.roles.author, (x) => {
            x.identity.aliases.push(alias);
          }, 'ALIAS');
          this.p.store.bindAlias(alias, existingEntry.canonicalId, 'alias');
        }
        this.cite(existingEntry, src, line, `${id} restates this statement`);
        this.find('info', 'UCI-003', src, line, id, `${id} states the same as ${existingEntry.canonicalId}; recorded as an alias, not a second definition`);
        return existingEntry;
      }
    }
    this.find('refusal', attempt.rule ?? 'unknown', src, line, `${kind} ${id}`, attempt.message ?? '');
    return null;
  }

  private ruleCandidate(kind: 'Law' | 'Invariant' | 'Rule', id: string, name: string | null, statement: string, ns: string, src: string, line: number, sectionEntry: Entry, d: CorpusDocument, qualifier?: string): Candidate {
    const formal = this.formalise(statement);
    return {
      kind,
      namespace: ns,
      name: id,
      statement,
      aliases: /^[A-Z][A-Z0-9]{1,14}(-[A-Z]{2,10})?-\d{3}$/.test(id) && !qualifier ? [`${ns}:${id}`] : [],
      content: { ...(qualifier ? { qualifier } : {}), identifier: id, title: name, section: sectionEntry.canonicalId, document: d.key, universe: ns, formalPattern: formal, ruleClass: kind === 'Rule' ? 'principle' : kind.toLowerCase() },
      labels: { [this.p.cfg.platform.defaultLocale]: name ?? id },
      descriptors: [id, name ?? ''].filter(Boolean),
      provenance: { source: src, locator: `line ${line}` },
      relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }],
    };
  }

  /** Recognises the formal shape of a law or invariant (for the Reasoning Engine and the Law layer). */
  private formalise(statement: string): Record<string, string> | null {
    const s = statement.replace(/\s+/g, ' ').trim();
    const dis = rx(this.it.invariantPatterns.disjointness, 'i').exec(s);
    if (dis && !/\bonly\b|\bmerely\b/i.test(s)) return { pattern: 'disjointness', left: dis[1].trim(), right: dis[2].trim() };
    const pos = rx(this.it.invariantPatterns.possession, 'i').exec(s);
    if (pos) return { pattern: 'possession', subject: pos[1].trim(), property: pos[2].trim() };
    const neg = rx(this.it.invariantPatterns.nonNegative, 'i').exec(s);
    if (neg) return { pattern: 'non-negative', subject: neg[1].trim() };
    return null;
  }

  // ── status, ontology, dependencies ──────────────────────────────────────

  private ingestStatus(src: string, section: Section, ns: string): void {
    const kv = keyValues(section.blocks);
    const universe = this.universeEntries.get(ns);
    if (!universe) return;
    this.p.fabric.amend(universe, this.roles.author, (e) => {
      e.content.constitutionalStatus = { ...((e.content.constitutionalStatus as object) ?? {}), ...kv };
    }, 'STATUS');
    for (const [k, v] of Object.entries(kv)) {
      const direction = rx(this.it.dependencyDirection.consumes, 'i').test(k) ? 'consumes' : rx(this.it.dependencyDirection.supports, 'i').test(k) ? 'supports' : null;
      if (!direction) continue;
      for (const m of v.matchAll(rx(this.it.universeCodeInline, 'g'))) this.pendingDependencies.push({ from: ns, to: m[1], source: src, line: section.line, direction });
    }
  }

  private scanUniverseRefs(b: Block, ns: string, src: string, mode: 'dependency' | 'mention', title = '', state: { value: string } = { value: '' }): void {
    if (mode !== 'dependency') return;
    let direction = state.value || (rx(this.it.dependencyDirection.supports, 'i').test(title) ? 'supports' : 'consumes');
    b.lines.forEach((line, i) => {
      if (rx(this.it.dependencyDirection.supports, 'i').test(line)) direction = 'supports';
      else if (rx(this.it.dependencyDirection.consumes, 'i').test(line)) direction = 'consumes';
      for (const m of line.matchAll(rx(this.it.universeCodeInline, 'g'))) {
        if (m[1] === ns) continue;
        this.pendingDependencies.push({ from: ns, to: m[1], source: src, line: b.line + i + 1, direction });
      }
    });
    state.value = direction;
  }

  /** Root ontology hierarchies become a scheme whose levels refine one another. */
  private ingestOntology(src: string, d: CorpusDocument, section: Section, ns: string, sectionEntry: Entry): void {
    const levels = section.blocks.filter((b) => b.kind === 'code').flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs));
    if (levels.length < 2) return;
    this.ingestTaxonomy(src, d, section, { title: section.title, line: section.line, level: 1, role: 'taxonomy', blocks: section.blocks.filter((b) => b.kind === 'code') }, ns, sectionEntry, true);
  }

  private resolveDependencies(): void {
    const seen = new Set<string>();
    for (const dep of this.pendingDependencies) {
      const [from, to] = dep.direction === 'supports' ? [dep.to, dep.from] : [dep.from, dep.to];
      const key = `${from}>${to}`;
      if (seen.has(key) || from === to) continue;
      seen.add(key);
      const a = this.universeEntries.get(from);
      const b = this.universeEntries.get(to);
      if (!a || !b) {
        const missing = !a ? from : to;
        if (!this.futureDependencies.has(missing)) this.futureDependencies.set(missing, new Set());
        this.futureDependencies.get(missing)!.add(!a ? to : from);
        continue;
      }
      try {
        this.p.fabric.relate('DEPENDS-ON', a, b, this.roles.author, { context: { dependencyType: 'CONTRACTUAL', declaredIn: `${dep.source}:${dep.line}` } });
        this.count('UniverseDependency');
      } catch (err) {
        this.find('warning', (err as ConstitutionalError).rule, dep.source, dep.line, `${from} DEPENDS-ON ${to}`, `dependency refused: ${(err as Error).message}`);
      }
    }
    for (const [missing, referrers] of this.futureDependencies) {
      for (const r of referrers) {
        const id = this.universeEntries.get(r);
        if (!id) continue;
        this.p.fabric.amend(id, this.roles.author, (e) => {
          const fut = new Set(((e.content.futureDependencies as string[]) ?? []));
          fut.add(missing);
          e.content.futureDependencies = [...fut];
        }, 'FUTURE-DEPENDENCY');
      }
      this.find('warning', 'Phase001-§5.1', 'corpus', 0, missing, `universe ${missing} is referenced by ${[...referrers].join(', ')} but defined nowhere in the corpus; recorded as a FUTURE dependency (certification withheld for dependents on it)`);
    }
  }

  /** "X is not Y" invariants become DISJOINT-WITH between the concepts or authorities they name. */
  private applyInvariantSemantics(): void {
    for (const inv of this.invariantsForReasoning) {
      const f = this.formalise(inv.statement);
      if (!f || f.pattern !== 'disjointness') continue;
      const a = this.conceptFor(f.left, inv.ns);
      const b = this.conceptFor(f.right, inv.ns);
      if (!a || !b || a === b) {
        this.find('info', 'UCI-013', inv.source, inv.line, inv.statement, `disjointness recorded on the invariant; ${!a ? f.left : f.right} does not name a registered concept or authority`);
        continue;
      }
      try {
        this.p.fabric.relate('DISJOINT-WITH', a, b, this.roles.author, { context: { invariant: inv.id } });
        this.count('Disjointness');
      } catch (err) {
        this.find('warning', (err as ConstitutionalError).rule, inv.source, inv.line, inv.statement, (err as Error).message);
      }
    }
  }

  private conceptFor(name: string, ns: string): string | null {
    const n = name.trim();
    const authority = this.existing(ns, 'Authority', `${n.toUpperCase()} AUTHORITY`) ?? this.existing(ns, 'Authority', `UNIVERSAL ${n.toUpperCase()} AUTHORITY`);
    if (authority) return authority.canonicalId;
    const concept = this.p.ontology.lookup(n);
    return concept ? concept.canonicalId : null;
  }

  // ── subsections by role ─────────────────────────────────────────────────

  private ingestSubsection(src: string, d: CorpusDocument, section: Section, sub: Subsection, ns: string, sectionEntry: Entry, authority: Entry | null): void {
    switch (sub.role) {
      case 'taxonomy':
        this.ingestTaxonomy(src, d, section, sub, ns, sectionEntry, false, authority);
        break;
      case 'model':
        this.ingestModelFromTree(src, d, section, sub, ns, sectionEntry, authority);
        break;
      case 'lifecycle':
        this.ingestLifecycle(src, d, section, sub, ns, sectionEntry, authority);
        break;
      case 'flow':
        this.ingestFlow(src, d, section, sub, ns, sectionEntry, authority);
        break;
      case 'principle': {
        const statement = sub.blocks.map((b) => b.lines.map((l) => l.trim()).filter(Boolean).join(' ')).join(' ').trim();
        const name = `${(authority?.definition.canonicalName ?? section.title).slice(0, 160)} — ${sub.title}`;
        this.registerRule('Rule', name, sub.title, statement, ns, src, sub.line, sub.level, sectionEntry, d);
        break;
      }
      case 'identified':
        if (section.role !== 'laws' && section.role !== 'invariants') {
          const statement = sub.blocks.map((b) => b.lines.map((l) => l.trim()).filter(Boolean).join(' ')).join(' ').trim();
          const kind = /(I|AXIOM|INVARIANT)-\d{3}$/.test(sub.title) ? 'Invariant' : 'Law';
          this.registerRule(kind, sub.title.trim(), null, statement, ns, src, sub.line, sub.level, sectionEntry, d);
        }
        break;
      default:
        break;
    }
  }

  private ingestTaxonomy(src: string, d: CorpusDocument, section: Section, sub: Subsection, ns: string, sectionEntry: Entry, chained: boolean, authority: Entry | null = null): void {
    const list = sub.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs));
    if (!list.length) return;
    const schemeName = `${(authority?.definition.canonicalName ?? section.title).slice(0, 160)} — ${sub.title}`;
    const qualifier = `${d.key}§${section.number ?? section.line}`;
    const scheme =
      this.existing(ns, 'TaxonomyScheme', schemeName, qualifier) ??
      this.admit(
        {
          kind: 'TaxonomyScheme',
          namespace: ns,
          name: schemeName,
          statement: '',
          content: { qualifier, purpose: `Classification stated by ${section.title} (${sub.title})`, scope: sub.title, scopeKinds: [], multiParentAllowed: true, conflictPolicy: 'declared precedence of the owning authority', owner: `${ns} Domain Authority`, section: sectionEntry.canonicalId, ...(chained ? { chained: true } : {}) },
          labels: { [this.p.cfg.platform.defaultLocale]: sub.title },
          descriptors: [sub.title, section.title],
          provenance: { source: src, locator: `line ${sub.line}` },
          relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }, ...(authority ? [{ type: 'OWNED-BY', target: authority.canonicalId }] : [])],
        },
        src,
        sub.line,
      );
    if (sub.level) this.cover(src, sub.line, sub.level, sub.title, scheme?.canonicalId ?? null, scheme ? 'registered' : 'refused');
    if (!scheme) return;
    const stack: { depth: number; id: string }[] = [];
    let previous: string | null = null;
    for (const item of list) {
      const name = item.text.slice(0, 200);
      let taxon = this.existing(ns, 'Taxon', name, scheme.canonicalId);
      if (!taxon) {
        taxon =
          this.admit(
            {
              kind: 'Taxon',
              namespace: ns,
              name,
              statement: '',
              content: { qualifier: scheme.canonicalId, scheme: scheme.canonicalId, admissionRule: null, discriminators: [], attributes: [], policies: [], line: item.line },
              labels: { [this.p.cfg.platform.defaultLocale]: item.text },
              descriptors: [item.text],
              provenance: { source: src, locator: `line ${item.line}` },
              relationships: [{ type: 'MEMBER-OF', target: scheme.canonicalId }],
            },
            src,
            item.line,
          ) ?? undefined;
      }
      if (!taxon) continue;
      while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop();
      const parent: string | null = chained ? previous : (stack[stack.length - 1]?.id ?? null);
      if (parent && parent !== taxon.canonicalId) {
        try {
          this.p.fabric.relate('NARROWER-THAN', taxon.canonicalId, parent, this.roles.author);
        } catch (err) {
          this.find('warning', (err as ConstitutionalError).rule, src, item.line, name, (err as Error).message);
        }
      }
      stack.push({ depth: item.depth, id: taxon.canonicalId });
      previous = taxon.canonicalId;
    }
  }

  private semanticTypeOf(name: string): { semanticType: string; cardinality: 'one' | 'many' } {
    const clean = name.replace(/\(.*?\)/g, '').replace(/\[\]$/, '').trim();
    const hint = this.it.attributeSemanticHints[clean] ?? this.it.attributeSemanticHints[clean.replace(/s$/, '')];
    const plural = /[^s]s$/.test(clean) || /\[\]$/.test(name) || /ies$/.test(clean);
    const singular = clean.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
    const concept = this.p.ontology.lookup(clean) ?? this.p.ontology.lookup(singular);
    return { semanticType: hint ?? concept?.alias ?? 'C-22', cardinality: plural ? 'many' : 'one' };
  }

  private registerModel(src: string, name: string, attributes: { name: string; line: number; depth: number }[], ns: string, qualifier: string | undefined, sectionEntry: Entry, line: number, authority: Entry | null, statement = ''): Entry | null {
    let model = this.existing(ns, 'Model', name, qualifier);
    if (!model) {
      model =
        this.admit(
          {
            kind: 'Model',
            namespace: ns,
            name,
            statement,
            content: { ...(qualifier ? { qualifier } : {}), section: sectionEntry.canonicalId, owningUniverse: ns, attributeCount: attributes.length },
            labels: { [this.p.cfg.platform.defaultLocale]: name },
            descriptors: [name, ...attributes.map((a) => a.name).slice(0, 30)],
            provenance: { source: src, locator: `line ${line}` },
            relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }, ...(authority ? [{ type: 'OWNED-BY', target: authority.canonicalId }] : [])],
          },
          src,
          line,
        ) ?? undefined;
    }
    if (!model) return null;
    const known = new Set(this.p.store.edgesTo(model.canonicalId, 'MEMBER-OF').map((e) => this.p.store.head(e.source)?.canonical_name));
    const parents: { depth: number; id: string }[] = [];
    attributes.forEach((a, position) => {
      const attrName = a.name.replace(/\s+/g, ' ').slice(0, 200);
      if (known.has(attrName)) return;
      known.add(attrName);
      const { semanticType, cardinality } = this.semanticTypeOf(a.name);
      while (parents.length && parents[parents.length - 1].depth >= a.depth) parents.pop();
      const parent = parents[parents.length - 1]?.id;
      const attr = this.admit(
        {
          kind: 'Attribute',
          namespace: ns === this.it.rootNamespace ? this.it.rootNamespace : ns,
          name: attrName,
          statement: '',
          content: { qualifier: model!.canonicalId, model: model!.canonicalId, semanticType, cardinality, position, parentAttribute: parent ?? null },
          labels: { [this.p.cfg.platform.defaultLocale]: attrName },
          descriptors: [attrName],
          provenance: { source: src, locator: `line ${a.line}` },
          relationships: [{ type: 'MEMBER-OF', target: model!.canonicalId }],
        },
        src,
        a.line,
      );
      if (attr) parents.push({ depth: a.depth, id: attr.canonicalId });
    });
    return model;
  }

  private ingestModelFromTree(src: string, d: CorpusDocument, section: Section, sub: Subsection, ns: string, sectionEntry: Entry, authority: Entry | null): void {
    const list = sub.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs));
    if (!list.length) {
      this.cover(src, sub.line, sub.level, sub.title, sectionEntry.canonicalId, 'registered', 'structure stated in prose, held within its section');
      return;
    }
    const minDepth = Math.min(...list.map((i) => i.depth));
    const rootIsName = list.length > 1 && list[0].depth === minDepth && list.slice(1).every((i) => i.depth > minDepth || i.depth === minDepth) && list.filter((i) => i.depth === minDepth).length === 1;
    const name = rootIsName ? list[0].text : `${(authority?.definition.canonicalName ?? section.title).slice(0, 160)} — ${sub.title}`;
    const attrs = (rootIsName ? list.slice(1) : list).map((i) => ({ name: i.text, line: i.line, depth: i.depth }));
    const model = this.registerModel(src, name.slice(0, 200), attrs, ns, `${d.key}§${section.number ?? section.line}`, sectionEntry, sub.line, authority);
    this.cover(src, sub.line, sub.level, sub.title, model?.canonicalId ?? null, model ? 'registered' : 'refused');
  }

  private stepsOf(sub: Subsection): { text: string; line: number }[] {
    return sub.blocks.flatMap((b) => items(b, this.it.treeGlyphs, this.it.flowGlyphs)).map((i) => ({ text: i.text.slice(0, 200), line: i.line }));
  }

  private ingestLifecycle(src: string, d: CorpusDocument, section: Section, sub: Subsection, ns: string, sectionEntry: Entry, authority: Entry | null): void {
    const steps = this.stepsOf(sub);
    const unique = [...new Map(steps.map((s) => [s.text, s])).values()];
    if (unique.length < 2) {
      this.cover(src, sub.line, sub.level, sub.title, sectionEntry.canonicalId, 'registered', 'lifecycle stated in prose, held within its section');
      return;
    }
    const states = unique.map((s) => s.text);
    const transitions: LifecycleDefinition['transitions'] = [];
    for (let i = 0; i < steps.length - 1; i++) {
      const from = steps[i].text;
      const to = steps[i + 1].text;
      if (from === to || transitions.some((t) => t.from === from && t.to === to)) continue;
      const cycle = states.indexOf(to) <= states.indexOf(from);
      transitions.push({ from, to, ...(cycle ? { cycle: true } : {}) });
    }
    const name = `${(authority?.definition.canonicalName ?? section.title).slice(0, 160)} — ${sub.title}`;
    const qualifier = `${d.key}§${section.number ?? section.line}`;
    const definition: LifecycleDefinition = { id: `${ns}:${qualifier}:${sub.title}`, name, states, initial: states[0], terminals: [states[states.length - 1]], transitions, source: `${src} line ${sub.line}` };
    const e =
      this.existing(ns, 'Lifecycle', name, qualifier) ??
      this.admit(
        {
          kind: 'Lifecycle',
          namespace: ns,
          name,
          statement: '',
          content: { qualifier, definition, section: sectionEntry.canonicalId },
          labels: { [this.p.cfg.platform.defaultLocale]: sub.title },
          descriptors: [sub.title, ...states.slice(0, 20)],
          provenance: { source: src, locator: `line ${sub.line}` },
          relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }, ...(authority ? [{ type: 'OWNED-BY', target: authority.canonicalId }] : [])],
        },
        src,
        sub.line,
      );
    this.cover(src, sub.line, sub.level, sub.title, e?.canonicalId ?? null, e ? 'registered' : 'refused');
  }

  private ingestFlow(src: string, d: CorpusDocument, section: Section, sub: Subsection, ns: string, sectionEntry: Entry, authority: Entry | null): void {
    const steps = this.stepsOf(sub);
    if (!steps.length) {
      this.cover(src, sub.line, sub.level, sub.title, sectionEntry.canonicalId, 'registered', 'flow stated in prose, held within its section');
      return;
    }
    const name = `${(authority?.definition.canonicalName ?? section.title).slice(0, 160)} — ${sub.title}`;
    const qualifier = `${d.key}§${section.number ?? section.line}`;
    const e =
      this.existing(ns, 'Flow', name, qualifier) ??
      this.admit(
        {
          kind: 'Flow',
          namespace: ns,
          name,
          statement: '',
          content: { qualifier, steps: steps.map((s) => s.text), section: sectionEntry.canonicalId },
          labels: { [this.p.cfg.platform.defaultLocale]: sub.title },
          descriptors: [sub.title, ...steps.map((s) => s.text).slice(0, 20)],
          provenance: { source: src, locator: `line ${sub.line}` },
          relationships: [{ type: 'PART-OF', target: sectionEntry.canonicalId }, ...(authority ? [{ type: 'OWNED-BY', target: authority.canonicalId }] : [])],
        },
        src,
        sub.line,
      );
    this.cover(src, sub.line, sub.level, sub.title, e?.canonicalId ?? null, e ? 'registered' : 'refused');
  }

  /**
   * Constitutional meta models in the phase documents, stated either as
   * trees ("Offer\n├── identity …") or braces ("Entity { identity, … }").
   */
  private ingestConstitutionalModels(src: string, _d: CorpusDocument, section: Section, sectionEntry: Entry): void {
    const blocks = [...section.blocks, ...section.subsections.flatMap((s) => s.blocks)].filter((b) => b.kind === 'code');
    for (const b of blocks) {
      const text = b.lines.join('\n');
      // Tree form: a lone CamelCase root followed by ├── children.
      const lines = b.lines;
      for (let i = 0; i < lines.length - 1; i++) {
        const root = /^([A-Z][A-Za-z]+)\s*$/.exec(lines[i].trim());
        if (!root || !/^[├└]──/.test(lines[i + 1].trim())) continue;
        const attrs: { name: string; line: number; depth: number }[] = [];
        for (let j = i + 1; j < lines.length && /^[\s│├└]/.test(lines[j]) && lines[j].trim(); j++) {
          const m = /^([\s│]*)[├└]──\s+([A-Za-z][A-Za-z0-9]*(?:\[\])?(?:\{\})?)/.exec(lines[j]);
          if (m) attrs.push({ name: m[2].replace(/\{\}$/, ''), line: b.line + 1 + j, depth: Math.floor(m[1].replace(/│/g, ' ').length / 5) });
        }
        if (attrs.length >= 2) this.registerModel(src, root[1], attrs, this.it.rootNamespace, undefined, sectionEntry, b.line + 1 + i, null);
      }
      // Brace form: Name { a, b[], c{x, y} }.
      const brace = /([A-Z][A-Za-z]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = brace.exec(text))) {
        const fields = splitTopLevel(m[2])
          .map((f) => f.replace(/\([^)]*\)/g, '').replace(/\?$/, '').trim())
          .filter((f) => /^[A-Za-z][A-Za-z0-9]*(\[\]|\{.*\})?$/.test(f.split(/\s+/)[0] ?? ''));
        if (fields.length < 2) continue;
        const attrs = fields.map((f) => ({ name: f.split(/\s+/)[0].replace(/\{.*\}$/, ''), line: b.line + 1 + text.slice(0, m!.index).split('\n').length - 1, depth: 0 }));
        this.registerModel(src, m[1], attrs, this.it.rootNamespace, undefined, sectionEntry, attrs[0].line, null);
      }
    }
  }

  // ── coverage persistence ────────────────────────────────────────────────

  private persistCoverage(): void {
    const db = this.p.store.db;
    db.exec('CREATE TABLE IF NOT EXISTS corpus_coverage (source TEXT, line INTEGER, level INTEGER, text TEXT, artifact TEXT, status TEXT, note TEXT, PRIMARY KEY (source, line))');
    db.exec('CREATE TABLE IF NOT EXISTS corpus_findings (id INTEGER PRIMARY KEY AUTOINCREMENT, severity TEXT, rule TEXT, source TEXT, line INTEGER, subject TEXT, message TEXT)');
    this.p.store.tx(() => {
      db.exec('DELETE FROM corpus_coverage');
      db.exec('DELETE FROM corpus_findings');
      const ins = db.prepare('INSERT INTO corpus_coverage VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of this.coverage.values()) ins.run(r.source, r.line, r.level, r.text, r.artifact, r.status, r.note);
      const fin = db.prepare('INSERT INTO corpus_findings (severity, rule, source, line, subject, message) VALUES (?, ?, ?, ?, ?, ?)');
      for (const f of this.findings) fin.run(f.severity, f.rule, f.source, f.line, f.subject.slice(0, 500), f.message.slice(0, 2000));
    });
  }
}

function blockText(b: Block): string {
  return b.lines.join('\n');
}

function firstText(blocks: Block[]): string {
  const i = blocks.findIndex((x) => x.kind === 'text');
  const b = i >= 0 ? blocks[i] : blocks.find((x) => x.kind === 'code');
  if (!b) return '';
  const label = b.lines.map((l) => l.trim()).filter(Boolean).join(' ');
  // A label ("Supports:") introduces the list that follows it; together they are the statement.
  if (i >= 0 && /:$/.test(label) && blocks[i + 1] && blocks[i + 1].kind !== 'text') {
    const listed = blocks[i + 1].lines.map((l) => l.replace(/[├└│─]/g, '').trim()).filter(Boolean);
    return `${label} ${listed.join(', ')}`.replace(/\s+/g, ' ').slice(0, 2000);
  }
  return b.lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 2000);
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
