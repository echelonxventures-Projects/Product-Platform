/**
 * The shared spine (Phase 003 §B, Phase 004 §5.1). Every entry in every
 * registry carries exactly these fields; kind-specific structure lives in
 * `content`, typed by reference to registered constructs.
 */
export type DependencyType = 'CONSTITUTIVE' | 'SEMANTIC' | 'FUNCTIONAL' | 'CONTRACTUAL' | 'OPTIONAL' | 'FUTURE';

export interface Dependency {
  target: string;
  type: DependencyType;
  note?: string;
}

export interface GovernanceRecord {
  canonicalOwner: string;
  ratifyingBody: string;
  certifyingBody: string;
  changePolicy?: string;
  amendmentQuorum?: number;
  disputeAuthority?: string;
}

export interface Evidence {
  validation?: { at: string; passed: boolean; rules: string[]; violations: { rule: string; message: string }[] };
  proposal?: { at: string; by: string };
  ratification?: { at: string; body: string; approvals: { principal: string; at: string }[]; quorum: number };
  certification?: { at: string; body: string; certifier: string; certificationClass: string; scope: string; evidenceHash: string };
  revocation?: { at: string; by: string; cause: string };
  [key: string]: unknown;
}

export interface Provenance {
  source: string;
  locator?: string;
  recordedBy: string;
  recordedAt?: string;
}

export interface Entry {
  canonicalId: string;
  registryId: string;
  kind: string;
  version?: number;
  identity: { canonicalId: string; aliases: string[]; externalIds: string[] };
  definition: { canonicalName: string; canonicalStatement: string; derivationChain: string[] };
  classification: { tier: number | null; layer: string; namespace: string; taxonomyPaths: string[] };
  ownership: GovernanceRecord;
  lifecycle: { status: string; lifecycleRef: string };
  dependencies: Dependency[];
  securityPosture: { level: string; accessPolicy?: string };
  evidence: Evidence;
  descriptors: string[];
  labels: Record<string, string>;
  provenance: Provenance;
  content: Record<string, unknown>;
  supersedes?: string;
  supersededBy?: string;
  successor?: string;
}

/** What a caller submits. Identity, ownership and lifecycle are assigned by the fabric. */
export interface Candidate {
  kind: string;
  namespace?: string;
  canonicalId?: string;
  name: string;
  statement: string;
  aliases?: string[];
  externalIds?: string[];
  derivationChain?: string[];
  tier?: number | null;
  layer?: string;
  taxonomyPaths?: string[];
  dependencies?: Dependency[];
  securityLevel?: string;
  accessPolicy?: string;
  descriptors?: string[];
  labels?: Record<string, string>;
  provenance?: Partial<Provenance>;
  content?: Record<string, unknown>;
  ownerOverride?: string;
  /** Relationships to assert once the entry exists. */
  relationships?: { type: string; target: string; context?: Record<string, unknown> }[];
}

export interface RegistryDefinition {
  registryId: string;
  name: string;
  owner: string;
  envelope: { kinds: string[]; namespaces: string[] };
  entryModel: string;
  lifecycleRef: string;
  admissionMode: 'constitutional' | 'operational';
  relationshipPolicy: string[];
  identity: { layer: string; type: string };
  identityByKind?: Record<string, { layer: string; type: string }>;
  /** The Tier-1 construct this registry's entries instantiate (derivation anchor). */
  construct: string | null;
  tier: number;
  securityDefault: string;
  status: string;
}

export interface ResolveResult {
  entry: Entry;
  resolvedFrom: string;
  via: 'canonical' | 'alias' | 'external' | 'qualified-name';
  superseded: boolean;
  supersessionChain: string[];
  deprecated: boolean;
}

export interface RelationshipInstance {
  id: string;
  type: string;
  source: string;
  target: string;
  context: Record<string, unknown>;
  status: string;
  assertedBy: string;
  assertedAt: string;
  confidence: number;
  evidence?: unknown;
}

export interface RelationshipType {
  type: string;
  inverse: string;
  transitive: boolean;
  acyclic: boolean;
  specialises: string | null;
  notes: string;
}
