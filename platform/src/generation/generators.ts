import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry, RelationshipType } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import type { LifecycleDefinition } from '../registry/fabric.ts';

export interface SourceSet {
  scope: { kind: 'composition' | 'registry' | 'namespace' | 'artifact'; id: string; name: string };
  entries: Entry[];
  edges: { id: string; type: string; source: string; target: string }[];
  lifecycles: LifecycleDefinition[];
  relationshipTypes: RelationshipType[];
}

export interface GeneratorInput {
  p: Platform;
  sources: SourceSet;
  variant: string;
  mapping: Record<string, unknown>;
  context: ResolvedContext;
  actor: Actor;
  generator: Entry;
}

export interface GeneratorOutput {
  files: { path: string; content: string }[];
  trace: { element: string; source: string }[];
  unmappedTypes: string[];
  constraintsExpected: number;
  constraintsRendered: number;
  relationshipsExpected: number;
  relationshipsRendered: number;
  cardinalityPreserved: boolean;
  lifecyclesExpected: number;
  lifecyclesRendered: number;
}

type Transform = (i: GeneratorInput) => GeneratorOutput;

function empty(): GeneratorOutput {
  return { files: [], trace: [], unmappedTypes: [], constraintsExpected: 0, constraintsRendered: 0, relationshipsExpected: 0, relationshipsRendered: 0, cardinalityPreserved: true, lifecyclesExpected: 0, lifecyclesRendered: 0 };
}

function ident(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return /^[a-z_]/.test(s) ? s : `x_${s}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n';
}

/** Normalises an attribute's semantic type to a construct alias (C-nn / FR-nn). */
function constructOf(p: Platform, semanticType: unknown): string {
  const node = p.ontology.lookup(String(semanticType ?? 'C-22'));
  return node?.alias ?? 'C-22';
}

function modelsIn(s: SourceSet): Entry[] {
  return s.entries.filter((e) => e.kind === 'Model');
}

function attributesOf(s: SourceSet, model: Entry): Entry[] {
  const ids = new Set(s.edges.filter((e) => e.type === 'MEMBER-OF' && e.target === model.canonicalId).map((e) => e.source));
  return s.entries.filter((e) => e.kind === 'Attribute' && ids.has(e.canonicalId)).sort((a, b) => Number(a.content.position ?? 0) - Number(b.content.position ?? 0));
}

/** The lifecycle a model's instances traverse: the lifecycle of the registry whose envelope names the model. */
function lifecycleOfModel(p: Platform, model: Entry): LifecycleDefinition | null {
  const reg = p.fabric.registryDefinitions().find((r) => r.envelope.kinds.some((k) => k.toLowerCase() === model.definition.canonicalName.toLowerCase().replace(/\s+/g, '')));
  if (reg) {
    try {
      return p.lifecycles.get(reg.lifecycleRef);
    } catch {
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.1 Database Schema
// ─────────────────────────────────────────────────────────────────────────────

const databaseSchema: Transform = ({ p, sources, variant, mapping }) => {
  const out = empty();
  const typeMap = ((mapping.typeMapping as Record<string, Record<string, string>>) ?? {})[variant] ?? {};
  const relTyped = new Set((mapping.relationshipTypedConstructs as string[]) ?? []);
  const lines: string[] = [`-- ${variant} schema rendered from ${sources.scope.kind} ${sources.scope.name} (${sources.scope.id}).`, '-- DERIVATIVE ARTIFACT (UCL-C04): regenerate from metadata; never edit by hand (UCL-C05).', ''];
  const pg = variant === 'postgresql';
  for (const model of modelsIn(sources)) {
    const table = ident(`${model.classification.namespace}_${model.definition.canonicalName}`);
    const attrs = attributesOf(sources, model);
    const cols: string[] = [`  id ${pg ? 'text' : 'TEXT'} PRIMARY KEY`];
    out.trace.push({ element: `table ${table}`, source: model.canonicalId });
    out.constraintsExpected++;
    out.constraintsRendered++;
    const children: string[] = [];
    const lc = lifecycleOfModel(p, model);
    if (lc) {
      out.lifecyclesExpected++;
      cols.push(`  status ${pg ? 'text' : 'TEXT'} NOT NULL DEFAULT '${lc.initial}' CHECK (status IN (${lc.states.map((st) => `'${st}'`).join(', ')}))`);
      out.lifecyclesRendered++;
      out.constraintsExpected++;
      out.constraintsRendered++;
    }
    const seen = new Set<string>(['id', 'status']);
    for (const a of attrs) {
      const col = ident(a.definition.canonicalName);
      if (seen.has(col)) continue;
      seen.add(col);
      const construct = constructOf(p, a.content.semanticType);
      out.trace.push({ element: `${table}.${col}`, source: a.canonicalId });
      const many = a.content.cardinality === 'many';
      if (construct === 'C-02' && !many) continue;
      if (relTyped.has(construct) || many) {
        out.relationshipsExpected++;
        const child = ident(`${table}_${col}`);
        const valueType = typeMap[construct];
        if (!valueType && !relTyped.has(construct)) out.unmappedTypes.push(construct);
        children.push(
          `CREATE TABLE IF NOT EXISTS ${child} (\n  owner_id ${pg ? 'text' : 'TEXT'} NOT NULL REFERENCES ${table}(id),\n  position ${pg ? 'integer' : 'INTEGER'} NOT NULL,\n  ${relTyped.has(construct) ? `target_id ${pg ? 'text' : 'TEXT'} NOT NULL,\n  relationship_type ${pg ? 'text' : 'TEXT'} NOT NULL,\n  context ${pg ? 'jsonb' : 'TEXT'}` : `value ${valueType ?? 'TEXT'}`},\n  PRIMARY KEY (owner_id, position)\n); -- ${relTyped.has(construct) ? 'relationship' : 'cardinality many'} ${construct} from ${a.canonicalId}`,
        );
        out.relationshipsRendered++;
        continue;
      }
      const t = typeMap[construct];
      if (!t) {
        out.unmappedTypes.push(construct);
        continue;
      }
      cols.push(`  ${col} ${t}${construct === 'C-21' ? '' : ''} -- ${construct} ${a.canonicalId}`);
      if (construct === 'C-21') cols.push(`  ${col}_unit ${pg ? 'text' : 'TEXT'} -- unit of ${col} (V-MS-01)`);
    }
    lines.push(`-- Model ${model.definition.canonicalName} (${model.canonicalId}) v${model.version}`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(',\n')}\n);`);
    lines.push(...children, '');
  }
  // Kinds held by registries in scope but described by no structural model render as the shared entry spine (Phase 004 §5.1).
  const modelled = new Set(modelsIn(sources).map((m) => m.definition.canonicalName.toLowerCase().replace(/\s+/g, '')));
  for (const reg of sources.entries.filter((e) => e.kind === 'Registry')) {
    const def = reg.content.definition as { envelope: { kinds: string[] }; lifecycleRef: string };
    for (const kind of def.envelope.kinds) {
      if (modelled.has(kind.toLowerCase())) continue;
      modelled.add(kind.toLowerCase());
      const table = ident(`spine_${kind}`);
      let lc: LifecycleDefinition | null = null;
      try {
        lc = p.lifecycles.get(def.lifecycleRef);
      } catch {
        lc = null;
      }
      const t = (c: string) => typeMap[c] ?? (pg ? 'text' : 'TEXT');
      const cols = [`  id ${t('C-02')} PRIMARY KEY`, `  canonical_name ${t('C-23')} NOT NULL`, `  canonical_statement ${t('C-22')}`, `  namespace ${t('C-29')} NOT NULL`, `  canonical_owner ${t('C-29')} NOT NULL`, `  security_posture ${t('C-14')} NOT NULL`, `  version ${pg ? 'integer' : 'INTEGER'} NOT NULL`, `  content ${t('C-06')}`];
      out.constraintsExpected += 1;
      out.constraintsRendered += 1;
      if (lc) {
        out.lifecyclesExpected++;
        cols.push(`  status ${pg ? 'text' : 'TEXT'} NOT NULL DEFAULT '${lc.initial}' CHECK (status IN (${lc.states.map((st) => `'${st}'`).join(', ')}))`);
        out.lifecyclesRendered++;
      }
      lines.push(`-- ${kind}: entry spine held by ${reg.definition.canonicalName} (${reg.canonicalId})`, `CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(',\n')}\n);`, '');
      out.trace.push({ element: `table ${table}`, source: reg.canonicalId });
    }
  }
  const rels = sources.edges.filter((e) => ['PART-OF', 'DEPENDS-ON', 'SUPERSEDES', 'CLASSIFIED-AS'].includes(e.type));
  if (rels.length) {
    lines.push('-- Typed relationship instances among the rendered artifacts (R-01).');
    lines.push(`CREATE TABLE IF NOT EXISTS ucos_relationship (\n  id ${pg ? 'text' : 'TEXT'} PRIMARY KEY,\n  type ${pg ? 'text' : 'TEXT'} NOT NULL CHECK (type IN (${[...new Set(sources.relationshipTypes.map((t) => `'${t.type}'`))].join(', ')})),\n  source_id ${pg ? 'text' : 'TEXT'} NOT NULL,\n  target_id ${pg ? 'text' : 'TEXT'} NOT NULL\n);`);
    out.constraintsExpected++;
    out.constraintsRendered++;
    for (const r of rels) out.trace.push({ element: `relationship ${r.id}`, source: r.source });
  }
  out.files.push({ path: `schema.${variant}.sql`, content: lines.join('\n') + '\n' });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.2 API
// ─────────────────────────────────────────────────────────────────────────────

const api: Transform = ({ p, sources, variant, mapping }) => {
  const out = empty();
  const typeMap = ((mapping.typeMapping as Record<string, Record<string, unknown>>) ?? {})['openapi-3.1'] ?? {};
  const schemas: Record<string, unknown> = {};
  const kinds = new Set(p.fabric.registryDefinitions().flatMap((r) => r.envelope.kinds));
  for (const model of modelsIn(sources)) {
    const props: Record<string, unknown> = { id: { type: 'string', format: 'ucos-id' } };
    for (const a of attributesOf(sources, model)) {
      const c = constructOf(p, a.content.semanticType);
      const t = typeMap[c] ?? { type: 'string' };
      props[a.definition.canonicalName] = a.content.cardinality === 'many' ? { type: 'array', items: t } : t;
      out.trace.push({ element: `schema ${model.definition.canonicalName}.${a.definition.canonicalName}`, source: a.canonicalId });
    }
    const lc = lifecycleOfModel(p, model);
    if (lc) {
      out.lifecyclesExpected++;
      props.status = { type: 'string', enum: lc.states };
      out.lifecyclesRendered++;
    }
    schemas[model.definition.canonicalName.replace(/\s+/g, '')] = { type: 'object', 'x-ucos-source': model.canonicalId, ...(lc ? { 'x-ucos-lifecycle': lc.id } : {}), properties: props };
    out.trace.push({ element: `schema ${model.definition.canonicalName}`, source: model.canonicalId });
  }
  const portSchema = (ports: { name: string; type: string; optional?: boolean; contextProvided?: boolean }[]) => {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const port of ports) {
      if (port.contextProvided) continue;
      if (kinds.has(port.type) && !p.ontology.lookup(port.type)) {
        out.relationshipsExpected++;
        props[port.name] = schemas[port.type] ? { $ref: `#/components/schemas/${port.type}` } : { type: 'string', format: 'ucos-id', description: `reference to a registered ${port.type}` };
        out.relationshipsRendered++;
      } else {
        const alias = p.ontology.lookup(port.type)?.alias ?? port.type;
        const t = typeMap[alias];
        if (!t) out.unmappedTypes.push(alias);
        props[port.name] = t ?? {};
      }
      if (!port.optional) required.push(port.name);
    }
    return { type: 'object', properties: props, required };
  };
  const paths: Record<string, unknown> = {};
  const methods: unknown[] = [];
  for (const cap of sources.entries.filter((e) => e.kind === 'Capability')) {
    const inputs = (cap.content.inputs as never[]) ?? [];
    const outputs = (cap.content.outputs as never[]) ?? [];
    for (const op of (cap.content.operations as string[]) ?? []) {
      out.constraintsExpected++;
      const path = `/capabilities/${cap.definition.canonicalName}/${op}`;
      const operation = {
        operationId: `${ident(cap.definition.canonicalName)}_${ident(op)}`,
        summary: String(cap.content.purpose ?? ''),
        'x-ucos-source': cap.canonicalId,
        'x-ucos-policy-action': 'capability.invoke',
        'x-ucos-operation': op,
        'x-ucos-events': cap.content.events ?? [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { composition: { type: 'string', format: 'ucos-id' }, input: portSchema(inputs), context: { type: 'object', description: 'context contributions keyed by registered dimension (UCI-018)' } }, required: ['input'] } } } },
        responses: { '200': { description: 'result with the context that produced it (CX-P8)', content: { 'application/json': { schema: { type: 'object', properties: { result: portSchema(outputs), context: { type: 'object' } } } } } }, '403': { description: 'refused by policy (UCL-G01)' }, '422': { description: 'constitutional refusal naming its rule' } },
        security: [{ bearer: [] }],
      };
      out.constraintsRendered++;
      paths[path] = { post: operation };
      methods.push({ name: `${cap.definition.canonicalName}.${op}`, params: portSchema(inputs), result: portSchema(outputs), 'x-ucos-source': cap.canonicalId });
      out.trace.push({ element: `operation ${path}`, source: cap.canonicalId });
    }
  }
  for (const k of [...new Set(sources.entries.map((e) => e.kind))].sort()) {
    const first = sources.entries.find((e) => e.kind === k)!;
    paths[`/entries?kind=${k}`] = { get: { operationId: `list_${ident(k)}`, 'x-ucos-policy-action': 'registry.read', 'x-ucos-source': first.registryId, responses: { '200': { description: `${k} entries` } } } };
    out.constraintsExpected++;
    out.constraintsRendered++;
    out.trace.push({ element: `list ${k}`, source: first.canonicalId });
  }
  if (variant === 'json-rpc-2.0') {
    out.files.push({ path: 'api.jsonrpc.json', content: json({ openrpc: '1.3.2', info: { title: `${sources.scope.name}`, version: String(sources.entries.length), 'x-ucos-derivative': true }, methods }) });
  } else {
    out.files.push({ path: 'openapi.json', content: json({ openapi: '3.1.0', info: { title: `${sources.scope.name} — generated interface`, version: '1.0.0', description: 'DERIVATIVE ARTIFACT (UCL-C04). The capability contracts are canonical; this wire form is not.' }, paths, components: { schemas, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } }) });
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.3 Events
// ─────────────────────────────────────────────────────────────────────────────

const events: Transform = ({ sources, variant }) => {
  const out = empty();
  const envelope = {
    type: 'object',
    required: ['eventId', 'type', 'occurredAt', 'actor', 'authority', 'reality', 'canonical', 'payload'],
    properties: {
      eventId: { type: 'string' },
      type: { type: 'string' },
      subject: { type: ['string', 'null'] },
      occurredAt: { type: 'string', format: 'date-time', description: 'temporal context (UCI-007)' },
      actor: { type: 'string', description: 'accountable principal (UCI-006)' },
      authority: { type: 'string' },
      reality: { type: 'string', description: 'Reality dimension; never omitted (Phase 009 §6.3)' },
      canonical: { type: 'boolean', description: 'true only when reality = actual' },
      causationId: { type: ['string', 'null'] },
      correlationId: { type: ['string', 'null'] },
      context: { type: 'object' },
      payload: { type: 'object' },
    },
  };
  const types = sources.entries.filter((e) => e.kind === 'EventType');
  const defs: Record<string, unknown> = {};
  for (const t of types) {
    defs[t.definition.canonicalName] = { allOf: [{ $ref: '#/$defs/envelope' }, { properties: { type: { const: t.definition.canonicalName } } }], 'x-ucos-source': t.canonicalId, description: t.definition.canonicalStatement };
    out.trace.push({ element: `event ${t.definition.canonicalName}`, source: t.canonicalId });
    out.constraintsExpected += 3;
    out.constraintsRendered += 3;
  }
  const lifecycleEntries = sources.entries.filter((e) => e.kind === 'Lifecycle' && e.content.definition);
  for (const le of lifecycleEntries) {
    const lc = le.content.definition as LifecycleDefinition;
    out.lifecyclesExpected++;
    for (const tr of lc.transitions) {
      const name = `lifecycle.${lc.id.toLowerCase()}.${tr.from === '*' ? 'any' : tr.from.toLowerCase()}.${tr.to.toLowerCase()}`;
      defs[name] = { allOf: [{ $ref: '#/$defs/envelope' }, { properties: { payload: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { const: tr.to } } } } }], 'x-ucos-source': le.canonicalId, 'x-ucos-guard': tr.guard ?? null };
    }
    out.lifecyclesRendered++;
    out.trace.push({ element: `lifecycle events ${lc.id}`, source: le.canonicalId });
  }
  if (variant === 'asyncapi-3.0') {
    const channels: Record<string, unknown> = {};
    const messages: Record<string, unknown> = {};
    for (const name of Object.keys(defs).sort()) {
      channels[name] = { address: name, messages: { [ident(name)]: { $ref: `#/components/messages/${ident(name)}` } } };
      messages[ident(name)] = { name, payload: defs[name] };
    }
    out.files.push({ path: 'asyncapi.json', content: json({ asyncapi: '3.0.0', info: { title: `${sources.scope.name} events`, version: '1.0.0' }, channels, components: { messages, schemas: { envelope } } }) });
  } else {
    out.files.push({ path: 'events.schema.json', content: json({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `urn:ucos:events:${sources.scope.id}`, title: `${sources.scope.name} events`, $defs: { envelope, ...defs } }) });
  }
  if (out.trace.length === 0) out.trace.push({ element: 'event envelope', source: sources.entries[0]?.canonicalId ?? sources.scope.id });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.4 UI
// ─────────────────────────────────────────────────────────────────────────────

const ui: Transform = ({ p, sources, mapping, context, actor }) => {
  const out = empty();
  const controls = ((mapping.typeMapping as Record<string, Record<string, string>>) ?? {})['ucos-ui-definition'] ?? {};
  const locale = String(context.bindings.Linguistic?.locale ?? p.cfg.platform.defaultLocale);
  const label = (e: Entry) => e.labels?.[locale] ?? e.definition.canonicalName;
  const views = modelsIn(sources).map((m) => {
    out.trace.push({ element: `view ${m.definition.canonicalName}`, source: m.canonicalId });
    const lc = lifecycleOfModel(p, m);
    if (lc) {
      out.lifecyclesExpected++;
      out.lifecyclesRendered++;
    }
    return {
      id: m.canonicalId,
      title: label(m),
      lifecycle: lc ? { id: lc.id, states: lc.states, initial: lc.initial } : null,
      fields: attributesOf(sources, m).map((a) => {
        const c = constructOf(p, a.content.semanticType);
        out.trace.push({ element: `field ${a.definition.canonicalName}`, source: a.canonicalId });
        return { id: a.canonicalId, name: a.definition.canonicalName, label: label(a), construct: c, control: controls[c] ?? controls['*'], many: a.content.cardinality === 'many' };
      }),
    };
  });
  const actions: unknown[] = [];
  let permitted = 0;
  for (const cap of sources.entries.filter((e) => e.kind === 'Capability')) {
    for (const op of (cap.content.operations as string[]) ?? []) {
      const verdict = p.policy.evaluate({ action: 'capability.invoke', subject: cap, actor, context, attributes: { capability: cap.definition.canonicalName, operation: op } }, { record: false });
      out.constraintsExpected++;
      out.constraintsRendered++;
      if (verdict.decision !== 'PERMIT') continue;
      permitted++;
      actions.push({ capability: cap.definition.canonicalName, operation: op, label: `${label(cap)} · ${op}`, purpose: cap.content.purpose, inputs: ((cap.content.inputs as { name: string; type: string; contextProvided?: boolean; optional?: boolean }[]) ?? []).filter((x) => !x.contextProvided).map((x) => ({ name: x.name, construct: p.ontology.lookup(x.type)?.alias ?? x.type, control: controls[p.ontology.lookup(x.type)?.alias ?? ''] ?? 'reference-picker', optional: !!x.optional })) });
      out.trace.push({ element: `action ${cap.definition.canonicalName}.${op}`, source: cap.canonicalId });
    }
  }
  const navigation = sources.entries
    .filter((e) => e.kind === 'TaxonomyScheme')
    .map((s) => {
      out.trace.push({ element: `navigation ${s.definition.canonicalName}`, source: s.canonicalId });
      return { scheme: s.canonicalId, label: label(s), taxa: sources.entries.filter((t) => t.kind === 'Taxon' && t.content.scheme === s.canonicalId).map((t) => ({ id: t.canonicalId, label: label(t) })) };
    });
  const relationships = sources.edges.filter((e) => e.type === 'BINDS' || e.type === 'DEPENDS-ON');
  out.relationshipsExpected = relationships.length;
  out.relationshipsRendered = relationships.length;
  const definition = {
    app: sources.scope.name,
    subject: sources.scope.id,
    locale,
    reality: context.reality,
    banner: context.reality !== 'actual' ? `${context.reality.toUpperCase()} — consequences are not effective outside this reality (GN-S-06)` : null,
    generatedFor: actor.principal,
    affordances: { permitted, note: 'unauthorised affordances are not generated at all (GN-S-04)' },
    navigation,
    views,
    actions,
    links: relationships.map((r) => ({ type: r.type, from: r.source, to: r.target })),
  };
  if (out.trace.length === 0) out.trace.push({ element: 'app shell', source: sources.entries[0]?.canonicalId ?? sources.scope.id });
  out.files.push({ path: 'ui.definition.json', content: json(definition) });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.5 Documentation
// ─────────────────────────────────────────────────────────────────────────────

const documentation: Transform = ({ p, sources, variant }) => {
  const out = empty();
  const byKind = new Map<string, Entry[]>();
  for (const e of sources.entries) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  const edgesBySource = new Map<string, { type: string; target: string }[]>();
  for (const ed of sources.edges) edgesBySource.set(ed.source, [...(edgesBySource.get(ed.source) ?? []), { type: ed.type, target: ed.target }]);
  const name = (id: string) => sources.entries.find((e) => e.canonicalId === id)?.definition.canonicalName ?? id;
  const index: string[] = [`# ${sources.scope.name}`, '', `Generated from the ${sources.scope.kind} ${sources.scope.id}. Every definition below is quoted verbatim from its registry entry and cites its identity, version and certification (Phase 009 §6.5). This document is a derivative: correct the registry, never this text.`, ''];
  for (const [kind, list] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = `${ident(kind)}.${variant === 'html' ? 'html' : 'md'}`;
    index.push(`- [${kind}](${file}) — ${list.length}`);
    const body: string[] = [`# ${kind}`, ''];
    for (const e of list.sort((a, b) => a.definition.canonicalName.localeCompare(b.definition.canonicalName))) {
      const superseded = e.lifecycle.status === 'SUPERSEDED' ? ` — **SUPERSEDED by ${e.supersededBy}**` : '';
      body.push(`## ${e.definition.canonicalName}${superseded}`, '');
      if (e.definition.canonicalStatement) body.push(`> ${e.definition.canonicalStatement.replace(/\n/g, ' ')}`, '');
      body.push(`- identity: \`${e.canonicalId}\`${e.identity.aliases.length ? ` (aliases: ${e.identity.aliases.join(', ')})` : ''}`);
      body.push(`- status: ${e.lifecycle.status} · version ${e.version} · owner ${e.ownership.canonicalOwner}`);
      if (e.evidence.certification) body.push(`- certified by ${e.evidence.certification.body} at ${e.evidence.certification.at} (evidence ${e.evidence.certification.evidenceHash.slice(0, 16)}…)`);
      if (e.definition.derivationChain.length) body.push(`- derives from: ${e.definition.derivationChain.join(', ')}`);
      if (e.provenance.locator) body.push(`- source: ${e.provenance.source} — ${e.provenance.locator}`);
      const rels = edgesBySource.get(e.canonicalId) ?? [];
      out.relationshipsExpected += rels.length;
      if (rels.length) body.push(`- relationships: ${rels.map((r) => `${r.type} → ${name(r.target)}`).join('; ')}`);
      out.relationshipsRendered += rels.length;
      if (e.kind === 'Lifecycle' && e.content.definition) {
        const lc = e.content.definition as LifecycleDefinition;
        out.lifecyclesExpected++;
        body.push('', '| from | to | guard |', '|---|---|---|', ...lc.transitions.map((t) => `| ${t.from} | ${t.to} | ${t.guard ?? ''} |`));
        out.lifecyclesRendered++;
      }
      body.push('');
      out.trace.push({ element: `${file}#${e.definition.canonicalName}`, source: e.canonicalId });
      out.constraintsExpected++;
      out.constraintsRendered++;
    }
    const content = variant === 'html' ? `<!doctype html><html><head><meta charset="utf-8"><title>${esc(kind)}</title></head><body><pre>${esc(body.join('\n'))}</pre></body></html>\n` : body.join('\n');
    out.files.push({ path: file, content });
  }
  void p;
  out.files.push({ path: variant === 'html' ? 'index.html' : 'README.md', content: variant === 'html' ? `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sources.scope.name)}</title></head><body><pre>${esc(index.join('\n'))}</pre></body></html>\n` : index.join('\n') + '\n' });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.6 Policy
// ─────────────────────────────────────────────────────────────────────────────

const policy: Transform = ({ p, sources, variant }) => {
  const out = empty();
  const policies = sources.entries.filter((e) => e.kind === 'Policy');
  const bundle = policies.map((pol) => {
    const c = pol.content as Record<string, unknown>;
    out.trace.push({ element: `policy ${pol.definition.canonicalName}`, source: pol.canonicalId });
    const rules = (c.rules as unknown[]) ?? [];
    out.constraintsExpected += rules.length;
    out.constraintsRendered += rules.length;
    return {
      id: pol.canonicalId,
      name: pol.definition.canonicalName,
      purpose: c.purpose,
      issuer: c.issuer,
      precedenceInputs: { authorityRank: p.governance.authorityRank(String(c.issuer)), scope: c.scope, effectiveFrom: c.effectiveFrom ?? pol.provenance.recordedAt, note: 'precedence = (authority rank, specificity, recency), computed at evaluation; never flattened' },
      contextConditions: c.contextConditions ?? [],
      rules,
      exceptions: c.exceptions ?? [],
      modifiers: c.modifiers ?? [],
      taxRules: c.taxRules ?? [],
      effectiveFrom: c.effectiveFrom ?? null,
      effectiveTo: c.effectiveTo ?? null,
    };
  });
  const attachments = sources.entries
    .filter((e) => e.kind === 'Taxon' && ((e.content.policies as string[]) ?? []).length)
    .map((t) => {
      out.relationshipsExpected++;
      out.relationshipsRendered++;
      out.trace.push({ element: `attachment ${t.definition.canonicalName}`, source: t.canonicalId });
      return { taxon: t.canonicalId, policies: t.content.policies };
    });
  if (out.trace.length === 0) out.trace.push({ element: 'empty bundle', source: sources.entries[0]?.canonicalId ?? sources.scope.id });
  if (variant === 'policy-text') {
    const text = bundle.map((b) => [`POLICY ${b.name} (${b.id})`, `  issuer: ${String(b.issuer)} — purpose: ${String(b.purpose)}`, ...(b.contextConditions as string[]).map((cc) => `  when ${cc}`), ...(b.rules as { id: string; modality: string; action: string; antecedent?: string; obligation?: string }[]).map((r) => `  ${r.id}: ${r.modality.toUpperCase()} ${r.action}${r.antecedent ? ` IF ${r.antecedent}` : ''}${r.obligation ? ` → ${r.obligation}` : ''}`)].join('\n')).join('\n\n');
    out.files.push({ path: 'policies.txt', content: text + '\n' });
  } else out.files.push({ path: 'policy-bundle.json', content: json({ bundle, attachments, evaluation: 'deny unless permitted; prohibition wins ties (UCL-G02, V-RU-03)' }) });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.7 Workflow
// ─────────────────────────────────────────────────────────────────────────────

const workflow: Transform = ({ sources }) => {
  const out = empty();
  const machines: unknown[] = [];
  for (const comp of sources.entries.filter((e) => e.kind === 'Composition')) {
    const bindings = (comp.content.bindings as { source: string; target: string; sourcePort: string; targetPort: string; failurePolicy: string }[]) ?? [];
    const caps = sources.entries.filter((e) => e.kind === 'Capability' && (sources.edges.some((ed) => ed.type === 'BINDS' && ed.source === comp.canonicalId && ed.target === e.canonicalId) || bindings.some((b) => b.source === e.canonicalId || b.target === e.canonicalId)));
    const indeg = new Map(caps.map((c) => [c.canonicalId, 0]));
    for (const b of bindings) indeg.set(b.target, (indeg.get(b.target) ?? 0) + 1);
    const order: string[] = [];
    const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const b of bindings.filter((x) => x.source === id)) {
        indeg.set(b.target, (indeg.get(b.target) ?? 1) - 1);
        if (indeg.get(b.target) === 0) queue.push(b.target);
      }
    }
    const name = (id: string) => sources.entries.find((e) => e.canonicalId === id)?.definition.canonicalName ?? id;
    const states: Record<string, unknown> = {};
    for (const id of order) {
      const next = bindings.filter((b) => b.source === id);
      states[name(id)] = { Type: 'Task', Resource: `ucos:capability:${name(id)}`, Next: next.map((b) => name(b.target)), OnFailure: [...new Set(next.map((b) => b.failurePolicy))], Compensation: `compensate:${name(id)}` };
      out.relationshipsExpected += next.length;
      out.relationshipsRendered += next.length;
    }
    machines.push({ id: comp.canonicalId, name: comp.definition.canonicalName, StartAt: order.map(name).filter((n) => !bindings.some((b) => name(b.target) === n)), States: states, envelope: comp.content.policyEnvelope });
    out.trace.push({ element: `machine ${comp.definition.canonicalName}`, source: comp.canonicalId });
    out.constraintsExpected++;
    out.constraintsRendered++;
  }
  for (const le of sources.entries.filter((e) => e.kind === 'Lifecycle' && e.content.definition)) {
    const lc = le.content.definition as LifecycleDefinition;
    out.lifecyclesExpected++;
    const states: Record<string, unknown> = {};
    for (const st of lc.states) states[st] = { Type: lc.terminals.includes(st) ? 'Succeed' : 'Choice', Transitions: lc.transitions.filter((t) => t.from === st || t.from === '*').map((t) => ({ Next: t.to, Guard: t.guard ?? null, GuardRule: t.guardRule ?? null })) };
    machines.push({ id: le.canonicalId, name: lc.name, StartAt: lc.initial, States: states });
    out.lifecyclesRendered++;
    out.trace.push({ element: `lifecycle machine ${lc.id}`, source: le.canonicalId });
  }
  for (const fl of sources.entries.filter((e) => e.kind === 'Flow')) {
    const steps = (fl.content.steps as string[]) ?? [];
    const states: Record<string, unknown> = {};
    steps.forEach((s, i) => (states[s] = i === steps.length - 1 ? { Type: 'Succeed' } : { Type: 'Task', Next: steps[i + 1] }));
    machines.push({ id: fl.canonicalId, name: fl.definition.canonicalName, StartAt: steps[0] ?? null, States: states });
    out.trace.push({ element: `flow machine ${fl.definition.canonicalName}`, source: fl.canonicalId });
  }
  if (out.trace.length === 0) out.trace.push({ element: 'empty workflow set', source: sources.entries[0]?.canonicalId ?? sources.scope.id });
  out.files.push({ path: 'workflows.json', content: json({ machines, note: 'guards remain registered rule expressions; compensation generated alongside every task (Phase 009 §6.7)' }) });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 6.8 Knowledge Graph
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeGraph: Transform = ({ sources, variant }) => {
  const out = empty();
  const ids = new Set(sources.entries.map((e) => e.canonicalId));
  const edges = sources.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  out.relationshipsExpected = edges.length;
  for (const e of sources.entries) out.trace.push({ element: `node ${e.canonicalId}`, source: e.canonicalId });
  if (variant === 'n-triples') {
    const lines: string[] = [];
    const lit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    for (const e of sources.entries) {
      lines.push(`<urn:ucos:${e.canonicalId}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <urn:ucos:kind:${e.kind}> .`);
      lines.push(`<urn:ucos:${e.canonicalId}> <http://www.w3.org/2000/01/rdf-schema#label> ${lit(e.definition.canonicalName)} .`);
      lines.push(`<urn:ucos:${e.canonicalId}> <urn:ucos:status> ${lit(e.lifecycle.status)} .`);
      if (e.supersededBy) lines.push(`<urn:ucos:${e.canonicalId}> <urn:ucos:rel:SUPERSEDED-BY> <urn:ucos:${e.supersededBy}> .`);
    }
    for (const ed of edges) lines.push(`<urn:ucos:${ed.source}> <urn:ucos:rel:${ed.type}> <urn:ucos:${ed.target}> .`);
    out.relationshipsRendered = edges.length;
    out.files.push({ path: 'graph.nt', content: lines.join('\n') + '\n' });
  } else if (variant === 'graphml') {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
      '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
      '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
      '  <key id="status" for="node" attr.name="status" attr.type="string"/>',
      '  <key id="type" for="edge" attr.name="type" attr.type="string"/>',
      `  <graph id="${esc(sources.scope.id)}" edgedefault="directed">`,
      ...sources.entries.map((e) => `    <node id="${esc(e.canonicalId)}"><data key="label">${esc(e.definition.canonicalName)}</data><data key="kind">${esc(e.kind)}</data><data key="status">${esc(e.lifecycle.status)}</data></node>`),
      ...edges.map((ed) => `    <edge id="${esc(ed.id)}" source="${esc(ed.source)}" target="${esc(ed.target)}"><data key="type">${esc(ed.type)}</data></edge>`),
      '  </graph>',
      '</graphml>',
    ];
    out.relationshipsRendered = edges.length;
    out.files.push({ path: 'graph.graphml', content: xml.join('\n') + '\n' });
  } else {
    const context: Record<string, unknown> = { ucos: 'urn:ucos:', label: 'http://www.w3.org/2000/01/rdf-schema#label', kind: '@type', status: 'ucos:status' };
    for (const t of sources.relationshipTypes) context[t.type] = { '@id': `ucos:rel:${t.type}`, '@type': '@id' };
    const outgoing = new Map<string, Record<string, string[]>>();
    for (const ed of edges) {
      const m = outgoing.get(ed.source) ?? {};
      (m[ed.type] ??= []).push(`ucos:${ed.target}`);
      outgoing.set(ed.source, m);
    }
    const graph = sources.entries.map((e) => ({ '@id': `ucos:${e.canonicalId}`, kind: `ucos:kind:${e.kind}`, label: e.definition.canonicalName, status: e.lifecycle.status, ...(e.supersededBy ? { 'SUPERSEDED-BY': `ucos:${e.supersededBy}`, superseded: true } : {}), ...(outgoing.get(e.canonicalId) ?? {}) }));
    out.relationshipsRendered = edges.length;
    out.files.push({ path: 'graph.jsonld', content: json({ '@context': context, '@graph': graph }) });
  }
  out.constraintsExpected = 1;
  out.constraintsRendered = 1;
  return out;
};

export const GENERATORS: Record<string, Transform> = {
  'Database Schema': databaseSchema,
  API: api,
  Event: events,
  UI: ui,
  Documentation: documentation,
  Policy: policy,
  Workflow: workflow,
  'Knowledge Graph': knowledgeGraph,
};
