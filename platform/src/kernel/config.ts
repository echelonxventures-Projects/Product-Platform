import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CorpusSource {
  id: string;
  path: string;
  title: string;
  kind?: 'file' | 'directory';
  include?: string;
}

export interface PlatformConfig {
  platform: { name: string; version: string; defaultLocale: string };
  paths: {
    constitutionRoot: string;
    seedRegistries: string;
    masterIndex: string;
    platformMetadata: string;
    database: string;
    credentials: string;
    generatedOutput: string;
    uiRoot: string;
  };
  corpus: CorpusSource[];
  corpusInterpretation: string;
  server: { host: string; port: number; maxBodyBytes: number; eventStreamHeartbeatMs: number };
  identity: { prefix: string; sequenceWidth: number; separator: string };
  security: { tokenBytes: number; tokenHashAlgorithm: string; contentHashAlgorithm: string; tokenEnvPrefix: string };
  discovery: { defaultLimit: number; maxLimit: number };
  generation: { regenerationPolicy: 'automatic' | 'approval-gated' };
  validation: { contextMergePropertyTrials: number; randomSeed: number };
}

export const PLATFORM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Resolves a configured path relative to the platform root. */
export function platformPath(p: string): string {
  return isAbsolute(p) ? p : resolve(PLATFORM_ROOT, p);
}

let cached: PlatformConfig | undefined;

/**
 * Loads the platform configuration. The file location may be overridden with
 * UCOS_CONFIG; individual values may be overridden with UCOS_<SECTION>_<KEY>
 * environment variables (deployment contract, GN-S-03).
 */
export function loadConfig(override?: string): PlatformConfig {
  if (cached && !override) return cached;
  const file = platformPath(override ?? process.env.UCOS_CONFIG ?? 'config/platform.config.json');
  if (!existsSync(file)) throw new Error(`Platform configuration not found: ${file}`);
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as PlatformConfig;
  applyEnvOverrides(cfg as unknown as Record<string, unknown>);
  if (!override) cached = cfg;
  return cfg;
}

function applyEnvOverrides(cfg: Record<string, unknown>): void {
  for (const [section, value] of Object.entries(cfg)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const envName = `UCOS_${section}_${key}`.toUpperCase();
      const raw = process.env[envName];
      if (raw === undefined) continue;
      const target = value as Record<string, unknown>;
      const current = target[key];
      target[key] = typeof current === 'number' ? Number(raw) : typeof current === 'boolean' ? raw === 'true' : raw;
    }
  }
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(platformPath(path), 'utf8')) as T;
}
