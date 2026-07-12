/**
 * CM6 gutter/margin markers for Live Preview (design §5/§8, risk §11.2 item 2).
 *
 * A ViewPlugin owns the current marker RangeSet and rebuilds it — from a scan
 * of the VISIBLE document lines (`view.visibleRanges`), never a cached
 * absolute position — on every update where `docChanged` or `viewportChanged`
 * is true, and again whenever the store emits a change event. Scanning only
 * the visible window (via the pure `deriveGutterMarkers`) keeps placement
 * correct across folds and long docs: a folded region simply drops out of the
 * input, so a marker can never desync from its `^ai-id`.
 *
 * Markers: a subtle dot on the content line of any block whose `^ai-id` has
 * ≥1 active annotation (count badge when >1); click → popover. The `^ai-id`
 * line itself is always a plain line, which is why markers key off it.
 */

import { gutter, GutterMarker, ViewPlugin, EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { RangeSet, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { deriveGutterMarkers, type GutterMarkerSpec, type VisibleLine } from './gutter-core.ts';

const GUTTER_CLASS = 'aiditor-gutter';

export interface GutterHost {
  /** Active-annotation count for a given `^ai-id`, scoped to the note currently in this editor. */
  countForBlockId: (blockId: string) => number;
  /** Called when a marker (existing annotations) is clicked. */
  onMarkerClick: (blockId: string, dom: HTMLElement) => void;
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
    el.className = 'aiditor-gutter-marker';
    el.setAttribute('aria-label', this.count > 1 ? `${this.count} annotations` : 'Annotation');
    if (this.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'aiditor-gutter-badge';
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

/** Dispatch this effect to force a gutter rebuild without a doc change (e.g. after a store mutation). */
export const refreshAIditorGutterEffect = StateEffect.define<null>();

function buildRangeSet(specs: GutterMarkerSpec[], view: EditorView, host: GutterHost): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const { doc } = view.state;
  for (const spec of specs) {
    if (spec.line < 0 || spec.line >= doc.lines) continue;
    const from = doc.line(spec.line + 1).from;
    builder.add(from, from, new AnnotationMarker(spec.count, spec.blockId, host));
  }
  return builder.finish();
}

class AIditorGutterPlugin implements PluginValue {
  markers: RangeSet<GutterMarker> = RangeSet.empty;
  private unsubscribe: () => void;

  constructor(private view: EditorView, private host: GutterHost) {
    this.recompute();
    // Store change → refresh markers via an empty dispatch, which re-runs update().
    this.unsubscribe = host.onStoreChange(() => {
      this.view.dispatch({ effects: refreshAIditorGutterEffect.of(null) });
    });
  }

  private recompute(): void {
    const visible = collectVisibleLines(this.view);
    const specs = deriveGutterMarkers(visible, this.host.countForBlockId);
    this.markers = buildRangeSet(specs, this.view, this.host);
  }

  update(update: ViewUpdate): void {
    const forced = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshAIditorGutterEffect)));
    if (update.docChanged || update.viewportChanged || forced) {
      this.recompute();
    }
  }

  destroy(): void {
    this.unsubscribe();
  }
}

/**
 * Builds the AIditor CM6 gutter extension: a ViewPlugin that maintains the
 * marker RangeSet from a visible-range scan (rebuilt on docChanged /
 * viewportChanged / store change) plus the `gutter()` that renders it.
 * Register once via `registerEditorExtension` in main.ts.
 */
export function aiditorGutterExtension(host: GutterHost, side: 'left' | 'right' = 'left'): Extension {
  const plugin = ViewPlugin.define((view) => new AIditorGutterPlugin(view, host));
  return [
    plugin,
    gutter({
      class: `${GUTTER_CLASS} ${GUTTER_CLASS}--${side}`,
      markers: (view) => view.plugin(plugin)?.markers ?? RangeSet.empty,
    }),
  ];
}
