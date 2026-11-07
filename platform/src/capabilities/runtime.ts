import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext, Contribution } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';

type Env = { actor: Actor; ctx: ResolvedContext; composition: Entry | null; contextMap: Record<string, Record<string, unknown>> };
type Handler = (op: string, input: Record<string, unknown>, env: Env) => unknown | Promise<unknown>;

const PURPOSE_BY_HANDLER: Record<string, string> = {
  offers: 'pricing',
  entitlements: 'entitlement-check',
  settlement: 'settlement',
  valuation: 'pricing',
  measurement: 'measurement',
  resources: 'allocation',
  availability: 'allocation',
  allocation: 'allocation',
  workflow: 'workflow',
  compensation: 'workflow',
  policy: 'policy-evaluation',
  discovery: 'discovery',
  matching: 'recommendation',
  catalog: 'classification',
  segmentation: 'classification',
  planning: 'optimization',
  rendering: 'generation',
  localization: 'generation',
  escalation: 'governance',
  dunning: 'governance',
};

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new ConstitutionalError('V-CB-03', `input ${name} is required`);
  return v;
}

/**
 * The capability runtime. Handlers are platform operation families — the
 * powers registered as capabilities — and contain no system-specific logic:
 * a marketplace, a booking system and an ERP invoke the same handlers,
 * arranged differently by their certified compositions (UCL-C01).
 */
export class CapabilityRuntime {
  private readonly p: Platform;
  private readonly handlers: Record<string, Handler>;

  constructor(p: Platform) {
    this.p = p;
    this.handlers = this.buildHandlers();
  }

  handlerNames(): string[] {
    return Object.keys(this.handlers);
  }

  /**
   * INVOKE: composition must be certified or instantiated and not suspended
   * (C-CM-03); the capability must belong to it and be certified; the
   * composition's context bounds are merged with the caller's contributions
   * (a conflict refuses, C-CM-02); policy is enforced before execution.
   */
  async invoke(input: { composition?: string; capability: string; operation: string; input?: Record<string, unknown>; context?: Record<string, Record<string, unknown>> }, actor: Actor): Promise<{ result: unknown; context: Record<string, unknown>; composition: string | null }> {
    const cap = this.p.composition.capabilityByName(input.capability);
    if (!['CERTIFIED', 'ADMISSIBLE'].includes(cap.lifecycle.status)) throw new ConstitutionalError('V-CM-01', `capability ${input.capability} is ${cap.lifecycle.status}`);
    const ops = (cap.content.operations as string[]) ?? [];
    if (!ops.includes(input.operation)) throw new ConstitutionalError('Phase008-§5.2', `operation ${input.operation} is not in the contract of ${input.capability} (${ops.join(', ')})`);
    let comp: Entry | null = null;
    let bounds: Contribution[] = [];
    if (input.composition) {
      comp = this.p.fabric.resolve(input.composition).entry;
      if (comp.lifecycle.status === 'SUSPENDED') {
        this.p.bus.emit({ type: 'cmp.suspended.invocation.refused', subject: comp.canonicalId, actor, payload: { capability: input.capability, operation: input.operation, rule: 'C-CM-03' } });
        throw new ConstitutionalError('C-CM-03', `composition ${comp.definition.canonicalName} is suspended; actions are blocked while events continue`);
      }
      if (!['CERTIFIED', 'INSTANTIATED'].includes(comp.lifecycle.status)) throw new ConstitutionalError('C-CM-01', `composition ${comp.definition.canonicalName} is ${comp.lifecycle.status}; only certified compositions operate`);
      if (!this.p.composition.allCapabilities(comp).includes(cap.canonicalId)) throw new ConstitutionalError('CM-P2', `${input.capability} is not part of ${comp.definition.canonicalName}`);
      bounds = this.p.context.contributionsFrom((comp.content.contextBounds as Record<string, Record<string, unknown>>) ?? {}, { principal: comp.canonicalId, authority: comp.ownership.canonicalOwner }, 0);
    }
    const handlerName = String(cap.content.handler);
    const handler = this.handlers[handlerName];
    if (!handler) throw new ConstitutionalError('Phase008-§12', `capability ${input.capability} has no registered runtime handler ${handlerName}`);
    const purpose = PURPOSE_BY_HANDLER[handlerName] ?? 'policy-evaluation';
    let ctx: ResolvedContext;
    try {
      ctx = this.p.context.resolve({ purpose, contributions: [...bounds, ...this.p.context.contributionsFrom(input.context, actor)] }, actor);
    } catch (e) {
      if (comp) throw new ConstitutionalError('C-CM-02', `invocation outside the context bounds of ${comp.definition.canonicalName}: ${(e as Error).message}`, (e as ConstitutionalError).details);
      throw e;
    }
    this.p.policy.enforce({ action: 'capability.invoke', subject: comp ?? cap, actor, context: ctx, attributes: { capability: input.capability, operation: input.operation } });
    const result = await handler(input.operation, input.input ?? {}, { actor, ctx, composition: comp, contextMap: input.context ?? {} });
    this.p.bus.emit({ type: 'cap.invoked', subject: comp?.canonicalId ?? cap.canonicalId, actor, payload: { capability: input.capability, operation: input.operation, purpose: actor.purpose ?? purpose }, context: { ...ctx.record, purpose: actor.purpose ?? purpose } });
    return { result, context: ctx.record, composition: comp?.canonicalId ?? null };
  }

  private buildHandlers(): Record<string, Handler> {
    const p = this.p;
    const map = (env: Env) => env.contextMap;
    return {
      identity: (op, i, env) => {
        if (op === 'resolve') return p.fabric.resolve(str(i.ref, 'ref'));
        if (op === 'principals') return p.governance.principalList().map((x) => ({ id: x.canonicalId, alias: x.alias, name: x.name, kind: x.principalKind, bodies: x.bodies }));
        if (op === 'register-principal') return p.registerPrincipal({ alias: str(i.alias, 'alias'), name: str(i.name, 'name'), principalKind: String(i.principalKind ?? 'human'), bodies: (i.bodies as string[]) ?? [] }, env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `identity: unknown operation ${op}`);
      },
      participants: (op, i, env) => {
        if (op === 'register') return p.entities.create({ name: str(i.name, 'name'), statement: String(i.statement ?? ''), attributes: (i.attributes as Record<string, unknown>) ?? {}, namespace: i.namespace as string | undefined }, env.actor);
        if (op === 'set-attributes') return p.entities.setAttributes(str(i.entity, 'entity'), (i.attributes as Record<string, unknown>) ?? {}, env.actor);
        if (op === 'list') return p.fabric.query({ kind: 'Entity', namespace: i.namespace as string | undefined, limit: Number(i.limit ?? 100), offset: Number(i.offset ?? 0) });
        throw new ConstitutionalError('Phase008-§5.2', `participants: unknown operation ${op}`);
      },
      catalog: (op, i, env) => {
        if (op === 'define') return p.commerce.defineExchangeable(i as never, env.actor);
        if (op === 'classify') return p.taxonomy.classify(str(i.entity, 'entity'), env.actor, { schemes: i.schemes as string[] | undefined, context: env.ctx, inferred: i.inferred === true, confidence: i.confidence as number | undefined });
        if (op === 'paths') return p.taxonomy.paths(str(i.entity, 'entity'));
        if (op === 'list') return p.fabric.query({ kind: 'ExchangeableEntity', namespace: i.namespace as string | undefined, status: i.status as string | undefined, limit: Number(i.limit ?? 100), offset: Number(i.offset ?? 0) });
        if (op === 'bundle') return p.commerce.composeBundle(i as never, env.actor);
        if (op === 'tree') return p.taxonomy.tree(str(i.scheme, 'scheme'));
        throw new ConstitutionalError('Phase008-§5.2', `catalog: unknown operation ${op}`);
      },
      discovery: (op, i) => {
        if (op === 'search') return p.discovery.search(str(i.query, 'query'), { kinds: i.kinds as string[] | undefined, namespace: i.namespace as string | undefined, limit: i.limit as number | undefined });
        if (op === 'suggest') return p.discovery.suggestPrimitive(str(i.query, 'query'));
        throw new ConstitutionalError('Phase008-§5.2', `discovery: unknown operation ${op}`);
      },
      matching: (op, i, env) => {
        if (op === 'match') return p.recommendation.matchOffers({ need: (i.need as Record<string, unknown>) ?? {}, purpose: String(i.purpose ?? 'fit'), limit: Number(i.limit ?? 10) }, env.actor, env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `matching: unknown operation ${op}`);
      },
      offers: (op, i, env) => {
        if (op === 'publish') return p.commerce.publishOffer(i as never, env.actor, map(env));
        if (op === 'quote') return p.commerce.quote(str(i.offer, 'offer'), env.actor, undefined, env.ctx);
        if (op === 'withdraw') return p.commerce.withdrawOffer(str(i.offer, 'offer'), str(i.cause, 'cause'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `offers: unknown operation ${op}`);
      },
      entitlements: (op, i, env) => {
        if (op === 'accept') return p.commerce.accept(i as never, env.actor, map(env));
        if (op === 'check') return p.commerce.checkEntitlement(i as never, env.actor, map(env));
        if (op === 'consume') return p.commerce.consume(i as never, env.actor, map(env));
        if (op === 'transfer') return p.commerce.transfer(i as never, env.actor, map(env));
        if (op === 'renew') return p.commerce.renew(str(i.entitlement, 'entitlement'), env.actor);
        if (op === 'revoke') return p.commerce.revoke(str(i.entitlement, 'entitlement'), str(i.cause, 'cause'), env.actor);
        if (op === 'suspend') return p.commerce.suspend(str(i.entitlement, 'entitlement'), str(i.cause, 'cause'), env.actor);
        if (op === 'reinstate') return p.commerce.reinstate(str(i.entitlement, 'entitlement'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `entitlements: unknown operation ${op}`);
      },
      settlement: (op, i, env) => {
        if (op === 'transfer') {
          p.policy.enforce({ action: 'settlement.post', actor: env.actor, context: env.ctx, attributes: { simulated: env.ctx.reality !== 'actual' } });
          return p.ledger.transfer(i as never, env.actor, env.ctx);
        }
        if (op === 'reverse') return p.ledger.reverse(str(i.transferId, 'transferId'), str(i.cause, 'cause'), env.actor, env.ctx);
        if (op === 'balance') return p.ledger.balance(str(i.holder, 'holder'), str(i.unit, 'unit'), i.namespace as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `settlement: unknown operation ${op}`);
      },
      trust: (op, i, env) => {
        if (op === 'assess' || op === 'score') return p.trust.assess(str(i.subject, 'subject'), env.actor, env.ctx, i.constraint as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `trust: unknown operation ${op}`);
      },
      reputation: (op, i, env) => {
        if (op === 'rate') return p.trust.rate(i as never, env.actor, env.ctx);
        if (op === 'standing') return p.trust.standing(str(i.subject, 'subject'), str(i.purpose, 'purpose'));
        throw new ConstitutionalError('Phase008-§5.2', `reputation: unknown operation ${op}`);
      },
      disputes: (op, i, env) => {
        if (op === 'open') return p.disputes.open(i as never, env.actor, env.ctx);
        if (op === 'review') return p.disputes.review(str(i.dispute, 'dispute'), env.actor);
        if (op === 'escalate') return p.disputes.escalate(str(i.dispute, 'dispute'), str(i.to, 'to'), str(i.reason, 'reason'), env.actor);
        if (op === 'resolve') return p.disputes.resolve(str(i.dispute, 'dispute'), i.outcome as 'upheld', str(i.rationale, 'rationale'), env.actor, env.ctx);
        if (op === 'dismiss') return p.disputes.dismiss(str(i.dispute, 'dispute'), str(i.reason, 'reason'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `disputes: unknown operation ${op}`);
      },
      resources: (op, i, env) => {
        if (op === 'allocate') return p.resources.allocate(str(i.resource, 'resource'), (i.requests as never[]) ?? [], env.actor, env.ctx);
        if (op === 'commit') return p.resources.commit(str(i.allocation, 'allocation'), env.actor);
        if (op === 'consume') return p.resources.consume(str(i.allocation, 'allocation'), env.actor);
        if (op === 'release') return p.resources.release(str(i.allocation, 'allocation'), env.actor);
        if (op === 'capacity') return p.resources.defineResource(i as never, env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `resources: unknown operation ${op}`);
      },
      valuation: (op, i, env) => {
        if (op === 'value') return p.measure.value(i as never, env.actor, env.ctx);
        if (op === 'exchange-rate') return p.measure.exchangeRate(i as never, env.actor, env.ctx);
        if (op === 'convert') return p.measure.convert(Number(i.magnitude), str(i.from, 'from'), str(i.to, 'to'), env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `valuation: unknown operation ${op}`);
      },
      measurement: (op, i, env) => {
        if (op === 'record') return p.measure.record(i as never, env.actor, env.ctx);
        if (op === 'convert') return p.measure.convert(Number(i.magnitude), str(i.from, 'from'), str(i.to, 'to'), env.ctx);
        if (op === 'units') return p.measure.units(i.dimension as string | undefined).map((u) => ({ id: u.canonicalId, symbol: u.content.symbol, name: u.definition.canonicalName, dimension: u.content.dimension }));
        throw new ConstitutionalError('Phase008-§5.2', `measurement: unknown operation ${op}`);
      },
      workflow: (op, i, env) => {
        if (op === 'start') return p.workflow.start(i as never, env.actor, env.ctx);
        if (op === 'advance') return p.workflow.advance(str(i.instance, 'instance'), (i.result as Record<string, unknown>) ?? {}, env.actor);
        if (op === 'complete') {
          let wf = p.fabric.require(str(i.instance, 'instance'));
          while (wf.lifecycle.status === 'EXECUTING') wf = p.workflow.advance(wf.canonicalId, (i.result as Record<string, unknown>) ?? {}, env.actor);
          return wf;
        }
        if (op === 'fail') return p.workflow.fail(str(i.instance, 'instance'), str(i.cause, 'cause'), env.actor);
        if (op === 'definitions') return p.workflow.definitions(i.namespace as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `workflow: unknown operation ${op}`);
      },
      compensation: (op, i, env) => {
        if (op === 'compensate') return p.workflow.compensate(str(i.instance, 'instance'), str(i.cause, 'cause'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `compensation: unknown operation ${op}`);
      },
      policy: (op, i, env) => {
        if (op === 'evaluate') return p.policy.evaluate({ action: str(i.action, 'action'), subject: i.subject ? p.fabric.resolve(String(i.subject)).entry : null, actor: env.actor, context: env.ctx, attributes: i.attributes as Record<string, unknown> | undefined });
        throw new ConstitutionalError('Phase008-§5.2', `policy: unknown operation ${op}`);
      },
      events: (op, i) => {
        if (op === 'query') return p.bus.query({ subject: i.subject as string | undefined, type: i.type as string | undefined, afterSeq: i.afterSeq as number | undefined, limit: i.limit as number | undefined });
        if (op === 'state-at') return p.entities.stateAt(str(i.entity, 'entity'), str(i.instant, 'instant'));
        throw new ConstitutionalError('Phase008-§5.2', `events: unknown operation ${op}`);
      },
      reporting: (op, i) => {
        if (op === 'summary') return { byKind: p.fabric.countBy('kind'), byStatus: p.fabric.countBy('status'), byNamespace: p.fabric.countBy('namespace'), events: p.bus.count() };
        if (op === 'values') return p.reporting.valueTotals(i.purpose as string | undefined, i.namespace as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `reporting: unknown operation ${op}`);
      },
      audit: (op, i) => {
        if (op === 'lineage') return p.fabric.lineage(str(i.id, 'id'));
        if (op === 'attest') return p.fabric.attest(str(i.id, 'id'));
        if (op === 'invariants') return p.validation.audit({ deep: i.deep !== false });
        throw new ConstitutionalError('Phase008-§5.2', `audit: unknown operation ${op}`);
      },
      graph: (op, i, env) => {
        if (op === 'relate') return p.fabric.relate(str(i.type, 'type'), str(i.source, 'source'), str(i.target, 'target'), env.actor, { context: i.context as Record<string, unknown> | undefined });
        if (op === 'traverse') return p.fabric.traverse(str(i.start, 'start'), { types: i.types as string[] | undefined, direction: i.direction as 'out' | undefined, depth: i.depth as number | undefined });
        if (op === 'relationships') return p.fabric.relationshipsOf(p.fabric.resolve(str(i.id, 'id')).entry.canonicalId);
        throw new ConstitutionalError('Phase008-§5.2', `graph: unknown operation ${op}`);
      },
      history: (op, i) => {
        if (op === 'history') return p.bus.query({ subject: p.fabric.resolve(str(i.subject, 'subject')).entry.canonicalId, limit: Number(i.limit ?? 500) }).reverse();
        throw new ConstitutionalError('Phase008-§5.2', `history: unknown operation ${op}`);
      },
      notification: async (op, i, env) => {
        if (op === 'notify') return p.notifications.notify(i as never, env.actor, env.ctx);
        if (op === 'dispatch') return p.notifications.dispatch(str(i.notification, 'notification'), env.actor);
        if (op === 'outbox') return p.notifications.outbox(i.recipient as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `notification: unknown operation ${op}`);
      },
      segmentation: (op, i, env) => {
        if (op === 'segment') return ((i.entities as string[]) ?? []).map((e) => p.taxonomy.classify(e, env.actor, { schemes: i.schemes as string[] | undefined, context: env.ctx }));
        if (op === 'members') {
          const taxon = p.taxonomy.resolveTaxon(str(i.taxon, 'taxon')).canonicalId;
          return p.store.edgesTo(taxon, 'CLASSIFIED-AS').map((e) => ({ entity: e.source, name: p.store.head(e.source)?.canonical_name }));
        }
        throw new ConstitutionalError('Phase008-§5.2', `segmentation: unknown operation ${op}`);
      },
      temporal: (op, i) => {
        if (op === 'compare') return p.ordering.compare(str(i.a, 'a'), str(i.b, 'b'));
        if (op === 'intersect') return p.ordering.intersect(i.a as never, i.b as never);
        if (op === 'shift') return p.ordering.shift(str(i.instant, 'instant'), i.by as never);
        throw new ConstitutionalError('Phase008-§5.2', `temporal: unknown operation ${op}`);
      },
      recurrence: (op, i) => {
        if (op === 'expand') return p.ordering.expand(str(i.anchor, 'anchor'), i.scheme as never, Number(i.limit ?? 1000));
        throw new ConstitutionalError('Phase008-§5.2', `recurrence: unknown operation ${op}`);
      },
      availability: (op, i) => {
        if (op === 'windows') return p.resources.availability(str(i.resource, 'resource'), i.window as never);
        throw new ConstitutionalError('Phase008-§5.2', `availability: unknown operation ${op}`);
      },
      allocation: (op, i, env) => {
        if (op === 'allocate') return p.resources.allocate(str(i.resource, 'resource'), (i.requests as never[]) ?? [], env.actor, env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `allocation: unknown operation ${op}`);
      },
      spatial: (op, i) => {
        if (op === 'distance') return p.ordering.distance(i.a as never, i.b as never, i.frame as string | undefined);
        if (op === 'contains') return p.ordering.contains(i.ring as never, i.point as never);
        if (op === 'regions') return p.ordering.regionsAt(i.point as never, i.instant as string | undefined);
        throw new ConstitutionalError('Phase008-§5.2', `spatial: unknown operation ${op}`);
      },
      contracts: (op, i, env) => {
        if (op === 'draft') return p.contracts.draft(i as never, env.actor, env.ctx);
        if (op === 'propose') return p.contracts.propose(str(i.contract, 'contract'), env.actor);
        if (op === 'accept') return p.contracts.accept(str(i.contract, 'contract'), str(i.party, 'party'), env.actor);
        if (op === 'fulfil') return p.contracts.fulfil(str(i.contract, 'contract'), str(i.obligation, 'obligation'), str(i.evidence, 'evidence'), env.actor);
        if (op === 'breach') return p.contracts.breach(str(i.contract, 'contract'), str(i.evidence, 'evidence'), env.actor);
        if (op === 'remedy') return p.contracts.remedy(str(i.contract, 'contract'), str(i.remedy, 'remedy'), env.actor);
        if (op === 'terminate') return p.contracts.terminate(str(i.contract, 'contract'), str(i.cause, 'cause'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `contracts: unknown operation ${op}`);
      },
      risk: (op, i, env) => {
        if (op === 'assess') return p.risk.assess(i as never, env.actor, env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `risk: unknown operation ${op}`);
      },
      knowledge: (op, i, env) => {
        if (op === 'assert') return p.knowledge.assert(i as never, env.actor, env.ctx);
        if (op === 'refute') return p.knowledge.refute(str(i.knowledge, 'knowledge'), str(i.reason, 'reason'), env.actor, i.successor as string | undefined);
        if (op === 'refine') return p.knowledge.refine(str(i.knowledge, 'knowledge'), Number(i.confidence), (i.evidence as string[]) ?? [], env.actor);
        if (op === 'query') return p.knowledge.about(str(i.subject, 'subject'));
        throw new ConstitutionalError('Phase008-§5.2', `knowledge: unknown operation ${op}`);
      },
      models: (op, i, env) => {
        if (op === 'register') return p.optimization.registerModel(i as never, env.actor);
        if (op === 'list') return p.fabric.query({ kind: 'DecisionModel', limit: 1000 }).entries;
        throw new ConstitutionalError('Phase008-§5.2', `models: unknown operation ${op}`);
      },
      inference: (op, i, env) => {
        if (op === 'infer') return p.reasoning.infer({ types: (i.types as string[]) ?? undefined, maxDepth: Number(i.maxDepth ?? 4), record: i.record === true }, env.actor, env.ctx);
        if (op === 'contradictions') return p.reasoning.contradictions();
        throw new ConstitutionalError('Phase008-§5.2', `inference: unknown operation ${op}`);
      },
      planning: (op, i, env) => {
        if (op === 'optimize') return p.optimization.optimize(i as never, env.actor, env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `planning: unknown operation ${op}`);
      },
      alignment: (op, i, env) => {
        if (op === 'record') return p.autonomy.recordAlignment(str(i.capability, 'capability'), i.evidence as Record<string, unknown>, env.actor);
        if (op === 'verify') return p.autonomy.verifyAlignment(str(i.capability, 'capability'));
        throw new ConstitutionalError('Phase008-§5.2', `alignment: unknown operation ${op}`);
      },
      rendering: (op, i, env) => {
        if (op === 'generate') return p.generation.generate({ subject: str(i.subject, 'subject'), generator: str(i.generator, 'generator'), variant: i.variant as string | undefined }, env.actor, env.ctx);
        if (op === 'verify') return p.generation.verify(str(i.artifact, 'artifact'));
        throw new ConstitutionalError('Phase008-§5.2', `rendering: unknown operation ${op}`);
      },
      localization: (op, i, env) => {
        if (op === 'label') return p.labels.label(str(i.id, 'id'), String(env.ctx.bindings.Linguistic?.locale ?? p.cfg.platform.defaultLocale));
        if (op === 'set-label') return p.labels.setLabel(str(i.id, 'id'), str(i.locale, 'locale'), str(i.label, 'label'), env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `localization: unknown operation ${op}`);
      },
      escalation: (op, i, env) => {
        if (op === 'escalate') return p.autonomy.escalate({ subject: str(i.subject, 'subject'), to: str(i.to, 'to'), reason: str(i.reason, 'reason') }, env.actor, env.ctx);
        throw new ConstitutionalError('Phase008-§5.2', `escalation: unknown operation ${op}`);
      },
      dunning: (op, _i, env) => {
        if (op === 'sweep') return p.commerce.sweep(env.actor);
        throw new ConstitutionalError('Phase008-§5.2', `dunning: unknown operation ${op}`);
      },
    };
  }
}
