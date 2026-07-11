/**
 * Pure, Obsidian-free derivation of Glossa gutter markers from a set of
 * VISIBLE editor lines (design §5/§8, risk §11.2 item 2). The gutter never
 * caches absolute document positions: on every relevant update the coupled
 * layer re-reads `view.visibleRanges`, hands the visible lines here, and this
 * function decides — purely from line text + an active-count lookup — which
 * lines get an annotation marker and which get a "＋" affordance. Scanning
 * only the visible window keeps placement correct across folds and long docs,
 * because a fold simply drops those lines from the input.
 */

/** One visible editor line: its 0-based line number and its raw text. */
export interface VisibleLine {
  line: number;
  text: string;
}

export interface AnnotationMarkerSpec {
  kind: 'marker';
  /** 0-based line the marker attaches to — the block's content line. */
  line: number;
  blockId: string;
  count: number;
}

export interface PlusMarkerSpec {
  kind: 'plus';
  /** 0-based block-start line the "＋" affordance attaches to. */
  line: number;
}

export type GutterMarkerSpec = AnnotationMarkerSpec | PlusMarkerSpec;

const STANDALONE_BLOCK_ID_RE = /^\^(gl-[a-z0-9]+)\s*$/;

/**
 * Derives gutter marker specs from the visible lines.
 *
 * - Annotation marker: for each visible standalone `^gl-<id>` line whose
 *   blockId has ≥1 active annotation (per `countForBlockId`), a marker is
 *   attached to the nearest visible non-blank line above it (the block's own
 *   content line). Count is carried through so the caller can badge when >1.
 * - "＋" affordance: on every visible block-start line (non-blank; either the
 *   first line, or its predecessor is blank, or its predecessor is outside the
 *   visible window) that is neither a `^gl-id` line nor already carrying an
 *   annotation marker.
 */
export function deriveGutterMarkers(
  visible: VisibleLine[],
  countForBlockId: (blockId: string) => number,
): GutterMarkerSpec[] {
  const byLine = new Map<number, string>();
  for (const v of visible) byLine.set(v.line, v.text);

  const specs: GutterMarkerSpec[] = [];
  const markedContentLines = new Set<number>();

  // Pass 1: annotation markers from visible ^gl-id lines.
  for (const v of visible) {
    const m = v.text.trim().match(STANDALONE_BLOCK_ID_RE);
    if (!m) continue;
    const blockId = m[1]!;
    const count = countForBlockId(blockId);
    if (count <= 0) continue;
    // Walk up to the nearest visible non-blank content line above the id.
    let contentLine = v.line - 1;
    while (contentLine >= 0 && byLine.has(contentLine) && byLine.get(contentLine)!.trim() === '') {
      contentLine--;
    }
    if (contentLine < 0 || !byLine.has(contentLine)) continue;
    markedContentLines.add(contentLine);
    specs.push({ kind: 'marker', line: contentLine, blockId, count });
  }

  // Pass 2: "＋" affordance on block-start lines with no annotation yet.
  for (const v of visible) {
    const text = v.text;
    if (text.trim() === '') continue;
    if (STANDALONE_BLOCK_ID_RE.test(text.trim())) continue;
    if (markedContentLines.has(v.line)) continue;
    const prev = byLine.get(v.line - 1);
    // Block start: doc start, predecessor blank, or predecessor not visible
    // (a range boundary — treat as a fresh block).
    const isBlockStart = v.line === 0 || prev === undefined || prev.trim() === '';
    if (!isBlockStart) continue;
    specs.push({ kind: 'plus', line: v.line });
  }

  specs.sort((a, b) => a.line - b.line);
  return specs;
}
