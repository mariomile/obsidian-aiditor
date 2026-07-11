/**
 * CM6 gutter/margin markers for Live Preview (design §5/§8): a subtle marker
 * (count badge if >1) on lines whose block carries a `^gl-id` with ≥1 active
 * annotation, plus a "＋" affordance on hover for lines that don't yet have
 * one. Placement is a per-line scan of the doc text for `^gl-<id>` refs
 * (design §11 risk 2) — cheap and correct across folds since CM6 gutters are
 * keyed off a RangeSet, not raw line index, so folding never desyncs them.
 */

import { gutter, GutterMarker, EditorView } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Extension } from '@codemirror/state';
import { findAllBlockIds, findBlockIdForBlock } from './anchor-core.ts';

const GUTTER_CLASS = 'glossa-gutter';

export interface GutterHost {
  /** Active-annotation count for a given `^gl-id`, scoped to the note currently in this editor. */
  countForBlockId: (blockId: string) => number;
  /** Called when a marker (existing annotations) is clicked. */
  onMarkerClick: (blockId: string, dom: HTMLElement) => void;
  /** Called when the "＋" affordance is clicked for the block starting at `line` (0-based). */
  onPlusClick: (line: number, dom: HTMLElement) => void;
}

class AnnotationMarker extends GutterMarker {
  constructor(readonly count: number, readonly blockId: string, private host: GutterHost) {
    super();
  }
  eq(other: AnnotationMarker): boolean {
    return other.count === this.count && other.blockId === this.blockId;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'glossa-gutter-marker';
    el.setAttribute('aria-label', this.count > 1 ? `${this.count} annotations` : 'Annotation');
    if (this.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'glossa-gutter-badge';
      badge.textContent = String(this.count);
      el.appendChild(badge);
    }
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.host.onMarkerClick(this.blockId, el);
    });
    return el;
  }
}

class PlusMarker extends GutterMarker {
  constructor(readonly line: number, private host: GutterHost) {
    super();
  }
  eq(other: PlusMarker): boolean {
    return other.line === this.line;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'glossa-gutter-plus';
    el.setAttribute('aria-label', 'Annotate this block');
    el.textContent = '+';
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.host.onPlusClick(this.line, el);
    });
    return el;
  }
}

/** Rebuilds the full gutter range set from the current doc text + host. */
function buildMarkers(docText: string, doc: EditorView['state']['doc'], host: GutterHost): RangeSet<GutterMarker> {
  const lines = docText.split('\n');
  const blockIds = findAllBlockIds(lines);
  const markers: Array<{ from: number; marker: GutterMarker }> = [];
  const usedLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.trim().match(/^\^(gl-[a-z0-9]+)$/);
    if (!m) continue;
    const blockId = m[1]!;
    const count = host.countForBlockId(blockId);
    if (count <= 0) continue;
    // Attach the marker to the nearest non-blank line above the ^gl-id — the
    // block's own content line — so it visually sits next to the annotated text.
    let contentLine = i - 1;
    while (contentLine >= 0 && lines[contentLine]!.trim() === '') contentLine--;
    if (contentLine < 0) continue;
    usedLines.add(contentLine);
    const pos = doc.line(contentLine + 1).from;
    markers.push({ from: pos, marker: new AnnotationMarker(count, blockId, host) });
  }

  // "+" affordance: one per paragraph-ish block start that has no ^gl-id yet.
  // Kept simple for MVP — only offered at block-start lines (previous line
  // blank or start of doc) that don't already carry a marker.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (/^\^(gl-[a-z0-9]+)$/.test(line.trim())) continue;
    if (usedLines.has(i)) continue;
    const isBlockStart = i === 0 || lines[i - 1]!.trim() === '';
    if (!isBlockStart) continue;
    const existing = findBlockIdForBlock(lines, { startLine: i, endLine: i });
    if (existing && blockIds.has(existing)) continue;
    const pos = doc.line(i + 1).from;
    markers.push({ from: pos, marker: new PlusMarker(i, host) });
  }

  markers.sort((a, b) => a.from - b.from);
  return RangeSet.of(
    markers.map(({ from, marker }) => marker.range(from)),
    true,
  );
}

/** Dispatch this effect (with `null`) to force a gutter rebuild without a doc change — e.g. after a store mutation like resolve/reopen/delete that doesn't touch the note text. */
export const refreshGlossaGutterEffect = StateEffect.define<null>();

function markersField(host: GutterHost): StateField<RangeSet<GutterMarker>> {
  return StateField.define<RangeSet<GutterMarker>>({
    create(state) {
      return buildMarkers(state.doc.toString(), state.doc, host);
    },
    update(markers, tr) {
      const forceRebuild = tr.effects.some((e) => e.is(refreshGlossaGutterEffect));
      if (tr.docChanged || forceRebuild) {
        return buildMarkers(tr.state.doc.toString(), tr.state.doc, host);
      }
      return markers.map(tr.changes);
    },
  });
}

/**
 * Builds the Glossa CM6 gutter extension: a StateField holding the current
 * marker RangeSet (rebuilt on doc change or an explicit refresh effect) plus
 * the `gutter()` extension that renders it. Register once via
 * `registerEditorExtension` in main.ts.
 */
export function glossaGutterExtension(host: GutterHost, side: 'left' | 'right' = 'left'): Extension {
  const field = markersField(host);
  return [
    field,
    gutter({
      class: `${GUTTER_CLASS} ${GUTTER_CLASS}--${side}`,
      markers: (view) => view.state.field(field),
    }),
  ];
}
