import { Platform } from './platform.ts';
import { Bootstrap } from './constitution/bootstrap.ts';
import { CorpusParser, type Interpretation } from './corpus/parser.ts';
import { CorpusIngestor } from './corpus/ingest.ts';
import { readJson } from './kernel/config.ts';

const log = (m: string) => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);

function open(): Platform {
  return new Platform();
}

function bootstrap(p: Platform): void {
  if (p.isBootstrapped()) {
    log('already bootstrapped');
    return;
  }
  const t = Date.now();
  const counts = new Bootstrap(p, log).run();
  log(`bootstrap complete in ${((Date.now() - t) / 1000).toFixed(1)}s: ${JSON.stringify(counts)}`);
}

function ingest(p: Platform): void {
  if (p.store.getMeta('corpusIngested')) {
    log('corpus already ingested');
    return;
  }
  const t = Date.now();
  const parser = new CorpusParser(readJson<Interpretation>(p.cfg.corpusInterpretation));
  const parsed = parser.parseAll(p.cfg.corpus);
  log(`parsed ${parsed.length} sources, ${parsed.reduce((n, s) => n + s.documents.length, 0)} documents, ${parsed.reduce((n, s) => n + s.headings.length, 0)} headings`);
  const ingestor = new CorpusIngestor(p, readJson<Interpretation>(p.cfg.corpusInterpretation));
  const result = ingestor.ingest(parsed, p.governance.pipelineRoles(), log);
  p.store.setMeta('corpusIngested', p.clock.now());
  p.hydrate();
  const bySeverity: Record<string, number> = {};
  for (const f of result.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  log(`ingested in ${((Date.now() - t) / 1000).toFixed(1)}s: ${JSON.stringify(result.stats)}`);
  log(`findings: ${JSON.stringify(bySeverity)}; coverage: ${JSON.stringify(p.coverageSummary())}`);
}

async function main(): Promise<void> {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'bootstrap': {
      const p = open();
      bootstrap(p);
      p.close();
      break;
    }
    case 'ingest': {
      const p = open();
      ingest(p);
      p.close();
      break;
    }
    case 'validate': {
      const p = open();
      const t = Date.now();
      const report = p.validation.audit({ deep: !args.includes('--shallow') });
      for (const inv of report.invariants) log(`${inv.status === 'HOLDS' ? 'HOLDS   ' : 'VIOLATED'} ${inv.id} ${inv.name} (${inv.checked} checked${inv.violations.length ? `, ${inv.violations.length} violations: ${inv.violations.slice(0, 3).map((v) => `${v.subject ?? ''} ${v.message}`).join(' | ')}` : ''})`);
      log(`integrity: ${report.integrity.ok ? 'intact' : 'BROKEN'} (${report.integrity.versions} versions, ${report.integrity.events} events) — audit ${((Date.now() - t) / 1000).toFixed(1)}s`);
      const algebra = p.context.proveAlgebra(p.cfg.validation.contextMergePropertyTrials, p.cfg.validation.randomSeed);
      log(`context algebra (X-CX-03): deterministic=${algebra.deterministic} commutative=${algebra.commutative} associative=${algebra.associative} over ${algebra.trials} trials`);
      p.close();
      process.exitCode = report.holds && algebra.commutative && algebra.associative ? 0 : 1;
      break;
    }
    case 'coverage': {
      const p = open();
      log(JSON.stringify(p.coverageSummary()));
      const rows = p.store.db.prepare("SELECT source, line, text, note FROM corpus_coverage WHERE status = 'refused' LIMIT 50").all();
      for (const r of rows as { source: string; line: number; text: string; note: string }[]) log(`UNREGISTERED ${r.source}:${r.line} ${r.text} — ${r.note}`);
      const findings = p.store.db.prepare("SELECT severity, rule, COUNT(*) n FROM corpus_findings GROUP BY severity, rule ORDER BY n DESC").all();
      for (const f of findings as { severity: string; rule: string; n: number }[]) log(`finding ${f.severity} ${f.rule}: ${f.n}`);
      p.close();
      break;
    }
    case 'generate': {
      const p = open();
      const [subject, generator, variant] = args;
      const a = p.generation.generate({ subject, generator, variant }, p.governance.pipelineRoles().ratifiers[0]);
      log(`generated ${a.canonicalId}: ${JSON.stringify(a.content.files)}`);
      p.close();
      break;
    }
    case 'serve': {
      const { serve } = await import('./api/server.ts');
      const p = open();
      if (!p.isBootstrapped()) bootstrap(p);
      await serve(p, log);
      break;
    }
    case 'all': {
      const p = open();
      bootstrap(p);
      ingest(p);
      p.close();
      break;
    }
    default:
      process.stdout.write('usage: node src/cli.ts <bootstrap | ingest | all | validate [--shallow] | coverage | generate <subject> <generator> [variant] | serve>\n');
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
