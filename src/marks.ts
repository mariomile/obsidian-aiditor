/**
 * Inline comment highlights — replaces the old CM6 gutter (design revised
 * 2026-07-12). A gutter reserves a fixed column and NARROWS the editor even
 * when empty; an inline mark decoration costs zero horizontal space, so the
 * editor keeps its full width. Commented text gets a subtle, clickable
 * highlight (`.aiditor-comment-mark`); click → popover. This is the
 * Google-Docs model: the commented span is the affordance, not a margin icon.
 *
 * Ranges are located by re-matching each active annotation's stored quote
 * (+prefix/suffix context) against the live document via anchor-core's
 * `matchQuote`, rebuilt on docChanged / viewportChanged / store change. A
 * quote that no longer matches simply drops out — its annotation is surfaced
 * as orphaned in the sidebar panel instead.
 */

import {
  Decoration,
  ViewPlugin,
  EditorView,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { matchQuote } from './anchor-core.ts';
import type { Annotation } from './model.ts';

const MARK_ATTR = 'data-aiditor-id';

export interface MarksHost {
  /** Active annotations whose notePath is the note currently shown to the user. */
  activeAnnotations: () => Annotation[];
  /** Open the popover for a clicked annotation, anchored to its highlighted `dom`. */
  onMarkClick: (annotationId: string, dom: HTMLElement) => void;
  /** Subscribe to store changes (resolve/reopen/delete/add); returns an unsubscribe. */
  onStoreChange: (listener: () => void) => () => void;
}

/** Dispatch to force a decoration rebuild without a doc change (store mutation / note switch). */
export const refreshAIditorMarksEffect = StateEffect.define<null>();

function buildDecorations(view: EditorView, host: MarksHost): DecorationSet {
  const text = view.state.doc.toString();
  const ranges: { from: number; to: number; id: string }[] = [];
  for (const a of host.activeAnnotations()) {
    const m = matchQuote(text, { quote: a.quote, prefix: a.prefix, suffix: a.suffix });
    if (!m || m.start >= m.end || m.end > text.length) continue;
    ranges.push({ from: m.start, to: m.end, id: a.id });
  }
  // RangeSet requires ascending order by `from` (then `to`).
  ranges.sort((x, y) => x.from - y.from || x.to - y.to);
  return Decoration.set(
    ranges.map((r) =>
      Decoration.mark({
        class: 'aiditor-comment-mark',
        attributes: { [MARK_ATTR]: r.id },
      }).range(r.from, r.to),
    ),
    true,
  );
}

class AIditorMarksPlugin implements PluginValue {
  decorations: DecorationSet;
  private unsubscribe: () => void;

  constructor(view: EditorView, readonly host: MarksHost) {
    this.decorations = buildDecorations(view, host);
    this.unsubscribe = host.onStoreChange(() => {
      view.dispatch({ effects: refreshAIditorMarksEffect.of(null) });
    });
  }

  update(update: ViewUpdate): void {
    const forced = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshAIditorMarksEffect)));
    if (update.docChanged || update.viewportChanged || forced) {
      this.decorations = buildDecorations(update.view, this.host);
    }
  }

  destroy(): void {
    this.unsubscribe();
  }
}

/**
 * The AIditor inline-highlight extension: a decoration ViewPlugin plus a
 * mousedown handler that opens the popover when a highlighted span is clicked.
 * Register once via `registerEditorExtension` in main.ts.
 */
export function aiditorMarksExtension(host: MarksHost) {
  return ViewPlugin.define((view) => new AIditorMarksPlugin(view, host), {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(this: AIditorMarksPlugin, event: MouseEvent) {
        const target = event.target as HTMLElement | null;
        const el = target?.closest(`[${MARK_ATTR}]`) as HTMLElement | null;
        if (!el) return false;
        const id = el.getAttribute(MARK_ATTR);
        if (!id) return false;
        event.preventDefault();
        this.host.onMarkClick(id, el);
        return true;
      },
    },
  });
}
