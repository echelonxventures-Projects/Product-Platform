import { ConstitutionalError } from '../kernel/errors.ts';

/**
 * The Rule construct's expression language (C-15). Admission rules, lifecycle
 * guards, policy antecedents and composition context conditions are all
 * registered text in this language — never compiled code — so every rule is
 * data that can be governed, versioned and certified.
 *
 *   expr   := or
 *   or     := and (OR and)*
 *   and    := not (AND not)*
 *   not    := NOT not | cmp
 *   cmp    := add ((= | != | < | <= | > | >= | IN | NOT IN | CONTAINS | MATCHES) add)?
 *   add    := mul ((+ | -) mul)*
 *   mul    := unary ((* | / | %) unary)*
 *   unary  := - unary | primary
 *   primary:= number | 'string' | "string" | TRUE | FALSE | NULL | [list]
 *           | (expr) | path | name(args)
 *
 * A bare identifier resolves against the evaluation scope; if the scope has
 * no binding for it, it denotes the symbol itself. This is what lets the
 * registered admission rule `F2=durable AND F7=ownership` be read verbatim.
 */

export type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'path'; parts: string[] }
  | { t: 'list'; items: Node[] }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node };

interface Token {
  k: 'num' | 'str' | 'id' | 'op' | 'punc' | 'eof';
  v: string;
  pos: number;
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'CONTAINS', 'MATCHES', 'TRUE', 'FALSE', 'NULL']);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      out.push({ k: 'num', v: src.slice(i, j).replace(/_/g, ''), pos: i });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (src[j] !== c) throw new ConstitutionalError('V-RU-01', `unterminated string at ${i}`);
      out.push({ k: 'str', v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      let j = i;
      while (j < src.length && (/[\p{L}\p{N}_$]/u.test(src[j]) || (src[j] === '-' && /[\p{L}]/u.test(src[j + 1] ?? '') && /[\p{L}\p{N}]/u.test(src[j - 1] ?? '')))) j++;
      out.push({ k: 'id', v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['!=', '<>', '<=', '>=', '==', '&&', '||'].includes(two)) {
      out.push({ k: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if ('=<>+-*/%!≠≤≥∧∨¬'.includes(c)) {
      out.push({ k: 'op', v: c, pos: i });
      i++;
      continue;
    }
    if ('()[],.'.includes(c)) {
      out.push({ k: 'punc', v: c, pos: i });
      i++;
      continue;
    }
    throw new ConstitutionalError('V-RU-01', `unexpected character "${c}" at ${i}`);
  }
  out.push({ k: 'eof', v: '', pos: src.length });
  return out;
}

class Parser {
  private i = 0;
  private readonly toks: Token[];
  constructor(toks: Token[]) {
    this.toks = toks;
  }
  private peek(): Token {
    return this.toks[this.i];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v.toUpperCase() === v;
  }
  private isOp(...vs: string[]): boolean {
    const t = this.peek();
    return t.k === 'op' && vs.includes(t.v);
  }
  private expectPunc(v: string): void {
    const t = this.next();
    if (t.k !== 'punc' || t.v !== v) throw new ConstitutionalError('V-RU-01', `expected "${v}" at ${t.pos}`);
  }

  parse(): Node {
    const n = this.or();
    if (this.peek().k !== 'eof') throw new ConstitutionalError('V-RU-01', `unexpected "${this.peek().v}" at ${this.peek().pos}`);
    return n;
  }
  private or(): Node {
    let a = this.and();
    while (this.isKw('OR') || this.isOp('||', '∨')) {
      this.next();
      a = { t: 'bin', op: 'OR', a, b: this.and() };
    }
    return a;
  }
  private and(): Node {
    let a = this.not();
    while (this.isKw('AND') || this.isOp('&&', '∧')) {
      this.next();
      a = { t: 'bin', op: 'AND', a, b: this.not() };
    }
    return a;
  }
  private not(): Node {
    if ((this.isKw('NOT') && !this.lookaheadIsIn()) || this.isOp('!', '¬')) {
      this.next();
      return { t: 'un', op: 'NOT', a: this.not() };
    }
    return this.cmp();
  }
  private lookaheadIsIn(): boolean {
    const n = this.toks[this.i + 1];
    return n?.k === 'id' && n.v.toUpperCase() === 'IN';
  }
  private cmp(): Node {
    const a = this.add();
    const t = this.peek();
    let op: string | null = null;
    if (t.k === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>=', '≠', '≤', '≥'].includes(t.v)) {
      this.next();
      op = { '==': '=', '<>': '!=', '≠': '!=', '≤': '<=', '≥': '>=' }[t.v] ?? t.v;
    } else if (this.isKw('IN')) {
      this.next();
      op = 'IN';
    } else if (this.isKw('NOT') && this.lookaheadIsIn()) {
      this.next();
      this.next();
      op = 'NOT IN';
    } else if (this.isKw('CONTAINS')) {
      this.next();
      op = 'CONTAINS';
    } else if (this.isKw('MATCHES')) {
      this.next();
      op = 'MATCHES';
    }
    if (!op) return a;
    return { t: 'bin', op, a, b: this.add() };
  }
  private add(): Node {
    let a = this.mul();
    while (this.isOp('+', '-')) {
      const op = this.next().v;
      a = { t: 'bin', op, a, b: this.mul() };
    }
    return a;
  }
  private mul(): Node {
    let a = this.unary();
    while (this.isOp('*', '/', '%')) {
      const op = this.next().v;
      a = { t: 'bin', op, a, b: this.unary() };
    }
    return a;
  }
  private unary(): Node {
    if (this.isOp('-')) {
      this.next();
      return { t: 'un', op: 'NEG', a: this.unary() };
    }
    return this.primary();
  }
  private primary(): Node {
    const t = this.next();
    if (t.k === 'num') return { t: 'lit', v: Number(t.v) };
    if (t.k === 'str') return { t: 'lit', v: t.v };
    if (t.k === 'punc' && t.v === '(') {
      const e = this.or();
      this.expectPunc(')');
      return e;
    }
    if (t.k === 'punc' && t.v === '[') {
      const items: Node[] = [];
      if (!(this.peek().k === 'punc' && this.peek().v === ']')) {
        items.push(this.or());
        while (this.peek().k === 'punc' && this.peek().v === ',') {
          this.next();
          items.push(this.or());
        }
      }
      this.expectPunc(']');
      return { t: 'list', items };
    }
    if (t.k === 'id') {
      const upper = t.v.toUpperCase();
      if (upper === 'TRUE') return { t: 'lit', v: true };
      if (upper === 'FALSE') return { t: 'lit', v: false };
      if (upper === 'NULL') return { t: 'lit', v: null };
      if (KEYWORDS.has(upper)) throw new ConstitutionalError('V-RU-01', `unexpected keyword ${t.v} at ${t.pos}`);
      if (this.peek().k === 'punc' && this.peek().v === '(') {
        this.next();
        const args: Node[] = [];
        if (!(this.peek().k === 'punc' && this.peek().v === ')')) {
          args.push(this.or());
          while (this.peek().k === 'punc' && this.peek().v === ',') {
            this.next();
            args.push(this.or());
          }
        }
        this.expectPunc(')');
        return { t: 'call', name: t.v, args };
      }
      const parts = [t.v];
      while (this.peek().k === 'punc' && this.peek().v === '.') {
        this.next();
        const p = this.next();
        if (p.k !== 'id' && p.k !== 'num') throw new ConstitutionalError('V-RU-01', `bad path segment at ${p.pos}`);
        parts.push(p.v);
      }
      return { t: 'path', parts };
    }
    throw new ConstitutionalError('V-RU-01', `unexpected "${t.v}" at ${t.pos}`);
  }
}

const cache = new Map<string, Node>();

export function parseExpression(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = new Parser(tokenize(src)).parse();
    if (cache.size > 10_000) cache.clear();
    cache.set(src, n);
  }
  return n;
}

export type ExprFunction = (args: unknown[], env: EvalEnv) => unknown;

export interface EvalEnv {
  scope: Record<string, unknown>;
  functions?: Record<string, ExprFunction>;
  /** When true, an unbound identifier is an error rather than a symbol. */
  strict?: boolean;
}

function resolvePath(scope: Record<string, unknown>, parts: string[]): { found: boolean; value: unknown } {
  let cur: unknown = scope;
  for (let idx = 0; idx < parts.length; idx++) {
    const p = parts[idx];
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false, value: undefined };
    const obj = cur as Record<string, unknown>;
    if (!(p in obj)) {
      const key = Object.keys(obj).find((k) => k.toLowerCase() === p.toLowerCase());
      if (key === undefined) return { found: false, value: undefined };
      cur = obj[key];
    } else cur = obj[p];
  }
  return { found: true, value: cur };
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((x) => eq(x, b));
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function cmpNum(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string' && isNaN(Number(a))) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
    return a.localeCompare(b);
  }
  return Number(a) - Number(b);
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && v !== false && v !== 0 && v !== '';
}

export function evaluateNode(n: Node, env: EvalEnv): unknown {
  switch (n.t) {
    case 'lit':
      return n.v;
    case 'list':
      return n.items.map((x) => evaluateNode(x, env));
    case 'path': {
      const r = resolvePath(env.scope, n.parts);
      if (r.found) return r.value;
      if (env.strict) throw new ConstitutionalError('V-RU-01', `unbound identifier ${n.parts.join('.')}`);
      return n.parts.length === 1 ? n.parts[0] : undefined;
    }
    case 'call': {
      const fn = env.functions?.[n.name] ?? BUILTINS[n.name];
      if (!fn) throw new ConstitutionalError('V-RU-01', `unregistered function ${n.name}()`);
      return fn(
        n.args.map((a) => evaluateNode(a, env)),
        env,
      );
    }
    case 'un': {
      const v = evaluateNode(n.a, env);
      return n.op === 'NOT' ? !truthy(v) : -Number(v);
    }
    case 'bin': {
      if (n.op === 'AND') return truthy(evaluateNode(n.a, env)) && truthy(evaluateNode(n.b, env));
      if (n.op === 'OR') return truthy(evaluateNode(n.a, env)) || truthy(evaluateNode(n.b, env));
      const a = evaluateNode(n.a, env);
      const b = evaluateNode(n.b, env);
      switch (n.op) {
        case '=':
          return a !== undefined && eq(a, b);
        case '!=':
          // An unknown value satisfies no comparison — admission is never granted on absence.
          return a !== undefined && !eq(a, b);
        case '<':
          return a !== undefined && cmpNum(a, b) < 0;
        case '<=':
          return a !== undefined && cmpNum(a, b) <= 0;
        case '>':
          return a !== undefined && cmpNum(a, b) > 0;
        case '>=':
          return a !== undefined && cmpNum(a, b) >= 0;
        case 'IN':
          return Array.isArray(b) ? b.some((x) => eq(a, x)) : eq(a, b);
        case 'NOT IN':
          return Array.isArray(b) ? !b.some((x) => eq(a, x)) : !eq(a, b);
        case 'CONTAINS':
          if (Array.isArray(a)) return a.some((x) => eq(x, b));
          return typeof a === 'string' && typeof b === 'string' && a.toLowerCase().includes(b.toLowerCase());
        case 'MATCHES':
          return typeof a === 'string' && new RegExp(String(b), 'i').test(a);
        case '+':
          return typeof a === 'string' || typeof b === 'string' ? String(a ?? '') + String(b ?? '') : Number(a) + Number(b);
        case '-':
          return Number(a) - Number(b);
        case '*':
          return Number(a) * Number(b);
        case '/':
          return Number(b) === 0 ? null : Number(a) / Number(b);
        case '%':
          return Number(a) % Number(b);
      }
    }
  }
  throw new ConstitutionalError('V-RU-01', 'unevaluable expression node');
}

export function evaluate(src: string, env: EvalEnv): unknown {
  return evaluateNode(parseExpression(src), env);
}

export function evaluateBoolean(src: string, env: EvalEnv): boolean {
  return truthy(evaluate(src, env));
}

/** Validates that the text is a well-formed expression (V-RU-01). */
export function isExpression(src: string): { ok: true } | { ok: false; error: string } {
  try {
    parseExpression(src);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Collects every identifier path referenced by an expression (V-TX-02, V-AT-03). */
export function referencedPaths(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    if (n.t === 'path') out.add(n.parts.join('.'));
    else if (n.t === 'list') n.items.forEach(walk);
    else if (n.t === 'call') n.args.forEach(walk);
    else if (n.t === 'un') walk(n.a);
    else if (n.t === 'bin') {
      walk(n.a);
      // Right-hand bare identifiers of comparisons are symbols, not references.
      if (!(['=', '!=', 'IN', 'NOT IN'].includes(n.op) && n.b.t === 'path' && n.b.parts.length === 1)) walk(n.b);
    }
  };
  walk(parseExpression(src));
  return [...out];
}

const BUILTINS: Record<string, ExprFunction> = {
  count: ([x]) => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : x === undefined || x === null ? 0 : 1),
  exists: ([x]) => x !== undefined && x !== null && !(Array.isArray(x) && x.length === 0),
  empty: ([x]) => x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0),
  lower: ([x]) => String(x ?? '').toLowerCase(),
  upper: ([x]) => String(x ?? '').toUpperCase(),
  abs: ([x]) => Math.abs(Number(x)),
  min: (args) => Math.min(...(Array.isArray(args[0]) ? (args[0] as number[]) : (args as number[])).map(Number)),
  max: (args) => Math.max(...(Array.isArray(args[0]) ? (args[0] as number[]) : (args as number[])).map(Number)),
  sum: ([x]) => (Array.isArray(x) ? x.reduce((s: number, v) => s + Number(v), 0) : Number(x)),
  round: ([x, d]) => {
    const f = 10 ** Number(d ?? 0);
    return Math.round(Number(x) * f) / f;
  },
  startsWith: ([s, p]) => String(s ?? '').toLowerCase().startsWith(String(p ?? '').toLowerCase()),
  endsWith: ([s, p]) => String(s ?? '').toLowerCase().endsWith(String(p ?? '').toLowerCase()),
  coalesce: (args) => args.find((a) => a !== undefined && a !== null) ?? null,
  within: ([t, start, end]) => {
    const x = Date.parse(String(t));
    return Date.parse(String(start)) <= x && (end === null || end === undefined || x < Date.parse(String(end)));
  },
  before: ([a, b]) => Date.parse(String(a)) < Date.parse(String(b)),
  after: ([a, b]) => Date.parse(String(a)) > Date.parse(String(b)),
  hour: ([t]) => new Date(String(t)).getUTCHours(),
  weekday: ([t]) => new Date(String(t)).getUTCDay(),
  month: ([t]) => new Date(String(t)).getUTCMonth() + 1,
  intersects: ([a, b]) => Array.isArray(a) && Array.isArray(b) && a.some((x) => b.some((y) => eq(x, y))),
  all: ([list, value]) => Array.isArray(list) && list.length > 0 && list.every((x) => eq(x, value)),
  any: ([list, value]) => Array.isArray(list) && list.some((x) => eq(x, value)),
};

export function builtinFunctionNames(): string[] {
  return Object.keys(BUILTINS);
}
