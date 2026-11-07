/**
 * Every refusal in the platform names the constitutional rule it enforces.
 * A refusal without a rule reference would be an unexplainable decision
 * (UCI-006, UCI-011).
 */
export class ConstitutionalError extends Error {
  readonly rule: string;
  readonly details: unknown;
  readonly status: number;

  constructor(rule: string, message: string, details?: unknown, status = 422) {
    super(`[${rule}] ${message}`);
    this.name = 'ConstitutionalError';
    this.rule = rule;
    this.details = details;
    this.status = status;
  }

  toJSON(): Record<string, unknown> {
    return { error: this.name, rule: this.rule, message: this.message, details: this.details ?? null };
  }
}

export class NotFoundError extends ConstitutionalError {
  constructor(what: string, ref: string) {
    super('D-FR-02', `${what} not resolvable: ${ref}`, { ref }, 404);
    this.name = 'NotFoundError';
  }
}

export class AuthorizationError extends ConstitutionalError {
  constructor(rule: string, message: string, details?: unknown) {
    super(rule, message, details, 403);
    this.name = 'AuthorizationError';
  }
}

export interface Violation {
  rule: string;
  message: string;
  subject?: string;
  details?: unknown;
}

export function refuseIf(violations: Violation[], summaryRule: string, summary: string): void {
  if (violations.length > 0) {
    throw new ConstitutionalError(violations[0].rule ?? summaryRule, `${summary}: ${violations.map((v) => `${v.rule} ${v.message}`).join('; ')}`, violations);
  }
}
