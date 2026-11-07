import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { platform, actor } from './helpers.ts';
import { ConstitutionalError } from '../src/kernel/errors.ts';
import { platformPath } from '../src/kernel/config.ts';
import { ApiServer } from '../src/api/server.ts';
import { simplex } from '../src/intelligence/optimization.ts';
import type { Entry } from '../src/registry/types.ts';

const p = platform();
const operator = () => actor(p, 'operator');
const council = () => actor(p, 'council-member-1', 'Foundation Council');
const certifier = () => actor(p, 'certifier');
const roles = () => p.governance.pipelineRoles();
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const rule = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as ConstitutionalError).rule ?? (e as Error).message;
  }
  return 'NO-ERROR';
};

test('genesis: fixed point, governance and constitution are registered and certified', () => {
  const mfr = p.fabric.resolve('MFR').entry;
  assert.equal(mfr.lifecycle.status, 'CERTIFIED');
  assert.ok(p.store.edgesFrom(mfr.canonicalId, 'BOOTSTRAPS').some((e) => e.target === mfr.canonicalId));
  assert.equal(p.fabric.query({ kind: 'Primitive' }).total, 7);
  assert.equal(p.fabric.query({ kind: 'Concept' }).total, 31);
  assert.equal(p.fabric.resolve('UCI-020').entry.kind, 'Invariant');
  assert.equal(p.fabric.resolve('C-25').entry.definition.canonicalName, 'Intelligence');
  assert.equal(p.fabric.query({ kind: 'Composition', status: 'CERTIFIED' }).total, 12);
  assert.equal(p.fabric.query({ kind: 'Generator', status: 'CERTIFIED' }).total, 8);
  assert.throws(() => p.store.db.exec("UPDATE versions SET actor = 'x'"), /append-only/);
  assert.throws(() => p.store.db.exec('DELETE FROM events'), /permanent/);
});

test('ontology: derivation chains terminate at Tier-0 and tiers are computed', () => {
  const d = p.ontology.derivation('C-25');
  assert.ok(d.terminates);
  assert.equal(d.chain.at(-1)!.tier, 0);
  assert.equal(p.ontology.lookup('C-20')!.tier > 1, true);
  const refused = p.ontology.checkChain(['C-99'], 'Concept');
  assert.equal(refused.violations[0].rule, 'UCL-D03');
});

test('registry: duplicates, cycles, retirement gate and supersession', () => {
  const r = roles();
  const a = p.fabric.admitCertified({ kind: 'Rule', name: 'test-rule-a', statement: 'A test rule states that tests are deterministic and isolated.' }, r);
  assert.equal(rule(() => p.fabric.admitCertified({ kind: 'Rule', name: 'test-rule-b', statement: 'A test rule states that tests are deterministic and isolated.' }, r)), 'UCI-003');
  const b = p.fabric.admitCertified({ kind: 'Rule', name: 'test-rule-c', statement: 'Rule C depends on rule A for its meaning in every test.', dependencies: [{ target: a.canonicalId, type: 'SEMANTIC' }] }, r);
  assert.equal(rule(() => p.fabric.relate('DEPENDS-ON', a.canonicalId, b.canonicalId, r.author)), 'UCI-014');
  assert.equal(rule(() => p.fabric.retire(a.canonicalId, r.author)), 'V-FR-09');
  const a2 = p.fabric.admitCertified({ kind: 'Rule', name: 'test-rule-a2', statement: 'A second-generation test rule replaces the first one entirely.' }, r);
  p.fabric.supersede(a.canonicalId, a2.canonicalId, r.author);
  const res = p.fabric.resolve(a.canonicalId);
  assert.equal(res.entry.canonicalId, a2.canonicalId);
  assert.equal(res.superseded, true);
});

test('governance: separation of powers is structural', () => {
  const r = roles();
  const draft = p.fabric.submit({ kind: 'Rule', name: 'separation-probe', statement: 'The separation probe verifies that ratifiers never certify.' }, r.author);
  p.fabric.propose(draft.canonicalId, r.author);
  p.fabric.ratify(draft.canonicalId, [council()]);
  assert.equal(rule(() => p.fabric.certify(draft.canonicalId, council())), 'X-FR-01');
  assert.deepEqual(p.governance.membershipViolations(['Foundation Council', 'Certification Body']).length > 0, true);
  const agent = p.governanceAgent()!;
  assert.equal(rule(() => p.policy.enforce({ action: 'registry.certify', actor: { ...agent, purpose: undefined }, context: p.context.forPurpose('governance', { Governance: { policies: [] } }, agent) })), 'UCI-020');
});

test('context: merge algebra is proven and conflicts refuse', () => {
  const alg = p.context.proveAlgebra(300, 7);
  assert.ok(alg.deterministic && alg.commutative && alg.associative, JSON.stringify(alg.failures));
  const op = operator();
  const ctx = p.context.resolve({ purpose: 'pricing', contributions: p.context.contributionsFrom({ Economic: { currency: 'EUR' } }, op) }, op);
  assert.equal(ctx.bindings.Economic.currency, 'EUR');
  assert.equal(ctx.reality, 'actual');
  const simulated = [
    { dimension: 'Reality', field: 'mode', value: 'simulated', contributor: op.principal, authority: op.authority, specificity: 5 },
    { dimension: 'Reality', field: 'mode', value: 'actual', contributor: op.principal, authority: op.authority, specificity: 1 },
  ];
  assert.equal(rule(() => p.context.resolve({ purpose: 'pricing', contributions: simulated }, op)), 'V-CX-08');
  const lowTrust = [
    { dimension: 'Security', field: 'trustLevel', value: 3, contributor: op.principal, authority: 'Constitutional Assembly' },
    { dimension: 'Security', field: 'trustLevel', value: 1, contributor: op.principal, authority: op.authority },
  ];
  assert.equal(p.context.resolve({ purpose: 'access', contributions: lowTrust }, op).bindings.Security.trustLevel, 1);
});

let offer: Entry;
let room: Entry;

test('commerce: roles by facets, context-conditioned prices, currency and tax', () => {
  const op = operator();
  p.fabric.admitCertified({ kind: 'Attribute', name: 'floorArea', statement: '', content: { semanticType: 'C-21', cardinality: 'one' }, labels: { en: 'Floor area' } }, roles());
  assert.equal(rule(() => p.commerce.defineExchangeable({ name: 'bad', entity: { name: 'x', attributes: { colourCode: 'red' } }, facets: { F2: 'durable' } }, op)), 'UPL-004');
  assert.equal(rule(() => p.commerce.defineExchangeable({ name: 'bad2', entity: { name: 'y' }, facets: { F7: 'booking', F2: 'durable' } }, op)), 'V-US-02');
  const def = p.commerce.defineExchangeable({ name: 'Harbour room 12 nightly', entity: { name: 'Harbour room 12', attributes: { floorArea: { magnitude: 24, unit: 'm2' } } }, facets: { F1: 'physical', F2: 'windowed', F3: 'rival', F4: 'non-transferable', F5: 'access', F6: 'unique', F7: 'booking' } }, op);
  assert.ok(def.roles.includes('booking'), JSON.stringify(def.roles));
  assert.ok(!def.roles.includes('product'));
  room = p.commerce.list(def.exchangeable.canonicalId, op);
  const tax = p.fabric.admitCertified({ kind: 'Policy', name: 'Regime 2 levy', statement: 'Regime 2 levies ten percent and restricts acceptance to adults.', content: { issuer: 'OPS Operating Authority', purpose: 'regional levy', scope: { actions: ['commerce.*'] }, rules: [], taxRules: [{ when: "Spatial.jurisdiction = 'region-2'", ratePercent: 10, description: 'regional levy' }], entitlementConditions: [{ when: "Spatial.jurisdiction = 'region-2'", kind: 'age', statement: 'holder must be an adult' }], effectiveFrom: hourAgo() } }, roles());
  p.policy.invalidate();
  offer = p.commerce.publishOffer({ subject: room.canonicalId, entitlementSpec: { form: 'booking', capability: 'stay', duration: { magnitude: 1, unit: 'd' } }, consideration: [{ magnitude: 100, unit: 'EUR', contextConditions: ["Temporal.season = 'in'"] }, { magnitude: 140, unit: 'EUR', contextConditions: ["Temporal.season = 'off'"] }], validity: { window: { start: hourAgo(), end: null } }, allocationPolicy: { mechanism: 'first-come', capacity: 10 }, policies: [tax.canonicalId] }, op);
  assert.equal(offer.lifecycle.status, 'ACTIVE');
  assert.equal(p.fabric.require(room.canonicalId).lifecycle.status, 'TRADABLE');
  assert.equal(p.commerce.quote(offer.canonicalId, op, { Temporal: { season: 'in' }, Economic: { currency: 'EUR' } }).total!.magnitude, 100);
  assert.equal(p.commerce.quote(offer.canonicalId, op, { Temporal: { season: 'off' }, Economic: { currency: 'EUR' } }).total!.magnitude, 140);
  assert.equal(rule(() => p.commerce.quote(offer.canonicalId, op, { Temporal: { season: 'in' }, Economic: { currency: 'USD' } })), 'V-MS-04');
  p.measure.exchangeRate({ from: 'EUR', to: 'USD', rate: 1.1, valuer: 'OPS Operating Authority', validity: { start: hourAgo(), end: null } }, op, p.context.forPurpose('pricing', {}, op));
  assert.equal(p.commerce.quote(offer.canonicalId, op, { Temporal: { season: 'in' }, Economic: { currency: 'USD' } }).total!.magnitude, 110);
  const q3 = p.commerce.quote(offer.canonicalId, op, { Temporal: { season: 'in' }, Economic: { currency: 'EUR' }, Spatial: { jurisdiction: 'region-2' } });
  assert.equal(q3.total!.magnitude, 110);
  assert.equal(q3.entitlementConditions[0].kind, 'age');
});

test('commerce: acceptance, rivalry in window, settlement, simulation firewall, checks', () => {
  const op = operator();
  const holder = p.entities.create({ name: 'Guest A' }, op);
  const ctx = { Temporal: { season: 'in' }, Economic: { currency: 'EUR' } };
  const a = p.commerce.accept({ offer: offer.canonicalId, holder: holder.canonicalId }, op, ctx);
  assert.equal(a.entitlement.lifecycle.status, 'ACTIVE');
  assert.equal(p.ledger.balance(holder.canonicalId, 'EUR').balance, -100);
  assert.equal(rule(() => p.commerce.accept({ offer: offer.canonicalId, holder: holder.canonicalId }, op, ctx)), 'V-RS-03');
  const check = p.commerce.checkEntitlement({ holder: holder.canonicalId, capability: 'stay' }, op);
  assert.equal(check.permitted, true);
  const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
  assert.equal(p.commerce.checkEntitlement({ holder: holder.canonicalId, capability: 'stay' }, op, { Temporal: { instant: later } }).permitted, false);
  const guestB = p.entities.create({ name: 'Guest B' }, op);
  const window = { start: new Date(Date.now() + 10 * 86_400_000).toISOString(), end: new Date(Date.now() + 11 * 86_400_000).toISOString() };
  const sim = p.commerce.accept({ offer: offer.canonicalId, holder: guestB.canonicalId, window }, op, { ...ctx, Reality: { mode: 'simulated' } });
  assert.equal(sim.entitlement.content.simulated, true);
  assert.equal(p.ledger.balance(guestB.canonicalId, 'EUR').balance, 0);
  assert.equal(p.commerce.checkEntitlement({ holder: guestB.canonicalId, capability: 'stay' }, op, { Temporal: { instant: new Date(Date.parse(window.start) + 1000).toISOString() } }).permitted, false);
  assert.equal(rule(() => p.commerce.transfer({ entitlement: a.entitlement.canonicalId, newHolder: guestB.canonicalId }, op)), 'US-S-03');
  const revoked = p.commerce.revoke(a.entitlement.canonicalId, 'test revocation', op);
  assert.deepEqual(revoked, [a.entitlement.canonicalId]);
});

test('composition: recipes certify, instantiate into eight derivatives, run, suspend', async () => {
  const booking = p.fabric.query({ kind: 'Composition', nameLike: 'Booking' }).entries[0];
  const inst = p.composition.instantiate(booking.canonicalId, { targets: p.generation.listTargets().map((t) => ({ generator: t.generator })) }, council());
  assert.equal(inst.artifacts.length, 8);
  assert.equal(inst.composition.lifecycle.status, 'INSTANTIATED');
  const ui = inst.artifacts.find((a) => a.content.targetSpace === 'UI')!;
  const def = JSON.parse(p.generation.readFile(ui.canonicalId, 'ui.definition.json'));
  assert.ok(def.actions.length > 0);
  const out = await p.runtime.invoke({ composition: booking.canonicalId, capability: 'offer', operation: 'quote', input: { offer: offer.canonicalId }, context: { Temporal: { season: 'off' }, Economic: { currency: 'EUR' } } }, operator());
  assert.equal((out.result as { total: { magnitude: number } }).total.magnitude, 140);
  p.composition.suspend(booking.canonicalId, 'test suspension', council());
  await assert.rejects(p.runtime.invoke({ composition: booking.canonicalId, capability: 'offer', operation: 'quote', input: { offer: offer.canonicalId } }, operator()), /C-CM-03/);
  p.composition.resume(booking.canonicalId, 'test over', council());
  const bad = p.composition.compose({ label: 'Probe', intent: 'Arrange availability alone.', capabilities: ['availability'] }, council());
  const verdict = p.composition.validate(bad.canonicalId, council());
  assert.ok(verdict.violations.some((v) => v.rule === 'V-CM-05'), JSON.stringify(verdict.violations));
});

test('generation: deterministic, attested, tamper-evident, stale-propagating', () => {
  const art = p.generation.generate({ subject: 'UCOS-REG-UNT-0000000001', generator: 'Documentation', variant: 'markdown' }, council());
  assert.equal(p.generation.verify(art.canonicalId).intact, true);
  assert.equal(p.generation.reproduce(art.canonicalId).identical, true);
  const file = join(platformPath(p.cfg.paths.generatedOutput), art.canonicalId, 'README.md');
  appendFileSync(file, '\nhand edit\n');
  const v = p.generation.verify(art.canonicalId);
  assert.equal(v.tampered, true);
  assert.equal(p.fabric.require(art.canonicalId).lifecycle.status, 'TAMPERED');
  p.generation.regenerate(art.canonicalId, council());
  assert.equal(p.generation.verify(art.canonicalId).intact, true);
  const kg = p.generation.generate({ subject: 'UCOS-REG-CXT-0000000001', generator: 'Knowledge Graph', variant: 'n-triples' }, council());
  const dim = p.fabric.query({ kind: 'ContextDimension', limit: 1 }).entries[0];
  p.labels.setLabel(dim.canonicalId, 'fr', 'Dimension', council());
  assert.equal(p.fabric.require(kg.canonicalId).lifecycle.status, 'STALE');
});

test('optimization: simplex, integer programs, refusals without objective or feasibility', () => {
  const r = simplex({ c: [3, 2], rows: [{ a: [1, 1], sense: '<=', b: 4 }, { a: [1, 3], sense: '<=', b: 6 }], maximize: true });
  assert.equal(r.status, 'optimal');
  const op = council();
  const ctx = p.context.forPurpose('optimization', {}, op);
  const model = p.optimization.registerModel({ name: 'Test production plan', statement: 'Allocate two activities under two linear capacities.', variables: [{ name: 'x', domain: 'continuous' }, { name: 'y', domain: 'continuous' }], constraints: [{ name: 'capacity', expression: 'x + y <= 4' }, { name: 'labour', expression: 'x + 3*y <= 6' }], parameters: { margin: { value: 3, uncertainty: 0.2 } }, assumptions: ['linear returns'] }, op);
  const objective = p.optimization.registerObjective({ name: 'Maximise test margin', statement: 'Maximise the total margin of the test production plan.', model: model.canonicalId, sense: 'maximize', expression: 'margin*x + 2*y' }, op);
  const res = p.optimization.optimize({ model: model.canonicalId, objective: objective.canonicalId, samples: 100 }, op, ctx);
  assert.equal(res.status, 'OPTIMAL');
  assert.equal(res.objectiveValue, 12);
  assert.ok(res.uncertainty!.standardDeviation > 0);
  assert.equal(p.optimization.optimize({ model: model.canonicalId }, op, ctx).status, 'REFUSED');
  assert.equal(p.optimization.optimize({ model: model.canonicalId, objective: objective.canonicalId, constraints: [{ name: 'impossible', expression: 'x >= 10' }] }, op, ctx).status, 'REFUSED');
  const im = p.optimization.registerModel({ name: 'Test integer plan', statement: 'An integer programme over two indivisible activities.', variables: [{ name: 'a', domain: 'integer' }, { name: 'b', domain: 'integer' }], constraints: [{ name: 'cap', expression: '2*a + 2*b <= 5' }], assumptions: ['indivisible units'] }, op);
  const io = p.optimization.registerObjective({ name: 'Maximise test units', statement: 'Maximise the number of indivisible test units.', model: im.canonicalId, sense: 'maximize', expression: 'a + b' }, op);
  assert.equal(p.optimization.optimize({ model: im.canonicalId, objective: io.canonicalId }, op, ctx).objectiveValue, 2);
});

test('reasoning and knowledge: inference with chains, contradictions, reconciliation', () => {
  const r = roles();
  const scheme = p.commerceSchemes()[0];
  const mk = (n: string) => p.fabric.admitCertified({ kind: 'Taxon', name: n, statement: '', content: { qualifier: scheme, scheme, admissionRule: null, attributes: [], policies: [] }, labels: { en: n }, relationships: [{ type: 'MEMBER-OF', target: scheme }] }, r);
  const [x, y, z] = [mk('probe-x'), mk('probe-y'), mk('probe-z')];
  p.fabric.relate('NARROWER-THAN', x.canonicalId, y.canonicalId, r.author);
  p.fabric.relate('NARROWER-THAN', y.canonicalId, z.canonicalId, r.author);
  const ctx = p.context.forPurpose('discovery', {}, council());
  const inf = p.reasoning.infer({ types: ['NARROWER-THAN'], record: true }, council(), ctx);
  const d = inf.derived.find((f) => f.source === x.canonicalId && f.target === z.canonicalId)!;
  assert.equal(d.derivationChain.length, 2);
  assert.ok(inf.recorded.length > 0);
  p.fabric.relate('DISJOINT-WITH', x.canonicalId, z.canonicalId, r.author);
  assert.ok(p.reasoning.contradictions().contradictions.length > 0);
  const k1 = p.knowledge.assert({ subject: x.canonicalId, statement: 'Probe x is narrower than probe z.', justification: 'derived in test', confidence: 0.6 }, council(), ctx);
  const k2 = p.knowledge.assert({ subject: x.canonicalId, statement: 'Probe x is narrower than probe z.', justification: 'derived again', confidence: 0.9 }, council(), ctx);
  assert.equal(k1.canonicalId, k2.canonicalId);
});

test('autonomy: envelope cannot be amended; autonomy is context-relative', () => {
  const agent = p.governanceAgent()!;
  const ctx = p.context.forPurpose('governance', { Governance: { policies: [] } }, agent);
  const pol = p.policy.policies()[0];
  assert.equal(rule(() => p.autonomy.amendPolicy({ policy: pol.canonicalId, change: { x: 1 } }, agent, ctx)), 'IN-A1');
  assert.ok(p.bus.query({ type: 'int.envelope.amendment.attempted', limit: 1 }).length === 1);
  const cap = p.fabric.query({ kind: 'IntelligenceCapability', nameLike: 'Autonomous Governance' }).entries[0];
  assert.equal(p.autonomy.requestAutonomy(cap.canonicalId, council(), ctx).level, 'conditional-autonomous');
  const simCtx = p.context.forPurpose('governance', { Governance: { policies: [] }, Reality: { mode: 'simulated' } }, council());
  assert.equal(p.autonomy.requestAutonomy(cap.canonicalId, council(), simCtx).level, 'advisory');
});

test('constitution: every invariant holds after all flows', () => {
  const audit = p.validation.audit({ deep: true });
  const broken = audit.invariants.filter((i) => i.status !== 'HOLDS');
  assert.deepEqual(broken.map((i) => `${i.id}: ${i.violations.slice(0, 3).map((v) => `${v.subject} ${v.message}`).join(' | ')}`), []);
  assert.equal(audit.integrity.ok, true);
});

test('http: public reads, protected writes, constitutional errors carry their rule', async () => {
  const api = new ApiServer(p);
  const server = createServer((req, res) => void api.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(((await (await fetch(`${base}/api/health`)).json()) as { status: string }).status, 'ok');
    const denied = await fetch(`${base}/api/commerce/quote`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 403);
    const tokenValue = p.credentials.tokens.operator;
    const q = await fetch(`${base}/api/commerce/quote`, { method: 'POST', headers: { authorization: `Bearer ${tokenValue}` }, body: JSON.stringify({ offer: offer.canonicalId, context: { Temporal: { season: 'in' }, Economic: { currency: 'EUR' } } }) });
    assert.equal(q.status, 200);
    assert.equal(((await q.json()) as { total: { magnitude: number } }).total.magnitude, 100);
    const bad = await fetch(`${base}/api/commerce/quote`, { method: 'POST', headers: { authorization: `Bearer ${tokenValue}` }, body: JSON.stringify({ offer: offer.canonicalId, context: { Reality: { mode: 'dream' } } }) });
    assert.equal(((await bad.json()) as { rule: string }).rule, 'V-CX-03');
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('app.js'));
  } finally {
    server.close();
  }
});
