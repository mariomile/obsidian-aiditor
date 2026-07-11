/**
 * Pure, Obsidian-free anchoring logic: block-id generation/collision-check,
 * standalone-line ^gl-id detection & insertion, and text-quote (prefix/quote/suffix)
 * matching/relocation. No Obsidian imports, no clock — timestamps are the caller's job.
 */

const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LEN = 6;

/** A minimal block shape — just the line span, matching composer's Block. */
export interface BlockSpan {
  startLine: number;
  endLine: number;
}

export interface LineEdit {
  fromLine: number;
  toLine: number; // toLine === fromLine - 1 → pure insertion before fromLine
  insert: string[];
}

export interface QuoteContext {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface QuoteMatch {
  start: number;
  end: number;
}

function randomBase36Chunk(rand: () => number): string {
  let out = '';
  for (let i = 0; i < ID_LEN; i++) {
    const idx = Math.floor(rand() * BASE36_ALPHABET.length) % BASE36_ALPHABET.length;
    out += BASE36_ALPHABET[idx];
  }
  return out;
}

/**
 * Generate a `gl-<6-char-base36>` block id, collision-checked against `existing`
 * (the set of blockIds already present in the store / note). `rand` defaults to
 * Math.random but is injectable for deterministic tests.
 */
export function generateBlockId(
  rand: () => number = Math.random,
  existing: ReadonlySet<string> = new Set(),
): string {
  let id = `gl-${randomBase36Chunk(rand)}`;
  let guard = 0;
  while (existing.has(id) && guard < 1000) {
    id = `gl-${randomBase36Chunk(rand)}`;
    guard++;
  }
  return id;
}

const STANDALONE_BLOCK_ID_RE = /^\^(gl-[a-z0-9]+)\s*$/;

/**
 * Look for a standalone `^gl-<id>` line immediately following the block
 * (skipping at most one blank separator line). Inline ids (appended to a
 * content line) are never matched — standalone only, per design §3.
 */
export function findBlockId(lines: string[], startLine: number): string | null {
  const block = { startLine, endLine: startLine };
  return findBlockIdForBlock(lines, block);
}

export function findBlockIdForBlock(lines: string[], block: BlockSpan): string | null {
  const direct = lines[block.endLine + 1];
  const directMatch = direct?.match(STANDALONE_BLOCK_ID_RE);
  if (directMatch) return directMatch[1]!;

  if (direct !== undefined && direct.trim() === '') {
    const afterBlank = lines[block.endLine + 2];
    const blankMatch = afterBlank?.match(STANDALONE_BLOCK_ID_RE);
    if (blankMatch) return blankMatch[1]!;
  }
  return null;
}

/** Scan the whole doc for every standalone `^gl-<id>` line. */
export function findAllBlockIds(lines: string[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    const m = line.match(STANDALONE_BLOCK_ID_RE);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

/**
 * Compute the LineEdit that inserts a standalone `^gl-<id>` line after the
 * given block. Always a blank separator + the id on its own line — never
 * inline (inline breaks hr/table rendering, per design §3).
 */
export function standaloneBlockIdInsertion(
  lines: string[],
  block: BlockSpan,
  id: string,
): LineEdit {
  const at = block.endLine + 1;
  return {
    fromLine: at,
    toLine: at - 1,
    insert: ['', `^${id}`],
  };
}

/**
 * Locate `quote` within `text`. Tries prefix+suffix-anchored match first
 * (disambiguates duplicate occurrences); falls back to the first plain
 * occurrence of `quote` if the surrounding context has shifted; returns
 * null if the quote text is gone entirely.
 */
export function matchQuote(text: string, ctx: QuoteContext): QuoteMatch | null {
  const { quote, prefix, suffix } = ctx;
  if (quote === '') return null;

  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(quote, searchFrom);
    if (idx === -1) break;
    const start = idx;
    const end = idx + quote.length;
    const actualPrefix = text.slice(Math.max(0, start - prefix.length), start);
    const actualSuffix = text.slice(end, end + suffix.length);
    if (actualPrefix === prefix && actualSuffix === suffix) {
      return { start, end };
    }
    searchFrom = idx + 1;
  }

  // Fallback: first plain occurrence, context has drifted.
  const idx = text.indexOf(quote);
  if (idx === -1) return null;
  return { start: idx, end: idx + quote.length };
}

/** Extract up to `maxLen` chars of context before `start` in `text`. */
export function extractPrefix(text: string, start: number, maxLen = 32): string {
  return text.slice(Math.max(0, start - maxLen), start);
}

/** Extract up to `maxLen` chars of context after `end` in `text`. */
export function extractSuffix(text: string, end: number, maxLen = 32): string {
  return text.slice(end, end + maxLen);
}
