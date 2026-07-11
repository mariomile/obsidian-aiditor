/**
 * Reading-view marker registration (design §5 "Reading view", §11.1 scoped
 * risk 1). INTENTIONAL STUB for MVP.
 *
 * TODO: Reading view renders block-id'd elements as plain `<span id="gl-...">`
 * anchors (or, for callouts/tables, nested inside the rendered structure)
 * with no stable, cheap way to associate them back to *our* wrapping block
 * short of walking the rendered DOM and re-deriving block boundaries from
 * scratch per post-process pass. Design §11.1 explicitly authorizes shipping
 * Live-Preview-only for MVP and landing this as a fast-follow rather than
 * sinking time into fiddly element matching now. When picked back up:
 *   1. Locate the element Obsidian renders for a line carrying `^gl-<id>`
 *      (MarkdownPostProcessor gets the rendered `el` + a `sourcePath`; block
 *      refs show up as `<*  id="gl-xxxxxx">` on the block's own element in
 *      most cases — verify across paragraph/list/callout/table).
 *   2. Insert a `.glossa-reading-marker` sibling/badge next to it, wired to
 *      the same popover used by the gutter (src/popover.ts).
 *   3. Re-run needs no debouncing (post-processors already re-run per render).
 *
 * Until then this registers honestly and does nothing — no half-working
 * element matching that silently drops annotations from view.
 */

import type { MarkdownPostProcessor } from 'obsidian';

/**
 * Returns the (currently no-op) MarkdownPostProcessor for reading-view
 * markers. Registered in main.ts via `registerMarkdownPostProcessor` so the
 * seam exists and is easy to fill in later without touching main.ts again.
 */
export function glossaReadingPostProcessor(): MarkdownPostProcessor {
  return (_el, _ctx) => {
    // TODO(reading-view markers): see module header. Deferred to fast-follow;
    // Live Preview (src/gutter.ts) is the supported MVP surface.
  };
}
