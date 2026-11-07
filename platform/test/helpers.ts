import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Platform } from '../src/platform.ts';
import { Bootstrap } from '../src/constitution/bootstrap.ts';
import { PLATFORM_ROOT } from '../src/kernel/config.ts';

let shared: Platform | null = null;

/** A bootstrapped platform in an isolated temporary directory (shared per test process). */
export function platform(): Platform {
  if (shared) return shared;
  const dir = mkdtempSync(join(tmpdir(), 'ucos-test-'));
  const cfg = JSON.parse(readFileSync(join(PLATFORM_ROOT, 'config/platform.config.json'), 'utf8'));
  const abs = (p: string) => join(PLATFORM_ROOT, p);
  cfg.paths = { ...cfg.paths, constitutionRoot: abs(cfg.paths.constitutionRoot), seedRegistries: abs(cfg.paths.seedRegistries), masterIndex: abs(cfg.paths.masterIndex), platformMetadata: abs(cfg.paths.platformMetadata), uiRoot: abs(cfg.paths.uiRoot), database: join(dir, 'ucos.db'), credentials: join(dir, 'credentials.json'), generatedOutput: join(dir, 'generated') };
  cfg.corpus = cfg.corpus.map((c: { path: string }) => ({ ...c, path: abs(c.path) }));
  cfg.corpusInterpretation = abs(cfg.corpusInterpretation);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  shared = new Platform({ config: join(dir, 'config.json') });
  new Bootstrap(shared).run();
  return shared;
}

export function actor(p: Platform, alias: string, authority?: string) {
  return p.governance.actor(alias, authority);
}
