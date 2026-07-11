/**
 * CM6 gutter/margin markers for Live Preview (design §5/§8, risk §11.2 item 2).
 *
 * A ViewPlugin owns the current marker RangeSet and rebuilds it — from a scan
 * of the VISIBLE document lines (`view.visibleRanges`), never a cached
 * absolute position — on every update where `docChanged` or `viewportChanged`
 * is true, and again whenever the store emits a change event. Scanning only
 * the visible window (via the pure `deriveGutterMarkers`) keeps placement
 * correct across folds and long docs: a folded region simply drops out of the
 * input, so a marker can never desync from its `^gl-id`.
 *
 * Markers: a subtle dot on the content line of any block whose `^gl-id` has
 * ≥1 active annotation (count badge when >1); click → popover. A "＋"
 * affordance appears on the gutter of the hovered block and funnels into the
 * shared createAnnotation flow.
 *
 * CM6 gotcha (prior vault experience): `posAtCoords` never resolves inside
 * `.cm-embed-block` (tables/callouts/embeds in Live Preview). The hover
 * hit-test therefore falls back through `closest('.cm-embed-block')` +
 * `posAtDOM` + an element-rect scan. The `^gl-id` line itself is always a
 * plain line, which is why markers key off it.
 */

import { gutter, GutterMarker, ViewPlugin, EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { RangeSet, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { deriveGutterMarkers, type GutterMarkerSpec, type VisibleLine } from './gutter-core.ts';

const GUTTER_CLASS = 'glossa-gutter';

export interface GutterHost {
  /** Active-annotation count for a given `^gl-id`, scoped to the note currently in this editor. */
  countForBlockId: (blockId: string) => number;
  /** Called when a marker (existing annotations) is clicked. */
  onMarkerClick: (blockId: string, dom: HTMLElement) => void;
  /** Called when the "＋" affordance is clicked for the block starting at `line` (0-based). */
  onPlusClick: (line: number, dom: HTMLElement) => void;
  /** Subscribe to store changes; returns an unsubscribe. Triggers a marker refresh. */
  onStoreChange: (listener: () => void) => () => void;
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

/** Collect the visible lines (0-based) from the view's current visibleRanges. */
function collectVisibleLines(view: EditorView): VisibleLine[] {
  const { doc } = view.state;
  const out: VisibleLine[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        out.push({ line: line.number - 1, text: line.text });
      }
      if (line.to + 1 <= to) {
        pos = line.to + 1;
      } else {
        break;
      }
    }
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * Resolve the block-start line under a pointer, handling the `.cm-embed-block`
 * gotcha: `posAtCoords` returns null inside embeds (tables/callouts), so we
 * fall back to `posAtDOM` on the embed element, then to a rect scan.
 */
function blockLineAtCoords(view: EditorView, x: number, y: number): number | null {
  let pos = view.posAtCoords({ x, y });
  if (pos === null) {
    const target = document.elementFromPoint(x, y);
    const embed = target?.closest('.cm-embed-block') as HTMLElement | null;
    if (embed) {
      try {
        pos = view.posAtDOM(embed);
      } catch {
        pos = null;
      }
    }
  }
  if (pos === null) {
    // Element-rect fallback: find the visible line whose rendered rect contains y.
    for (const { from, to } of view.visibleRanges) {
      let p = from;
      while (p <= to) {
        const line = view.state.doc.lineAt(p);
        const rect = view.coordsAtPos(line.from);
        if (rect && y >= rect.top && y <= rect.bottom) return line.number - 1;
        p = line.to + 1;
      }
    }
    return null;
  }
  return view.state.doc.lineAt(pos).number - 1;
}

/** Dispatch this effect to force a gutter rebuild without a doc change (e.g. after a store mutation). */
export const refreshGlossaGutterEffect = StateEffect.define<null>();

function buildRangeSet(specs: GutterMarkerSpec[], view: EditorView, host: GutterHost, hoverLine: number | null): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const { doc } = view.state;
  for (const spec of specs) {
    if (spec.kind === 'plus' && spec.line !== hoverLine) continue; // "＋" only on the hovered block
    if (spec.line < 0 || spec.line >= doc.lines) continue;
    const from = doc.line(spec.line + 1).from;
    const marker =
      spec.kind === 'marker'
        ? new AnnotationMarker(spec.count, spec.blockId, host)
        : new PlusMarker(spec.line, host);
    builder.add(from, from, marker);
  }
  return builder.finish();
}

class GlossaGutterPlugin implements PluginValue {
  markers: RangeSet<GutterMarker> = RangeSet.empty;
  private hoverLine: number | null = null;
  private unsubscribe: () => void;
  private onMove: (e: MouseEvent) => void;
  private onLeave: () => void;

  constructor(private view: EditorView, private host: GutterHost) {
    this.recompute();
    // Store change → refresh markers via an empty dispatch, which re-runs update().
    this.unsubscribe = host.onStoreChange(() => {
      this.view.dispatch({ effects: refreshGlossaGutterEffect.of(null) });
    });
    this.onMove = (e: MouseEvent) => {
      const line = blockLineAtCoords(this.view, e.clientX, e.clientY);
      if (line !== this.hoverLine) {
        this.hoverLine = line;
        this.recompute();
        this.view.dispatch({ effects: refreshGlossaGutterEffect.of(null) });
      }
    };
    this.onLeave = () => {
      if (this.hoverLine !== null) {
        this.hoverLine = null;
        this.recompute();
        this.view.dispatch({ effects: refreshGlossaGutterEffect.of(null) });
      }
    };
    this.view.dom.addEventListener('mousemove', this.onMove);
    this.view.dom.addEventListener('mouseleave', this.onLeave);
  }

  private recompute(): void {
    const visible = collectVisibleLines(this.view);
    const specs = deriveGutterMarkers(visible, this.host.countForBlockId);
    this.markers = buildRangeSet(specs, this.view, this.host, this.hoverLine);
  }

  update(update: ViewUpdate): void {
    const forced = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshGlossaGutterEffect)));
    if (update.docChanged || update.viewportChanged || forced) {
      this.recompute();
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.view.dom.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
  }
}

/**
 * Builds the Glossa CM6 gutter extension: a ViewPlugin that maintains the
 * marker RangeSet from a visible-range scan (rebuilt on docChanged /
 * viewportChanged / store change) plus the `gutter()` that renders it.
 * Register once via `registerEditorExtension` in main.ts.
 */
export function glossaGutterExtension(host: GutterHost, side: 'left' | 'right' = 'left'): Extension {
  const plugin = ViewPlugin.define((view) => new GlossaGutterPlugin(view, host));
  return [
    plugin,
    gutter({
      class: `${GUTTER_CLASS} ${GUTTER_CLASS}--${side}`,
      markers: (view) => view.plugin(plugin)?.markers ?? RangeSet.empty,
    }),
  ];
}
