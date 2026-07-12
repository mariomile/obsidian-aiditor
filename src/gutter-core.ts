/**
 * Pure, Obsidian-free derivation of AIditor gutter markers from a set of
 * VISIBLE editor lines (design §5/§8, risk §11.2 item 2). The gutter never
 * caches absolute document positions: on every relevant update the coupled
 * layer re-reads `view.visibleRanges`, hands the visible lines here, and this
 * function decides — purely from line text + an active-count lookup — which
 * lines get an annotation marker. Scanning only the visible window keeps
 * placement correct across folds and long docs, because a fold simply drops
 * those lines from the input.
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

export type GutterMarkerSpec = AnnotationMarkerSpec;

const STANDALONE_BLOCK_ID_RE = /^\^(ai-[a-z0-9]+)\s*$/;

/**
 * Derives gutter marker specs from the visible lines.
 *
 * - Annotation marker: for each visible standalone `^ai-<id>` line whose
 *   blockId has ≥1 active annotation (per `countForBlockId`), a marker is
 *   attached to the nearest visible non-blank line above it (the block's own
 *   content line). Count is carried through so the caller can badge when >1.
 */
export function deriveGutterMarkers(
  visible: VisibleLine[],
  countForBlockId: (blockId: string) => number,
): GutterMarkerSpec[] {
  const byLine = new Map<number, string>();
  for (const v of visible) byLine.set(v.line, v.text);

  const specs: GutterMarkerSpec[] = [];

  // Annotation markers from visible ^ai-id lines.
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
    specs.push({ kind: 'marker', line: contentLine, blockId, count });
  }

  specs.sort((a, b) => a.line - b.line);
  return specs;
}
