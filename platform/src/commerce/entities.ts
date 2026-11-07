import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { Violation } from '../kernel/errors.ts';
import { ConstitutionalError } from '../kernel/errors.ts';

/**
 * Entity capability (C-01). Entities carry no type: kinds of thing enter as
 * classifications (Phase 003 §1). Attributes are registered axes, never ad
 * hoc fields: every attribute key must resolve to a certified Attribute
 * (UPL-004, Phase 003 §F.1), and its value must fit the attribute's semantic
 * type.
 */
export class EntityService {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Entity', (e) => this.attributeViolations((e.content.attributes as Record<string, unknown>) ?? {}, e.classification.namespace));
    this.p.validation.registerKind('ExchangeableEntity', (e) => this.attributeViolations((e.content.attributes as Record<string, unknown>) ?? {}, e.classification.namespace));
  }

  attribute(name: string, namespace: string): Entry | undefined {
    for (const ns of [namespace, 'UCOS']) {
      const row = this.p.store.headByQualifiedName(`${ns}:Attribute:${name}`);
      if (row) return JSON.parse(row.body) as Entry;
    }
    const byId = this.p.fabric.tryResolve(name)?.entry;
    return byId?.kind === 'Attribute' ? byId : undefined;
  }

  attributeViolations(attrs: Record<string, unknown>, namespace: string): Violation[] {
    const out: Violation[] = [];
    for (const [key, value] of Object.entries(attrs)) {
      const def = this.attribute(key, namespace);
      if (!def) {
        out.push({ rule: 'UPL-004', message: `attribute "${key}" is not a registered Attribute — register it before use (hard-coded attributes are prohibited)` });
        continue;
      }
      if (!['CERTIFIED', 'ADMISSIBLE'].includes(def.lifecycle.status)) out.push({ rule: 'C-MM-00', message: `attribute "${key}" is ${def.lifecycle.status}, not certified` });
      const st = String(def.content.semanticType ?? '');
      const typeProblem = this.typeCheck(st, value, def);
      if (typeProblem) out.push({ rule: 'V-ST-02', message: `attribute "${key}": ${typeProblem}` });
    }
    return out;
  }

  private typeCheck(semanticType: string, value: unknown, def: Entry): string | null {
    const domain = def.content.domain as unknown[] | undefined;
    if (domain?.length && !domain.some((d) => JSON.stringify(d) === JSON.stringify(value))) return `value ${JSON.stringify(value)} is outside the attribute's domain`;
    switch (semanticType) {
      case 'Measurement':
      case 'C-21': {
        const m = value as { magnitude?: unknown; unit?: unknown };
        if (!m || typeof m.magnitude !== 'number' || typeof m.unit !== 'string') return 'a Measurement value is { magnitude, unit }';
        if (!this.p.measure.unit(m.unit, false)) return `unit ${m.unit} is not registered (V-MS-01)`;
        return null;
      }
      case 'TemporalPosition':
      case 'Time':
      case 'C-08':
        return typeof value === 'string' && !isNaN(Date.parse(value)) ? null : 'a temporal position is an ISO-8601 instant';
      case 'Identity':
      case 'Entity':
      case 'C-01':
      case 'C-02':
        return typeof value === 'string' && this.p.fabric.exists(value) ? null : 'must reference a registered artifact';
      case 'Classification':
      case 'C-10':
        return 'classification is a relationship, not an attribute value (TX-P2)';
      case 'Value':
      case 'C-20':
        return 'value is a relationship with valuer, purpose and context — never an attribute (V-VL-04)';
      default:
        return null;
    }
  }

  create(input: { name: string; statement?: string; attributes?: Record<string, unknown>; namespace?: string; relationships?: { type: string; target: string }[] }, actor: Actor): Entry {
    const ns = input.namespace ?? this.p.operationalNamespace();
    const e = this.p.fabric.submit(
      {
        kind: 'Entity',
        namespace: ns,
        name: input.name,
        statement: input.statement ?? '',
        content: { attributes: input.attributes ?? {} },
        labels: { [this.p.cfg.platform.defaultLocale]: input.name },
        provenance: { source: 'entity-capability' },
        relationships: input.relationships,
      },
      actor,
    );
    return this.p.fabric.transition(e.canonicalId, 'ACTIVE', actor, {}, undefined, 'ent.entity.activated');
  }

  /** Records a new state of the entity's attributes (state is derived from versions, C-06). */
  setAttributes(entityId: string, attributes: Record<string, unknown>, actor: Actor): Entry {
    const e = this.p.fabric.resolve(entityId).entry;
    const merged = { ...((e.content.attributes as Record<string, unknown>) ?? {}), ...attributes };
    const problems = this.attributeViolations(merged, e.classification.namespace);
    if (problems.length) throw new ConstitutionalError(problems[0].rule, problems.map((p) => p.message).join('; '), problems);
    return this.p.fabric.amend(e.canonicalId, actor, (x) => {
      x.content.attributes = merged;
    }, 'STATE', 'ent.entity.state.recorded');
  }

  /** The entity's state at a position in the ordering, reconstructed from its versions (V-ST-03). */
  stateAt(entityId: string, instant: string): { entity: string; instant: string; bindings: Record<string, unknown>; version: number | null; provenance: string | null } {
    const id = this.p.fabric.resolve(entityId).entry.canonicalId;
    const versions = this.p.store.versionsOf(id).filter((v) => Date.parse(v.recorded_at) <= Date.parse(instant));
    const last = versions[versions.length - 1];
    if (!last) return { entity: id, instant, bindings: {}, version: null, provenance: null };
    const body = JSON.parse(last.body) as Entry;
    return { entity: id, instant, bindings: (body.content.attributes as Record<string, unknown>) ?? {}, version: last.version, provenance: last.chain_hash };
  }
}
