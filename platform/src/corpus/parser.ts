import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { platformPath, type CorpusSource } from '../kernel/config.ts';

export interface Interpretation {
  rootNamespace: string;
  documentBoundary: string[];
  universeCode: string;
  universeCodeInline: string;
  universeCodeInTitle: string;
  partLabel: string;
  versionLine: string;
  supersedesLine: string;
  sectionRangeLine: string;
  numberedSection: string;
  articleHeading: string;
  ignoreHeadingLines: string[];
  authorityLine: string;
  identifiedRule: string;
  documentMetadataSection: string;
  sectionRoles: { match: string; role: string }[];
  subsectionRoles: { match: string; role: string }[];
  treeGlyphs: string;
  flowGlyphs: string;
  dependencyDirection: { supports: string; consumes: string };
  invariantPatterns: { disjointness: string; possession: string; nonNegative: string };
  attributeSemanticHints: Record<string, string>;
}

export interface Block {
  kind: 'text' | 'code' | 'list';
  lines: string[];
  line: number;
}

export interface Subsection {
  title: string;
  line: number;
  level: number;
  role: string;
  blocks: Block[];
}

export interface Section {
  title: string;
  number: string | null;
  line: number;
  endLine: number;
  role: string;
  headingLines: number[];
  blocks: Block[];
  subsections: Subsection[];
}

export interface CorpusDocument {
  key: string;
  source: string;
  kind: 'part' | 'document' | 'file';
  label: string;
  partNumber: string | null;
  titleLines: string[];
  title: string;
  code: string | null;
  codeInherited: boolean;
  line: number;
  endLine: number;
  version: string | null;
  supersedes: string | null;
  sectionRange: string | null;
  declaredAuthorities: string[];
  headingLines: number[];
  preamble: Block[];
  sections: Section[];
  metadata: Record<string, string>;
}

export interface Heading {
  line: number;
  level: number;
  text: string;
}

export interface ParsedSource {
  source: CorpusSource;
  file: string;
  documents: CorpusDocument[];
  headings: Heading[];
  lineCount: number;
}

const rx = (s: string, flags = '') => new RegExp(s, flags);

/**
 * Parses the constitutional corpus into documents → sections → subsections →
 * blocks, with line numbers for every heading so coverage can be proven.
 * The parser knows only markdown structure and the patterns configured in
 * corpus-interpretation.json.
 */
export class CorpusParser {
  private readonly it: Interpretation;

  constructor(it: Interpretation) {
    this.it = it;
  }

  parseAll(sources: CorpusSource[]): ParsedSource[] {
    const out: ParsedSource[] = [];
    for (const s of sources) {
      const path = platformPath(s.path);
      if (s.kind === 'directory' || statSync(path).isDirectory()) {
        const include = rx(s.include ?? '.*');
        for (const f of readdirSync(path).filter((x) => include.test(x)).sort()) out.push(this.parseMarkdownFile({ ...s, id: `${s.id}:${f}` }, join(path, f)));
      } else out.push(this.parseTextFile(s, path));
    }
    return out;
  }

  roleOf(title: string, roles: { match: string; role: string }[]): string {
    for (const r of roles) if (rx(r.match, 'i').test(title.trim())) return r.role;
    return 'section';
  }

  /** Splits text lines (outside headings) into text / code / list blocks. */
  private blocksOf(lines: string[], startLine: number): Block[] {
    const blocks: Block[] = [];
    let cur: Block | null = null;
    let inCode = false;
    const flush = () => {
      if (cur && cur.lines.some((l) => l.trim())) blocks.push(cur);
      cur = null;
    };
    lines.forEach((raw, i) => {
      const lineNo = startLine + i;
      if (raw.trim().startsWith('```')) {
        if (inCode) {
          inCode = false;
          flush();
        } else {
          flush();
          inCode = true;
          cur = { kind: 'code', lines: [], line: lineNo };
        }
        return;
      }
      if (inCode) {
        cur!.lines.push(raw);
        return;
      }
      if (raw.trim() === '' || raw.trim() === '---') {
        flush();
        return;
      }
      const isList = /^\s*([-*+]|\d+\.)\s+/.test(raw);
      const kind: Block['kind'] = isList ? 'list' : 'text';
      if (!cur || cur.kind !== kind) {
        flush();
        cur = { kind, lines: [], line: lineNo };
      }
      cur.lines.push(isList ? raw.replace(/^\s*([-*+]|\d+\.)\s+/, '') : raw);
    });
    flush();
    return blocks;
  }

  // ── plain-text corpus (Architecture1/2, notes): '#' = section level ─────

  parseTextFile(source: CorpusSource, path: string): ParsedSource {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    const headings: Heading[] = [];
    let inCode = false;
    lines.forEach((l, i) => {
      if (l.trim().startsWith('```')) inCode = !inCode;
      if (inCode) return;
      const m = /^(#{1,6})\s+(.+?)\s*$/.exec(l);
      if (m) headings.push({ line: i + 1, level: m[1].length, text: m[2].trim() });
    });
    const documents: CorpusDocument[] = [];
    const boundary = this.it.documentBoundary.map((b) => rx(b));
    // Cluster consecutive level-1 headings separated only by blank lines.
    type Cluster = { start: number; end: number; items: Heading[] };
    const clusters: Cluster[] = [];
    for (const h of headings.filter((x) => x.level === 1)) {
      const last = clusters[clusters.length - 1];
      if (last && lines.slice(last.end, h.line - 1).every((l) => l.trim() === '')) {
        last.items.push(h);
        last.end = h.line;
      } else clusters.push({ start: h.line, end: h.line, items: [h] });
    }
    const newDoc = (line: number, kind: CorpusDocument['kind']): CorpusDocument => ({
      key: '',
      source: source.id,
      kind,
      label: '',
      partNumber: null,
      titleLines: [],
      title: '',
      code: null,
      codeInherited: false,
      line,
      endLine: lines.length,
      version: null,
      supersedes: null,
      sectionRange: null,
      declaredAuthorities: [],
      headingLines: [],
      preamble: [],
      sections: [],
      metadata: {},
    });
    if (clusters.length === 0) {
      // A note without headings is one document with one section.
      const note = newDoc(1, 'file');
      const firstLine = lines.find((l) => l.trim())?.trim() ?? basename(path);
      note.title = firstLine;
      note.titleLines = [firstLine];
      note.label = basename(path);
      note.code = this.it.rootNamespace;
      note.key = `${source.id}-001`;
      note.sections.push({ title: firstLine, number: null, line: 1, endLine: lines.length, role: this.roleOf(firstLine, this.it.sectionRoles), headingLines: [], blocks: this.blocksOf(lines, 1), subsections: [] });
      return { source, file: path, documents: [note], headings, lineCount: lines.length };
    }
    let doc: CorpusDocument | null = null;
    const pendingSections: { cluster: Cluster; doc: CorpusDocument }[] = [];
    for (const c of clusters) {
      const isBoundary = c.items.some((h) => boundary.some((b) => b.test(h.text)));
      if (isBoundary || !doc) {
        doc = newDoc(c.start, 'part');
        documents.push(doc);
        this.readDocumentHeader(doc, c.items);
        // A boundary cluster may end with a section heading (e.g. "ARTICLE 1").
        const tail = c.items.findIndex((h) => rx(this.it.numberedSection).test(h.text) || rx(this.it.articleHeading).test(h.text) || rx(this.it.documentMetadataSection).test(h.text));
        if (tail >= 0 && isBoundary) pendingSections.push({ cluster: { start: c.items[tail].line, end: c.end, items: c.items.slice(tail) }, doc });
        continue;
      }
      pendingSections.push({ cluster: c, doc });
    }
    // Sections: each cluster owns the lines until the next cluster.
    const allStarts = clusters.map((c) => c.start);
    for (const { cluster, doc: d } of pendingSections) {
      const idx = allStarts.indexOf(cluster.start);
      const nextStart = allStarts.find((s) => s > cluster.start) ?? lines.length + 1;
      void idx;
      const titleItems = cluster.items.filter((h) => !this.it.ignoreHeadingLines.some((p) => rx(p).test(h.text)));
      let number: string | null = null;
      let title = '';
      const first = titleItems[0] ?? cluster.items[0];
      const num = rx(this.it.numberedSection).exec(first.text);
      const art = rx(this.it.articleHeading).exec(first.text);
      if (num) {
        number = num[1];
        title = [num[2], ...titleItems.slice(1).map((h) => h.text)].join(' ').trim();
      } else if (art) {
        number = `A${art[1]}`;
        title = titleItems.slice(1).map((h) => h.text).join(' ').trim() || first.text;
      } else title = titleItems.map((h) => h.text).join(' ').trim() || first.text;
      const bodyStart = cluster.end;
      const bodyLines = lines.slice(bodyStart, nextStart - 1);
      const section: Section = { title, number, line: cluster.start, endLine: nextStart - 1, role: this.roleOf(title, this.it.sectionRoles), headingLines: cluster.items.map((h) => h.line), blocks: [], subsections: [] };
      this.fillSection(section, bodyLines, bodyStart + 1, headings);
      d.sections.push(section);
    }
    // Close document ranges and preambles.
    documents.forEach((d, i) => {
      d.endLine = i + 1 < documents.length ? documents[i + 1].line - 1 : lines.length;
      const firstSection = d.sections[0]?.line ?? d.endLine + 1;
      const headerEnd = Math.max(...d.headingLines, d.line);
      d.preamble = this.blocksOf(lines.slice(headerEnd, firstSection - 1), headerEnd + 1);
      const meta = d.sections.find((s) => rx(this.it.documentMetadataSection).test(s.title));
      if (meta) Object.assign(d.metadata, keyValues(meta.blocks));
      const statusSection = d.sections.find((s) => s.role === 'status');
      if (statusSection) Object.assign(d.metadata, keyValues(statusSection.blocks));
      if (d.metadata['Document ID']) d.label = d.metadata['Document ID'];
      if (!d.title) d.title = d.metadata['Document Name'] ?? d.sectionRange ?? d.declaredAuthorities[0] ?? d.label;
      if (!d.version && d.metadata['Version']) d.version = d.metadata['Version'].split('\n')[0];
      if (!d.supersedes && d.metadata['Supersedes']) d.supersedes = /(\d+(?:\.\d+)*)/.exec(d.metadata['Supersedes'])?.[1] ?? null;
    });
    this.assignCodes(documents);
    documents.forEach((d, i) => (d.key = `${source.id}-${String(i + 1).padStart(3, '0')}`));
    return { source, file: path, documents, headings, lineCount: lines.length };
  }

  private readDocumentHeader(doc: CorpusDocument, items: Heading[]): void {
    const code = rx(this.it.universeCode);
    const part = rx(this.it.partLabel);
    for (const h of items) {
      doc.headingLines.push(h.line);
      const t = h.text;
      const pm = part.exec(t);
      if (pm) {
        doc.partNumber = pm[1];
        doc.label = `PART ${pm[1]}${pm[2] ? ` ${pm[2]}` : ''}`;
        if (pm[2]) doc.version = pm[2].replace(/^v/, '');
        continue;
      }
      if (rx(this.it.numberedSection).test(t) || rx(this.it.articleHeading).test(t) || rx(this.it.documentMetadataSection).test(t)) break;
      const cm = code.exec(t);
      if (cm) {
        if (cm[1] !== this.it.rootNamespace || !doc.code) doc.code = cm[1] === this.it.rootNamespace ? doc.code : cm[1];
        if (cm[1] === this.it.rootNamespace && !doc.label) doc.label = t;
        continue;
      }
      const vm = rx(this.it.versionLine, 'i').exec(t);
      if (vm) {
        doc.version = vm[1];
        continue;
      }
      const sm = rx(this.it.supersedesLine, 'i').exec(t);
      if (sm) {
        doc.supersedes = sm[1];
        continue;
      }
      if (rx(this.it.sectionRangeLine, 'i').test(t)) {
        doc.sectionRange = t;
        continue;
      }
      if (rx(this.it.authorityLine).test(t)) {
        doc.declaredAuthorities.push(t);
        continue;
      }
      if (this.it.ignoreHeadingLines.some((p) => rx(p).test(t))) continue;
      doc.titleLines.push(t);
    }
    doc.title = doc.titleLines.join(' ').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
    const inTitle = rx(this.it.universeCodeInTitle).exec(doc.title);
    if (!doc.code && inTitle) doc.code = inTitle[1];
  }

  /** Documents without a code line inherit it from the same part, else from the previous document. */
  private assignCodes(documents: CorpusDocument[]): void {
    const byPart = new Map<string, string>();
    let previous: string | null = null;
    for (const d of documents) {
      if (d.code) {
        if (d.partNumber) byPart.set(d.partNumber.replace(/[A-Z]$/, ''), d.code);
        previous = d.code;
        continue;
      }
      const fromMeta = Object.entries(d.metadata).find(([k]) => /universe code/i.test(k))?.[1];
      const metaCode = fromMeta ? rx(this.it.universeCodeInline).exec(fromMeta)?.[1] : undefined;
      const inherited: string | null | undefined = metaCode ?? (d.partNumber ? byPart.get(d.partNumber.replace(/[A-Z]$/, '')) : undefined) ?? previous;
      d.code = inherited ?? this.it.rootNamespace;
      d.codeInherited = !metaCode;
      previous = d.code;
    }
    for (const d of documents) if (!d.label) d.label = d.metadata['Document ID'] ?? d.title ?? d.key;
  }

  private fillSection(section: Section, bodyLines: string[], firstLineNo: number, headings: Heading[]): void {
    const subHeads = headings.filter((h) => h.level >= 2 && h.line >= firstLineNo && h.line < firstLineNo + bodyLines.length);
    const firstSub = subHeads[0]?.line ?? firstLineNo + bodyLines.length;
    section.blocks = this.blocksOf(bodyLines.slice(0, firstSub - firstLineNo), firstLineNo);
    subHeads.forEach((h, i) => {
      const end = subHeads[i + 1]?.line ?? firstLineNo + bodyLines.length;
      section.subsections.push({ title: h.text, line: h.line, level: h.level, role: this.roleOf(h.text, this.it.subsectionRoles), blocks: this.blocksOf(bodyLines.slice(h.line - firstLineNo + 1, end - firstLineNo), h.line + 1) });
    });
  }

  // ── markdown phase documents: '#' = document, '##' = section ────────────

  parseMarkdownFile(source: CorpusSource, path: string): ParsedSource {
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n');
    const headings: Heading[] = [];
    let inCode = false;
    lines.forEach((l, i) => {
      if (l.trim().startsWith('```')) inCode = !inCode;
      if (inCode) return;
      const m = /^(#{1,6})\s+(.+?)\s*$/.exec(l);
      if (m) headings.push({ line: i + 1, level: m[1].length, text: m[2].trim() });
    });
    const title = headings.find((h) => h.level === 1)?.text ?? basename(path);
    const doc: CorpusDocument = {
      key: `${source.id}`,
      source: source.id,
      kind: 'file',
      label: /\*\*Document ID:\*\*\s*([A-Z0-9-]+)/.exec(text)?.[1] ?? basename(path),
      partNumber: null,
      titleLines: [title],
      title,
      code: this.it.rootNamespace,
      codeInherited: false,
      line: 1,
      endLine: lines.length,
      version: /\*\*Version:\*\*\s*(.+)/.exec(text)?.[1]?.trim() ?? null,
      supersedes: null,
      sectionRange: null,
      declaredAuthorities: [],
      headingLines: headings.filter((h) => h.level === 1).map((h) => h.line),
      preamble: [],
      sections: [],
      metadata: {},
    };
    const secHeads = headings.filter((h) => h.level === 2);
    const firstSec = secHeads[0]?.line ?? lines.length + 1;
    doc.preamble = this.blocksOf(lines.slice(1, firstSec - 1), 2);
    secHeads.forEach((h, i) => {
      const end = secHeads[i + 1]?.line ?? lines.length + 1;
      const num = /^([A-Z0-9]+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(h.text);
      const titleText = num ? num[2] : h.text;
      const section: Section = { title: titleText.replace(/\s+—\s+`[^`]+`$/, '').trim(), number: num ? num[1] : null, line: h.line, endLine: end - 1, role: this.roleOf(titleText, this.it.sectionRoles), headingLines: [h.line], blocks: [], subsections: [] };
      const body = lines.slice(h.line, end - 1);
      const subHeads = headings.filter((x) => x.level >= 3 && x.line > h.line && x.line < end);
      const firstSub = subHeads[0]?.line ?? end;
      section.blocks = this.blocksOf(body.slice(0, firstSub - h.line - 1), h.line + 1);
      subHeads.forEach((sh, j) => {
        const subEnd = subHeads[j + 1]?.line ?? end;
        section.subsections.push({ title: sh.text, line: sh.line, level: sh.level, role: this.roleOf(sh.text, this.it.subsectionRoles), blocks: this.blocksOf(lines.slice(sh.line, subEnd - 1), sh.line + 1) });
      });
      doc.sections.push(section);
    });
    return { source, file: path, documents: [doc], headings, lineCount: lines.length };
  }
}

/** Reads "Key:\nValue" pairs (or "Key: Value") from code blocks. */
export function keyValues(blocks: Block[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of blocks.filter((x) => x.kind === 'code' || x.kind === 'text')) {
    const ls = b.lines.map((l) => l.trim());
    for (let i = 0; i < ls.length; i++) {
      const inline = /^([A-Z][A-Za-z /&-]{1,40}):\s+(.+)$/.exec(ls[i]);
      if (inline) {
        out[inline[1].trim()] = inline[2].trim();
        continue;
      }
      const key = /^([A-Z][A-Za-z /&-]{1,40}):$/.exec(ls[i]);
      if (key) {
        const vals: string[] = [];
        let j = i + 1;
        while (j < ls.length && ls[j] !== '' && !/^[A-Z][A-Za-z /&-]{1,40}:$/.test(ls[j])) vals.push(ls[j++]);
        if (vals.length) out[key[1].trim()] = vals.join('\n');
        i = j - 1;
      }
    }
  }
  return out;
}

/** Items of a code or list block: tree glyphs and arrows stripped, depth preserved. */
export function items(block: Block, treeGlyphs: string, flowGlyphs: string): { text: string; depth: number; line: number }[] {
  const tree = new RegExp(treeGlyphs, 'g');
  const flow = new RegExp(flowGlyphs);
  const out: { text: string; depth: number; line: number }[] = [];
  block.lines.forEach((raw, i) => {
    if (!raw.trim() || flow.test(raw)) return;
    const prefixMatch = /^([\s├└│┌┐┘┬┴┼─]*)/.exec(raw)![1];
    const depth = Math.floor(prefixMatch.replace(/─/g, ' ').length / 4);
    const text = raw.replace(tree, ' ').replace(/[↓→▼⇩⬇←↑]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^[|:.\-=_*]+$/.test(text)) return;
    out.push({ text, depth, line: block.line + i + (block.kind === 'code' ? 1 : 0) });
  });
  return out;
}
