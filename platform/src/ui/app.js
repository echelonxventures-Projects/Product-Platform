// UCOS Ω∞ explorer. A renderer over the platform API: every name, statement,
// label, facet, dimension and capability shown here is read from the registry.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let L = {};
const t = (k) => L[k] ?? k;
const token = () => { try { return localStorage.getItem('ucos.token') || ''; } catch { return ''; } };

async function api(path, body) {
  const headers = { 'content-type': 'application/json' };
  if (token()) headers.authorization = `Bearer ${token()}`;
  const res = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof data === 'string' ? data : `${data.rule ? `[${data.rule}] ` : ''}${data.message ?? res.status}`);
  return data;
}

const link = (id, text) => `<a href="#/entry/${encodeURIComponent(id)}">${esc(text ?? id)}</a>`;
const pill = (s) => `<span class="pill">${esc(s)}</span>`;
const json = (v) => `<pre>${esc(JSON.stringify(v, null, 2))}</pre>`;
const table = (rows, cols) => `<table><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</table>`;
const fail = (e) => `<div class="err">${esc(e.message)}</div>`;

const views = {
  async overview() {
    const p = await api('/api/platform');
    const kinds = Object.entries(p.counts.byKind).sort((a, b) => b[1] - a[1]);
    const statuses = Object.entries(p.counts.byStatus).sort((a, b) => b[1] - a[1]);
    const total = kinds.reduce((s, [, n]) => s + n, 0);
    return `<p class="muted">${t('overview.intro')}</p>
      <div class="grid">
        <div class="card"><h3>${esc(p.name)} ${esc(p.version)}</h3><div class="num">${total.toLocaleString()}</div><div class="muted small">registered artifacts · ${p.counts.events.toLocaleString()} audited events</div></div>
        <div class="card"><h3>Universes</h3><div class="num">${p.universes}</div><div class="muted small">${p.registries} registries</div></div>
        <div class="card"><h3>Corpus coverage</h3><div class="num">${p.coverage ? `${p.coverage.registered}/${p.coverage.total}` : '—'}</div><div class="muted small">headings registered · ${p.coverage?.unregistered ?? 0} unregistered</div></div>
        <div class="card"><h3>Autonomous governance</h3><div>${p.autonomy.governanceAgent ? link(p.autonomy.governanceAgent) : 'not operating'}</div></div>
      </div>
      <div class="two" style="margin-top:12px">
        <div class="card"><h3>${t('overview.kinds')}</h3>${table(kinds, [['kind', (r) => `<a href="#/registries?kind=${esc(r[0])}">${esc(r[0])}</a>`], ['count', (r) => r[1].toLocaleString()]])}</div>
        <div class="card"><h3>${t('overview.status')}</h3>${table(statuses, [['status', (r) => pill(r[0])], ['count', (r) => r[1].toLocaleString()]])}</div>
      </div>`;
  },

  async universes() {
    const us = await api('/api/universes');
    return table(us.sort((a, b) => b.entries - a.entries), [
      ['code', (u) => `<a href="#/universe/${esc(u.code)}"><b>${esc(u.code)}</b></a>`],
      ['name', (u) => esc(u.name)],
      ['artifacts', (u) => u.entries.toLocaleString()],
      ['depends on', (u) => esc((u.dependsOn || []).filter(Boolean).join(', '))],
      ['future', (u) => (u.futureDependencies || []).map(pill).join(' ')],
    ]);
  },

  async universe(code) {
    const u = await api(`/api/universes/${encodeURIComponent(code)}`);
    return `<h2>${esc(u.universe.definition.canonicalName)} <span class="muted">${esc(code)}</span></h2>
      <p>${esc(u.universe.definition.canonicalStatement)}</p>
      <div class="two"><div class="card"><h3>Artifacts</h3>${table(u.byKind, [['kind', (r) => `<a href="#/registries?kind=${esc(r.kind)}&namespace=${esc(code)}">${esc(r.kind)}</a>`], ['count', (r) => r.n]])}</div>
      <div class="card"><h3>${t('universe.dependsOn')}</h3>${u.dependsOn.map((d) => link(d.id, d.name)).join('<br>') || '—'}<h3 style="margin-top:12px">${t('universe.dependents')}</h3>${u.dependents.map((d) => link(d.id, d.name)).join('<br>') || '—'}<h3 style="margin-top:12px">${t('universe.future')}</h3>${(u.universe.content.futureDependencies || []).map(pill).join(' ') || '—'}</div></div>
      <div class="card" style="margin-top:12px"><h3>${t('universe.documents')}</h3>${table(u.documents, [['document', (d) => link(d.id, d.name)], ['title', (d) => esc(d.title)], ['status', (d) => pill(d.status)]])}</div>`;
  },

  async registries(_, qs) {
    const kind = qs.get('kind'); const ns = qs.get('namespace'); const reg = qs.get('registry'); const offset = Number(qs.get('offset') || 0);
    if (!kind && !reg) {
      const regs = await api('/api/registries');
      return table(regs, [['registry', (r) => `<a href="#/registries?registry=${esc(r.registryId)}">${esc(r.name)}</a><div class="muted small mono">${esc(r.registryId)}</div>`], ['kinds', (r) => esc(r.envelope.kinds.join(', '))], ['namespaces', (r) => esc(r.envelope.namespaces.join(', '))], ['mode', (r) => pill(r.admissionMode)], ['entries', (r) => r.entries.toLocaleString()]]);
    }
    const q = new URLSearchParams({ limit: '50', offset: String(offset) });
    if (kind) q.set('kind', kind); if (ns) q.set('namespace', ns); if (reg) q.set('registry', reg);
    const res = await api(`/api/entries?${q}`);
    const next = new URLSearchParams(qs); next.set('offset', String(offset + 50));
    return `<p class="muted">${res.total.toLocaleString()} entries</p>${table(res.entries, [['name', (e) => link(e.canonicalId, e.definition.canonicalName)], ['kind', (e) => esc(e.kind)], ['namespace', (e) => esc(e.classification.namespace)], ['status', (e) => pill(e.lifecycle.status)], ['statement', (e) => `<span class="small">${esc(e.definition.canonicalStatement.slice(0, 180))}</span>`]])}
      ${offset + 50 < res.total ? `<p><a href="#/registries?${next}">next →</a></p>` : ''}`;
  },

  async entry(ref) {
    const r = await api(`/api/entries/${encodeURIComponent(ref)}`);
    const e = r.entry;
    const [lin, val] = await Promise.all([api(`/api/entries/${encodeURIComponent(e.canonicalId)}/lineage`), api(`/api/entries/${encodeURIComponent(e.canonicalId)}/validation`)]);
    const rel = r.relationships;
    return `<h2>${esc(e.definition.canonicalName)} ${pill(e.kind)} ${pill(e.lifecycle.status)}</h2>
      ${r.superseded ? `<div class="banner">Superseded — resolved through ${r.supersessionChain.map((x) => link(x)).join(' → ')}</div>` : ''}
      <div class="muted mono">${esc(e.canonicalId)} ${e.identity.aliases.map(pill).join(' ')}</div>
      <div class="card" style="margin-top:10px"><h3>${t('entry.statement')}</h3><p>${esc(e.definition.canonicalStatement) || '<span class="muted">—</span>'}</p>
        <div class="small muted">registry ${link(e.registryId)} · namespace ${esc(e.classification.namespace)} · owner ${esc(e.ownership.canonicalOwner)} · ratified by ${esc(e.ownership.ratifyingBody)} · certified by ${esc(e.ownership.certifyingBody)}<br>derives from ${e.definition.derivationChain.map((d) => link(d.split(' ')[0], d)).join(', ') || '—'} · source ${esc(e.provenance.source)} ${esc(e.provenance.locator || '')}</div></div>
      <div class="two" style="margin-top:10px">
        <div class="card"><h3>${t('entry.relationships')}</h3>${table([...rel.outgoing.map((x) => ({ d: '→', type: x.type, id: x.target })), ...rel.incoming.map((x) => ({ d: '←', type: x.reading, id: x.source }))].slice(0, 300), [['', (x) => x.d], ['type', (x) => esc(x.type)], ['artifact', (x) => link(x.id)]])}</div>
        <div class="card"><h3>${t('entry.validation')}</h3>${Object.entries(val).map(([layer, v]) => `<div>${esc(layer)}: ${v.length ? `<span class="bad">${v.length}</span> ${v.map((x) => esc(`${x.rule} ${x.message}`)).join('; ')}` : '<span class="ok">holds</span>'}</div>`).join('')}
          <h3 style="margin-top:10px">Attestation</h3><div class="small mono">content ${esc(r.attestation.contentHash.slice(0, 24))}… chain ${esc(r.attestation.chainHash.slice(0, 24))}… verifiable ${r.attestation.verifiable}</div></div>
      </div>
      <div class="card" style="margin-top:10px"><h3>${t('entry.lineage')}</h3>${table(lin.versions, [['v', (v) => v.version], ['action', (v) => esc(v.action)], ['status', (v) => pill(v.status)], ['actor', (v) => link(v.actor)], ['at', (v) => esc(v.recordedAt)], ['chain', (v) => `<span class="mono small">${esc(v.chainHash.slice(0, 16))}</span>`]])}</div>
      <div class="card" style="margin-top:10px"><h3>${t('entry.content')}</h3>${json(e.content)}</div>`;
  },

  async search(q) {
    const r = await api(`/api/discovery?q=${encodeURIComponent(q)}&limit=50`);
    return `<p class="muted">${r.total} candidates for “${esc(q)}”${r.suggestions.length ? ` · more primitive alternatives: ${r.suggestions.map((s) => link(s.alias, `${s.name} (tier ${s.tier})`)).join(', ')}` : ''}</p>
      ${table(r.results, [['artifact', (x) => `${link(x.id, x.name)} ${x.flags.map(pill).join(' ')}`], ['kind', (x) => esc(x.kind)], ['namespace', (x) => esc(x.namespace)], ['status', (x) => pill(x.status)], ['score', (x) => x.score], ['statement', (x) => `<span class="small">${esc(x.statement.slice(0, 160))}</span>`]])}`;
  },

  async taxonomy(scheme, qs) {
    if (scheme) {
      const tree = await api(`/api/taxonomy/schemes/${encodeURIComponent(scheme)}/tree`);
      const render = (nodes) => `<ul>${nodes.map((n) => `<li>${link(n.id, n.label)}${n.children.length ? render(n.children) : ''}</li>`).join('')}</ul>`;
      return `<p>${link(scheme)}</p><div class="tree card">${render(tree)}</div>`;
    }
    const ns = qs.get('namespace') || 'UCOS';
    const res = await api(`/api/taxonomy/schemes?namespace=${encodeURIComponent(ns)}&limit=200`);
    return `<div class="row">namespace <input id="tns" value="${esc(ns)}"><button onclick="location.hash='#/taxonomy?namespace='+document.querySelector('#tns').value">${t('action.refresh')}</button></div>${table(res.entries, [['scheme', (s) => `<a href="#/taxonomy/${encodeURIComponent(s.canonicalId)}">${esc(s.definition.canonicalName)}</a>`], ['purpose', (s) => esc(s.content.purpose)], ['status', (s) => pill(s.lifecycle.status)]])}`;
  },

  async commerce() {
    const facets = await api('/api/commerce/facets');
    const sample = { name: 'Harbour room 12 nightly', entity: { name: 'Harbour room 12' }, facets: Object.fromEntries(facets.map((f) => [f.alias, f.domain[0]])) };
    return `<div class="card"><h3>Facets</h3>${table(facets, [['facet', (f) => `<b>${esc(f.alias)}</b> ${esc(f.name)}`], ['governed domain', (f) => f.domain.map(pill).join(' ')]])}</div>
      <div class="two" style="margin-top:12px">
        ${form('commerce.define', '/api/commerce/exchangeables', sample)}
        ${form('commerce.offer', '/api/commerce/offers', { subject: 'UCOS-ENT-PRD-0000000001', entitlementSpec: { form: 'booking', capability: 'stay', duration: { magnitude: 1, unit: 'd' } }, consideration: [{ magnitude: 120, unit: 'UNIT:EUR' }], validity: { window: { start: new Date().toISOString(), end: null } }, allocationPolicy: { mechanism: 'first-come', capacity: 10 } })}
        ${form('commerce.quote', '/api/commerce/quote', { offer: 'UCOS-OFR-OFR-0000000001', context: { Economic: { currency: 'UNIT:EUR' } } })}
        ${form('commerce.accept', '/api/commerce/accept', { offer: 'UCOS-OFR-OFR-0000000001', holder: 'operator' })}
        ${form('commerce.check', '/api/commerce/check', { holder: 'operator', capability: 'stay' })}
      </div>`;
  },

  async context() {
    const [dims, purposes] = await Promise.all([api('/api/context/dimensions'), api('/api/context/purposes')]);
    return `<div class="two"><div class="card"><h3>Dimensions</h3>${table(dims, [['dimension', (d) => link(d.id, d.name)], ['owning universe', (d) => esc(d.owningUniverse)], ['fields', (d) => Object.entries(d.valueModel).map(([k, v]) => `${esc(k)} <span class="muted small">${esc(v.mergeKind)}</span>`).join(', ')]])}</div>
      <div class="card"><h3>Purposes</h3>${table(Object.entries(purposes), [['purpose', (r) => esc(r[0])], ['relevant', (r) => esc(r[1].relevant.join(', '))], ['required', (r) => esc(r[1].required.join(', '))]])}</div></div>
      <div style="margin-top:12px">${form('context.resolve', '/api/context/resolve', { purpose: 'pricing', context: { Economic: { currency: 'UNIT:EUR' }, Spatial: { jurisdiction: 'region-1' } } })}</div>`;
  },

  async compositions(id) {
    if (id) {
      const r = await api(`/api/entries/${encodeURIComponent(id)}`);
      const c = r.entry;
      const arts = (c.content.deploymentContract?.artifacts || []);
      let app = '';
      for (const a of arts) {
        const art = await api(`/api/entries/${a}`);
        if (art.entry.content.targetSpace === 'UI') app = await renderApp(a, c);
      }
      return `<h2>${esc(c.definition.canonicalName)} ${pill(c.lifecycle.status)}</h2><p class="muted">${esc(c.content.intent)}</p>
        <div class="row"><button onclick="compOp('${c.canonicalId}','validate')">validate</button><button onclick="compOp('${c.canonicalId}','instantiate')">instantiate (generate all targets)</button><button class="ghost" onclick="compOp('${c.canonicalId}','suspend')">suspend</button><button class="ghost" onclick="compOp('${c.canonicalId}','resume')">resume</button></div><div id="compOut"></div>
        <div class="two"><div class="card"><h3>Capabilities</h3>${(c.content.capabilityNames || []).map(pill).join(' ')}<h3 style="margin-top:10px">Bindings (DAG)</h3>${table(c.content.bindings, [['from', (b) => link(b.source)], ['port', (b) => esc(`${b.sourcePort} → ${b.targetPort}`)], ['to', (b) => link(b.target)], ['failure', (b) => pill(b.failurePolicy)]])}</div>
        <div class="card"><h3>Policy envelope (strictest of parts)</h3>${json(c.content.policyEnvelope)}<h3>Artifacts</h3>${arts.map((a) => link(a)).join('<br>') || '—'}</div></div>
        ${app ? `<div class="card" style="margin-top:12px"><h3>${t('compositions.app')}</h3>${app}</div>` : ''}`;
    }
    const cs = await api('/api/compositions');
    return table(cs, [['composition', (c) => `<a href="#/compositions/${encodeURIComponent(c.canonicalId)}">${esc(c.definition.canonicalName)}</a>`], ['capabilities', (c) => (c.content.capabilityNames || []).length], ['status', (c) => pill(c.lifecycle.status)], ['intent', (c) => `<span class="small">${esc(c.content.intent)}</span>`]]) + `<div style="margin-top:12px">${form('compositions.invoke', '/api/capabilities/offer/invoke', { composition: cs[0]?.canonicalId, operation: 'quote', input: { offer: 'UCOS-OFR-OFR-0000000001' }, context: {} })}</div>`;
  },

  async generation() {
    const [targets, arts] = await Promise.all([api('/api/generation/targets'), api('/api/generation/artifacts?limit=100')]);
    return `<div class="two"><div class="card"><h3>Generators</h3>${table(targets, [['target space', (g) => link(g.generator, g.targetSpace)], ['variants', (g) => g.variants.map(pill).join(' ')], ['status', (g) => pill(g.status)]])}</div>
      ${form('generation.generate', '/api/generation/generate', { subject: 'UMQSOCR', generator: 'Knowledge Graph', variant: 'json-ld' })}</div>
      <div class="card" style="margin-top:12px"><h3>Artifacts</h3>${table(arts.entries, [['artifact', (a) => link(a.canonicalId, a.definition.canonicalName)], ['status', (a) => pill(a.lifecycle.status)], ['files', (a) => (a.content.files || []).map((f) => `<a target="_blank" href="/api/generation/artifacts/${a.canonicalId}/files/${encodeURIComponent(f.path)}">${esc(f.path)}</a>`).join('<br>')], ['verify', (a) => `<button class="ghost" onclick="verifyArt('${a.canonicalId}')">verify</button>`]])}</div><div id="genOut"></div>`;
  },

  async intelligence() {
    const caps = await api('/api/intelligence/capabilities');
    return `<div class="card"><h3>Engines</h3>${table(caps, [['engine', (c) => link(c.canonicalId, c.definition.canonicalName)], ['declared autonomy', (c) => pill(c.content.autonomyLevel)], ['envelope owner', (c) => esc(c.content.policyEnvelope.owner)], ['alignment', (c) => (c.content.alignmentEvidence ? '<span class="ok">recorded</span>' : '<span class="muted">none</span>')]])}</div>
      <div class="two" style="margin-top:12px">
        ${form('intelligence.infer', '/api/intelligence/infer', { types: ['NARROWER-THAN', 'DISJOINT-WITH'], maxDepth: 3, limit: 50 })}
        ${form('intelligence.optimize', '/api/intelligence/optimize', { model: 'model-id', objective: 'objective-id' })}
      </div><div class="card" style="margin-top:12px"><h3>${t('intelligence.contradictions')}</h3><button onclick="show('contra','/api/intelligence/contradictions')">${t('action.run')}</button><div id="contra"></div></div>`;
  },

  async validation() {
    const [a, alg] = await Promise.all([api('/api/validation/audit'), api('/api/context/algebra')]);
    return `<div class="card"><h3>${t('validation.invariants')} — ${a.holds ? '<span class="ok">all hold</span>' : '<span class="bad">violations</span>'}</h3>
      ${table(a.invariants, [['id', (i) => link(i.id)], ['invariant', (i) => esc(i.name)], ['statement', (i) => `<span class="small">${esc(i.statement)}</span>`], ['checked', (i) => i.checked.toLocaleString()], ['status', (i) => `<span class="${i.status === 'HOLDS' ? 'ok' : 'bad'}">${i.status}</span>${i.violations.length ? `<div class="small">${i.violations.slice(0, 5).map((v) => esc(`${v.subject ?? ''} ${v.message}`)).join('<br>')}</div>` : ''}`]])}
      <p class="muted small">Integrity: ${a.integrity.ok ? 'hash chains intact' : 'BROKEN'} — ${a.integrity.versions.toLocaleString()} versions, ${a.integrity.events.toLocaleString()} events.</p></div>
      <div class="card" style="margin-top:12px"><h3>${t('validation.algebra')}</h3>${json(alg)}</div>`;
  },

  async coverage() {
    const [c, f] = await Promise.all([api('/api/coverage'), api('/api/findings?limit=500')]);
    return `<div class="card"><h3>Coverage</h3>${json(c.summary)}${table(c.bySource, [['source', (r) => esc(r.source)], ['status', (r) => pill(r.status)], ['headings', (r) => r.n]])}</div>
      <div class="card" style="margin-top:12px"><h3>${t('coverage.findings')}</h3>${table(f, [['severity', (x) => `<span class="${x.severity === 'warning' ? 'warn' : x.severity === 'refusal' ? 'bad' : 'muted'}">${esc(x.severity)}</span>`], ['rule', (x) => link(x.rule)], ['where', (x) => esc(`${x.source}:${x.line}`)], ['subject', (x) => esc(x.subject)], ['finding', (x) => `<span class="small">${esc(x.message)}</span>`]])}</div>`;
  },

  async events() {
    const ev = await api('/api/events?limit=100');
    setTimeout(() => {
      const box = $('#live'); if (!box) return;
      const es = new EventSource('/api/events/stream');
      es.addEventListener('platform', (m) => { const e = JSON.parse(m.data); box.insertAdjacentHTML('afterbegin', `<div class="small mono">${esc(e.occurredAt)} ${esc(e.type)} ${esc(e.subject ?? '')} ${e.canonical ? '' : '[non-canonical]'}</div>`); });
      window.addEventListener('hashchange', () => es.close(), { once: true });
    });
    return `<div class="card"><h3>${t('events.live')}</h3><div id="live"></div></div><div class="card" style="margin-top:12px">${table(ev, [['seq', (e) => e.seq], ['type', (e) => esc(e.type)], ['subject', (e) => (e.subject ? link(e.subject) : '')], ['actor', (e) => link(e.actor)], ['authority', (e) => esc(e.authority)], ['reality', (e) => pill(e.reality)], ['at', (e) => esc(e.occurredAt)]])}</div>`;
  },
};

function form(labelKey, path, sample) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  return `<div class="card"><h3>${t(labelKey)}</h3><div class="muted small mono">POST ${esc(path)}</div><textarea id="${id}">${esc(JSON.stringify(sample, null, 2))}</textarea><div class="row"><button onclick="post('${id}','${path}')">${t('action.run')}</button></div><div id="${id}o"></div></div>`;
}

window.post = async (id, path) => {
  const out = $(`#${id}o`);
  try { out.innerHTML = json(await api(path, JSON.parse($(`#${id}`).value))); } catch (e) { out.innerHTML = fail(e); }
};
window.show = async (id, path) => { try { $(`#${id}`).innerHTML = json(await api(path)); } catch (e) { $(`#${id}`).innerHTML = fail(e); } };
window.compOp = async (id, op) => { try { $('#compOut').innerHTML = json(await api(`/api/compositions/${id}/${op}`, {})); setTimeout(route, 600); } catch (e) { $('#compOut').innerHTML = fail(e); } };
window.verifyArt = async (id) => { try { $('#genOut').innerHTML = json(await api(`/api/generation/artifacts/${id}/verify`, {})); } catch (e) { $('#genOut').innerHTML = fail(e); } };

/** Renders a generated UI definition (Phase 009 §6.4) as a working application. */
async function renderApp(artifactId, comp) {
  let def;
  try { def = await api(`/api/generation/artifacts/${artifactId}/files/ui.definition.json`); } catch (e) { return fail(e); }
  if (typeof def === 'string') def = JSON.parse(def);
  const actions = def.actions.map((a, i) => {
    const sample = Object.fromEntries(a.inputs.map((x) => [x.name, '']));
    return `<details><summary>${esc(a.label)} <span class="muted small">${esc(a.purpose)}</span></summary><textarea id="app${i}">${esc(JSON.stringify({ operation: a.operation, input: sample, context: {} }, null, 2))}</textarea><button onclick="appInvoke(${i},'${esc(a.capability)}','${comp.canonicalId}')">${esc(a.operation)}</button><div id="app${i}o"></div></details>`;
  }).join('');
  return `${def.banner ? `<div class="banner">${esc(def.banner)}</div>` : ''}<div class="muted small">${def.affordances.permitted} permitted affordances generated for ${esc(def.generatedFor)} — ${esc(def.affordances.note)}</div>${actions}`;
}
window.appInvoke = async (i, capability, composition) => {
  const out = $(`#app${i}o`);
  try { const body = JSON.parse($(`#app${i}`).value); out.innerHTML = json(await api(`/api/capabilities/${capability}/invoke`, { ...body, composition })); } catch (e) { out.innerHTML = fail(e); }
};

const NAV = ['overview', 'universes', 'registries', 'taxonomy', 'commerce', 'context', 'compositions', 'generation', 'intelligence', 'validation', 'coverage', 'events'];

async function route() {
  const [path, query] = (location.hash.slice(1) || '/overview').split('?');
  const [, name, ...rest] = path.split('/');
  const qs = new URLSearchParams(query || '');
  $('#nav').innerHTML = NAV.map((n) => `<a href="#/${n}" class="${n === name ? 'on' : ''}">${t(`nav.${n}`)}</a>`).join('');
  const view = $('#view');
  view.innerHTML = '<p class="muted">…</p>';
  try {
    const fn = views[name] ?? views.overview;
    view.innerHTML = await fn(decodeURIComponent(rest.join('/')), qs);
  } catch (e) { view.innerHTML = fail(e); }
}

async function init() {
  L = await (await fetch('/labels.en.json')).json();
  document.querySelectorAll('[data-label]').forEach((el) => (el.textContent = t(el.dataset.label)));
  document.title = t('app.title');
  $('#search').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/search/${encodeURIComponent($('#q').value)}`; });
  $('#token').addEventListener('click', () => $('#dlg').showModal());
  $('#saveTok').addEventListener('click', () => { try { localStorage.setItem('ucos.token', $('#tok').value.trim()); } catch {} whoami(); route(); });
  window.addEventListener('hashchange', route);
  await whoami();
  route();
}
async function whoami() { try { const me = await api('/api/me'); $('#who').textContent = me.actor ? `${me.principal.name} · ${me.actor.authority}` : t('anonymous'); } catch { $('#who').textContent = t('anonymous'); } }
init();
