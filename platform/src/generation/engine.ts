import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { hashValue, sha256, canonicalJson } from '../kernel/hash.ts';
import { platformPath } from '../kernel/config.ts';
import { GENERATORS, type GeneratorOutput, type SourceSet } from './generators.ts';

export interface Preservation {
  identity: { ok: boolean; detail: string };
  type: { ok: boolean; detail: string };
  constraint: { ok: boolean; detail: string };
  relationship: { ok: boolean; detail: string };
  cardinality: { ok: boolean; detail: string };
  lifecycle: { ok: boolean; detail: string };
}

/**
 * Universal Generation Engine (Phase 009). Metadata is canonical; artifacts
 * are derivatives. Every artifact is reproducible (GN-P4), carries a
 * provenance attestation issued by this engine rather than by the generator
 * (GN-S-02), is integrity-checked for hand-edits (GN-P5), and becomes STALE
 * the moment any of its sources changes (Phase 009 §7 step 8).
 */
export class GenerationEngine {
  private readonly p: Platform;
  private readonly sourceIndex = new Map<string, Set<string>>();
  private regenerating = false;
  private attestationKey = '';

  constructor(p: Platform) {
    this.p = p;
  }

  install(key: string): void {
    this.attestationKey = key;
    this.p.validation.registerKind('Generator', (e) => this.validateGenerator(e));
    this.p.validation.registerKind('GeneratedArtifact', (e) => (e.content.attestation && e.content.subjectRef ? [] : [{ rule: 'C-GN-01', message: 'a generated artifact carries a provenance attestation and its source' }]));
    this.p.fabric.hooks.onPersist.push((entry) => this.onSourceChanged(entry));
  }

  hydrate(): void {
    this.sourceIndex.clear();
    for (const a of this.p.fabric.iterate('GeneratedArtifact')) if (a.lifecycle.status !== 'RETIRED') this.index(a);
  }

  private index(a: Entry): void {
    for (const s of (a.content.sources as string[]) ?? []) {
      if (!this.sourceIndex.has(s)) this.sourceIndex.set(s, new Set());
      this.sourceIndex.get(s)!.add(a.canonicalId);
    }
  }

  private validateGenerator(e: Entry): { rule: string; message: string }[] {
    const c = e.content as Record<string, unknown>;
    const out: { rule: string; message: string }[] = [];
    const target = String(c.targetSpace ?? '');
    if (!GENERATORS[target]) out.push({ rule: 'V-GN-01', message: `no transformation is registered for target space ${target}` });
    const proof = c.preservationProof as Record<string, unknown> | undefined;
    for (const prop of ['identity', 'type', 'constraint', 'relationship', 'cardinality', 'lifecycle']) if (!proof?.[prop]) out.push({ rule: 'V-GN-03', message: `preservation proof lacks ${prop}` });
    if (!Array.isArray(c.variants) || (c.variants as unknown[]).length === 0) out.push({ rule: 'GN-P8', message: 'a generator declares its registered target variants' });
    return out;
  }

  generators(): Entry[] {
    return this.p.fabric.query({ kind: 'Generator', limit: 100 }).entries;
  }

  generator(ref: string): Entry {
    const byName = this.generators().find((g) => g.definition.canonicalName === ref || g.content.targetSpace === ref || g.identity.aliases.includes(ref));
    const g = byName ?? this.p.fabric.resolve(ref).entry;
    if (g.kind !== 'Generator') throw new ConstitutionalError('D-GN-01', `${ref} is not a registered generator`);
    return g;
  }

  /** LIST-TARGETS(subject): available target spaces and variants. */
  listTargets(): { generator: string; targetSpace: string; variants: string[]; status: string }[] {
    return this.generators().map((g) => ({ generator: g.canonicalId, targetSpace: String(g.content.targetSpace), variants: (g.content.variants as string[]) ?? [], status: g.lifecycle.status }));
  }

  /** Resolves the canonical metadata a generation reads (Phase 009 §7 step 3). */
  sourceSet(subjectRef: string): SourceSet {
    const f = this.p.fabric;
    const subject = subjectRef === 'UCOS' || f.namespaceKind(subjectRef) ? null : f.resolve(subjectRef).entry;
    let entries: Entry[] = [];
    let scope: SourceSet['scope'];
    if (!subject) {
      scope = { kind: 'namespace', id: subjectRef, name: subjectRef };
      entries = f.query({ namespace: subjectRef, limit: 200_000 }).entries.filter((e) => e.kind !== 'GeneratedArtifact');
    } else if (subject.kind === 'Registry') {
      scope = { kind: 'registry', id: subject.canonicalId, name: subject.definition.canonicalName };
      entries = [subject, ...f.query({ registryId: subject.canonicalId, limit: 200_000 }).entries];
    } else if (subject.kind === 'Composition') {
      scope = { kind: 'composition', id: subject.canonicalId, name: subject.definition.canonicalName };
      const capIds = this.p.composition.allCapabilities(subject);
      const caps = capIds.map((id) => f.require(id));
      const portKinds = new Set(caps.flatMap((c) => [...((c.content.inputs as { type: string }[]) ?? []), ...((c.content.outputs as { type: string }[]) ?? [])].map((pt) => pt.type)));
      const models = this.modelsFor(portKinds);
      const policies = [...new Set(((subject.content.policyEnvelope as { policies: string[] })?.policies ?? []).concat(this.p.policy.policies().map((x) => x.canonicalId)))].map((id) => f.tryResolve(id)?.entry).filter((x): x is Entry => !!x);
      const eventTypes = f.query({ kind: 'EventType', limit: 10_000 }).entries.filter((ev) => ((subject.content.events as string[]) ?? []).includes(ev.definition.canonicalName));
      const lifecycles = f.query({ kind: 'Lifecycle', namespace: 'UCOS', limit: 1000 }).entries;
      const schemes = this.p.commerceSchemes().map((s) => f.require(s));
      const taxa = schemes.flatMap((s) => this.p.taxonomy.taxaOf(s.canonicalId));
      const compositions = ((subject.content.compositions as string[]) ?? []).map((id) => f.require(id));
      // Registries holding the port kinds: their spine renders any kind with no structural model.
      const registries = f.registryDefinitions().filter((r) => r.envelope.kinds.some((k) => portKinds.has(k) || [...portKinds].some((pk) => this.p.ontology.lookup(pk)?.name === k))).map((r) => f.get(r.registryId)).filter((x): x is Entry => !!x);
      entries = [subject, ...compositions, ...caps, ...models.flatMap((m) => [m, ...this.attributesOf(m)]), ...policies, ...eventTypes, ...lifecycles, ...schemes, ...taxa, ...registries];
    } else {
      scope = { kind: 'artifact', id: subject.canonicalId, name: subject.definition.canonicalName };
      const related = f.traverse(subject.canonicalId, { depth: 1, limit: 500 }).nodes.map((n) => f.get(n.id)).filter((x): x is Entry => !!x);
      entries = [subject, ...related, ...(subject.kind === 'Model' ? this.attributesOf(subject) : [])];
    }
    const unique = [...new Map(entries.filter((e) => e.kind !== 'RelationshipInstance' && e.kind !== 'GeneratedArtifact' && e.definition).map((e) => [e.canonicalId, e])).values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
    const ids = new Set(unique.map((e) => e.canonicalId));
    const edges = this.p.store
      .allEffectiveEdges()
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, type: e.type, source: e.source, target: e.target }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { scope, entries: unique, edges, lifecycles: this.p.lifecycles.all(), relationshipTypes: this.p.fabric.relationshipTypes() };
  }

  /** Models whose names match the construct kinds used by a composition's ports. */
  private modelsFor(kinds: Set<string>): Entry[] {
    const names = new Set<string>();
    for (const k of kinds) {
      const concept = this.p.ontology.lookup(k);
      names.add((concept?.name ?? k).toLowerCase());
    }
    return this.p.fabric.query({ kind: 'Model', namespace: 'UCOS', limit: 10_000 }).entries.filter((m) => names.has(m.definition.canonicalName.toLowerCase()));
  }

  attributesOf(model: Entry): Entry[] {
    return this.p.store
      .edgesTo(model.canonicalId, 'MEMBER-OF')
      .map((e) => this.p.fabric.get(e.source))
      .filter((a): a is Entry => !!a && a.kind === 'Attribute')
      .sort((a, b) => Number(a.content.position ?? 0) - Number(b.content.position ?? 0));
  }

  private fingerprint(sources: SourceSet): string {
    return hashValue(sources.entries.map((e) => [e.canonicalId, e.version]));
  }

  private attest(contentHash: string, generator: Entry, fingerprint: string): string {
    return createHmac('sha256', this.attestationKey).update(`${contentHash}|${generator.canonicalId}|${String(generator.content.version)}|${fingerprint}`).digest('hex');
  }

  /**
   * GENERATE(subject, generator, variant, context) → artifact + attestation.
   * Pipeline: authorization → metadata resolution → transformation →
   * preservation check → attestation → publish (Phase 009 §7).
   */
  generate(input: { subject: string; generator: string; variant?: string }, actor: Actor, ctx?: ResolvedContext): Entry {
    const gen = this.generator(input.generator);
    if (!['CERTIFIED', 'ADMISSIBLE'].includes(gen.lifecycle.status)) throw new ConstitutionalError('X-GN-01', `generator ${gen.definition.canonicalName} is ${gen.lifecycle.status}, not certified`);
    const context = ctx ?? this.p.context.forPurpose('generation', { Linguistic: { locale: this.p.cfg.platform.defaultLocale } }, actor);
    const subjectEntry = this.p.fabric.tryResolve(input.subject)?.entry ?? null;
    this.p.policy.enforce({ action: 'generation.generate', subject: subjectEntry, actor, context });
    const variants = (gen.content.variants as string[]) ?? [];
    const variant = input.variant ?? variants[0];
    if (!variants.includes(variant)) throw new ConstitutionalError('GN-P8', `variant ${variant} is not registered for ${gen.definition.canonicalName} (${variants.join(', ')})`);
    this.p.bus.emit({ type: 'gen.request.authorized', subject: subjectEntry?.canonicalId ?? input.subject, actor, payload: { generator: gen.canonicalId, variant }, context: context.record });
    const sources = this.sourceSet(input.subject);
    const transform = GENERATORS[String(gen.content.targetSpace)];
    const output = transform({ p: this.p, sources, variant, mapping: gen.content.transformation as Record<string, unknown>, context, actor, generator: gen });
    const preservation = this.checkPreservation(output, sources);
    const failed = Object.entries(preservation).filter(([, v]) => !v.ok);
    if (failed.length) {
      this.p.bus.emit({ type: 'gen.preservation.failed', subject: subjectEntry?.canonicalId ?? input.subject, actor, payload: { generator: gen.canonicalId, failed: failed.map(([k, v]) => `${k}: ${v.detail}`) }, context: context.record });
      throw new ConstitutionalError('GN-P3', `preservation failed for ${failed.map(([k]) => k).join(', ')}: ${failed.map(([, v]) => v.detail).join('; ')}`);
    }
    // One derivative identity per (subject, generator, variant): unchanged output is returned, changed output regenerates it.
    const existing = this.p.fabric
      .query({ kind: 'GeneratedArtifact', contentPath: 'subjectRef', contentEquals: input.subject, limit: 1000 })
      .entries.find((a) => a.content.generator === gen.canonicalId && a.content.variant === variant && a.lifecycle.status !== 'RETIRED');
    if (existing) {
      const contentHash = hashValue(output.files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => [f.path, sha256(f.content)]));
      if (contentHash === existing.content.contentHash && this.verify(existing.canonicalId, { record: false }).intact) return existing;
      if (!['STALE', 'TAMPERED'].includes(existing.lifecycle.status)) this.markStale(existing, 'regeneration requested with changed output');
      this.regenerating = true;
      try {
        return this.publish(gen, variant, input.subject, sources, output, preservation, actor, context, this.p.fabric.require(existing.canonicalId));
      } finally {
        this.regenerating = false;
      }
    }
    return this.publish(gen, variant, input.subject, sources, output, preservation, actor, context);
  }

  private checkPreservation(out: GeneratorOutput, sources: SourceSet): Preservation {
    const ids = new Set(sources.entries.map((e) => e.canonicalId));
    const cited = new Set(out.trace.map((t) => t.source));
    const uncited = out.trace.filter((t) => !ids.has(t.source));
    return {
      identity: { ok: uncited.length === 0 && out.trace.length > 0, detail: uncited.length ? `${uncited.length} output elements cite no source` : `${cited.size} sources traced` },
      type: { ok: out.unmappedTypes.length === 0, detail: out.unmappedTypes.length ? `unmapped types: ${[...new Set(out.unmappedTypes)].join(', ')}` : 'every construct type mapped' },
      constraint: { ok: out.constraintsRendered >= out.constraintsExpected, detail: `${out.constraintsRendered}/${out.constraintsExpected} constraints rendered` },
      relationship: { ok: out.relationshipsRendered >= out.relationshipsExpected, detail: `${out.relationshipsRendered}/${out.relationshipsExpected} relationships rendered` },
      cardinality: { ok: out.cardinalityPreserved, detail: out.cardinalityPreserved ? 'cardinalities preserved' : 'cardinality mismatch' },
      lifecycle: { ok: out.lifecyclesRendered >= out.lifecyclesExpected, detail: `${out.lifecyclesRendered}/${out.lifecyclesExpected} lifecycles rendered` },
    };
  }

  private outputDir(artifactId: string): string {
    return join(platformPath(this.p.cfg.paths.generatedOutput), artifactId);
  }

  private writeFiles(artifactId: string, files: { path: string; content: string }[]): { path: string; sha256: string; bytes: number }[] {
    const dir = this.outputDir(artifactId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return files.map((file) => {
      const target = join(dir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      return { path: file.path, sha256: sha256(file.content), bytes: Buffer.byteLength(file.content) };
    });
  }

  private publish(gen: Entry, variant: string, subjectRef: string, sources: SourceSet, output: GeneratorOutput, preservation: Preservation, actor: Actor, ctx: ResolvedContext, existing?: Entry): Entry {
    return this.p.store.tx(() => {
      const files = output.files.sort((a, b) => a.path.localeCompare(b.path));
      const contentHash = hashValue(files.map((f) => [f.path, sha256(f.content)]));
      const fingerprint = this.fingerprint(sources);
      const attestation = this.attest(contentHash, gen, fingerprint);
      const content = {
        subjectRef,
        scope: sources.scope,
        generator: gen.canonicalId,
        generatorVersion: String(gen.content.version),
        targetSpace: String(gen.content.targetSpace),
        variant,
        contentHash,
        attestation,
        sourceFingerprint: fingerprint,
        sources: sources.entries.map((e) => e.canonicalId),
        sourceCount: sources.entries.length,
        preservation,
        reality: ctx.reality,
        derivative: true,
      };
      let artifact: Entry;
      if (existing) {
        artifact = this.p.fabric.amend(existing.canonicalId, actor, (e) => {
          e.content = { ...content, files: [] };
        }, 'REGENERATE');
      } else {
        artifact = this.p.fabric.submit(
          {
            kind: 'GeneratedArtifact',
            namespace: sources.scope.kind === 'namespace' && this.p.fabric.namespaceKind(sources.scope.id) === 'operational' ? sources.scope.id : 'UCOS',
            name: `${String(gen.content.targetSpace)} (${variant}) of ${sources.scope.name} #${contentHash.slice(0, 12)}`,
            statement: '',
            content: { ...content, files: [] },
            provenance: { source: 'generation-engine' },
          },
          actor,
        );
        if (this.p.fabric.exists(subjectRef)) this.p.fabric.relate('RENDERS', artifact.canonicalId, this.p.fabric.resolve(subjectRef).entry.canonicalId, actor);
        this.p.fabric.relate('PRODUCED-BY', artifact.canonicalId, gen.canonicalId, actor);
      }
      const written = this.writeFiles(artifact.canonicalId, files);
      artifact = this.p.fabric.amend(artifact.canonicalId, actor, (e) => {
        e.content.files = written;
      }, 'FILES');
      if (existing) {
        artifact = this.p.fabric.transition(artifact.canonicalId, 'REGENERATED', actor, { attested: true }, undefined, 'gen.artifact.regenerated');
      } else {
        this.p.bus.emit({ type: 'gen.artifact.generated', subject: artifact.canonicalId, actor, payload: { generator: gen.canonicalId, variant, files: written.length, contentHash }, context: ctx.record });
      }
      artifact = this.p.fabric.transition(artifact.canonicalId, 'DEPLOYED', actor, { attested: true }, undefined, 'gen.artifact.redeployed');
      this.index(artifact);
      return artifact;
    });
  }

  /** VERIFY: integrity (hand-edit detection), attestation, and staleness. */
  verify(artifactRef: string, options: { record?: boolean } = {}): { artifact: string; intact: boolean; tampered: boolean; stale: boolean; attestationValid: boolean; preservation: boolean; reason: string; files: { path: string; ok: boolean }[] } {
    const a = this.p.fabric.resolve(artifactRef).entry;
    const c = a.content as Record<string, unknown>;
    const dir = this.outputDir(a.canonicalId);
    const files = ((c.files as { path: string; sha256: string }[]) ?? []).map((f) => {
      const target = join(dir, f.path);
      return { path: f.path, ok: existsSync(target) && sha256(readFileSync(target, 'utf8')) === f.sha256 };
    });
    const tampered = files.some((f) => !f.ok);
    const gen = this.p.fabric.get(String(c.generator));
    const expected = gen ? this.attest(String(c.contentHash), gen, String(c.sourceFingerprint)) : '';
    const attestationValid = expected === c.attestation;
    let stale = false;
    try {
      stale = this.fingerprint(this.sourceSet(String(c.subjectRef))) !== c.sourceFingerprint;
    } catch {
      stale = true;
    }
    const preservation = !!c.preservation && Object.values(c.preservation as Record<string, { ok: boolean }>).every((v) => v.ok);
    const intact = !tampered && attestationValid;
    const reason = tampered ? `hand-edited or missing files: ${files.filter((f) => !f.ok).map((f) => f.path).join(', ')}` : !attestationValid ? 'attestation does not verify' : stale ? 'sources changed since generation (STALE)' : 'intact';
    if (options.record !== false) {
      const actor = this.p.systemActor();
      if (tampered && a.lifecycle.status !== 'TAMPERED') {
        this.p.fabric.transition(a.canonicalId, 'TAMPERED', actor, { tamperDetected: true });
        this.p.bus.emit({ type: 'gen.artifact.tampered', subject: a.canonicalId, actor, payload: { files: files.filter((f) => !f.ok).map((f) => f.path), rule: 'C-GN-02' } });
      } else if (!tampered && stale && ['DEPLOYED', 'GENERATED', 'REGENERATED'].includes(a.lifecycle.status)) {
        this.markStale(a, 'verification found changed sources');
      }
    }
    return { artifact: a.canonicalId, intact, tampered, stale, attestationValid, preservation, reason, files };
  }

  private markStale(a: Entry, cause: string): void {
    const actor = this.p.systemActor();
    this.p.fabric.transition(a.canonicalId, 'STALE', actor, { sourceChanged: true }, (e) => {
      e.content.staleCause = cause;
    });
    this.p.bus.emit({ type: 'gen.artifact.stale', subject: a.canonicalId, actor, payload: { cause, purpose: 'stale-propagation' }, context: { purpose: 'generation', reality: 'actual' } });
  }

  /** Stale propagation: any persisted change to a source marks dependent artifacts STALE. */
  private onSourceChanged(entry: Entry): void {
    if (this.regenerating || entry.kind === 'GeneratedArtifact') return;
    const affected = this.sourceIndex.get(entry.canonicalId);
    if (!affected?.size) return;
    for (const id of [...affected]) {
      const a = this.p.fabric.get(id);
      if (!a || !['DEPLOYED', 'GENERATED', 'REGENERATED'].includes(a.lifecycle.status)) continue;
      if ((a.content.sources as string[]).includes(entry.canonicalId)) this.markStale(a, `source ${entry.canonicalId} changed (version ${entry.version})`);
    }
  }

  /** REGENERATE after staleness or tampering, per the regeneration policy (E-GN-02). */
  regenerate(artifactRef: string, actor: Actor): Entry {
    const a = this.p.fabric.resolve(artifactRef).entry;
    const c = a.content as Record<string, unknown>;
    if (!['STALE', 'TAMPERED'].includes(a.lifecycle.status)) throw new ConstitutionalError('E-GN-02', `artifact is ${a.lifecycle.status}; only STALE or TAMPERED artifacts are regenerated`);
    const gen = this.p.fabric.require(String(c.generator));
    const ctx = this.p.context.forPurpose('generation', { Linguistic: { locale: this.p.cfg.platform.defaultLocale } }, actor);
    this.p.policy.enforce({ action: 'generation.regenerate', subject: a, actor, context: ctx });
    this.regenerating = true;
    try {
      const sources = this.sourceSet(String(c.subjectRef));
      const output = GENERATORS[String(gen.content.targetSpace)]({ p: this.p, sources, variant: String(c.variant), mapping: gen.content.transformation as Record<string, unknown>, context: ctx, actor, generator: gen });
      const preservation = this.checkPreservation(output, sources);
      if (Object.values(preservation).some((v) => !v.ok)) throw new ConstitutionalError('GN-P3', 'preservation failed on regeneration');
      return this.publish(gen, String(c.variant), String(c.subjectRef), sources, output, preservation, actor, ctx, a);
    } finally {
      this.regenerating = false;
    }
  }

  /** Regenerates every stale artifact when the regeneration policy is automatic. */
  regenerateStale(actor: Actor): string[] {
    if (this.p.cfg.generation.regenerationPolicy !== 'automatic') return [];
    const stale = this.p.fabric.query({ kind: 'GeneratedArtifact', status: 'STALE', limit: 10_000 }).entries;
    return stale.map((a) => this.regenerate(a.canonicalId, actor).canonicalId);
  }

  readFile(artifactRef: string, path: string): string {
    const a = this.p.fabric.resolve(artifactRef).entry;
    const f = ((a.content.files as { path: string }[]) ?? []).find((x) => x.path === path);
    if (!f) throw new ConstitutionalError('D-GN-03', `artifact ${a.canonicalId} has no file ${path}`);
    return readFileSync(join(this.outputDir(a.canonicalId), path), 'utf8');
  }

  /** Deterministic reproduction check (GN-P4): regenerating unchanged metadata yields identical bytes. */
  reproduce(artifactRef: string): { identical: boolean; contentHash: string; reproducedHash: string } {
    const a = this.p.fabric.resolve(artifactRef).entry;
    const c = a.content as Record<string, unknown>;
    const gen = this.p.fabric.require(String(c.generator));
    const actor = this.p.systemActor();
    const ctx = this.p.context.forPurpose('generation', { Linguistic: { locale: this.p.cfg.platform.defaultLocale } }, actor);
    const out = GENERATORS[String(gen.content.targetSpace)]({ p: this.p, sources: this.sourceSet(String(c.subjectRef)), variant: String(c.variant), mapping: gen.content.transformation as Record<string, unknown>, context: ctx, actor, generator: gen });
    const reproducedHash = hashValue(out.files.sort((x, y) => x.path.localeCompare(y.path)).map((f) => [f.path, sha256(f.content)]));
    return { identical: reproducedHash === c.contentHash, contentHash: String(c.contentHash), reproducedHash };
  }

  static canonical(value: unknown): string {
    return canonicalJson(value);
  }
}
