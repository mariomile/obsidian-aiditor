/**
 * Pure, Obsidian-free helpers for the annotation popover (design §5): pick the
 * annotations that share a block (so the popover can render a list when >1),
 * and classify the save keyboard shortcut. No DOM, no clock — unit-testable.
 */

import type { Annotation } from './model.ts';

/**
 * All annotations anchored to `blockId`, optionally scoped to `notePath`,
 * ordered oldest-first (stable reading order for the multi-annotation list).
 */
export function annotationsForBlock(
  all: readonly Annotation[],
  blockId: string,
  notePath: string | undefined,
): Annotation[] {
  return all
    .filter((a) => a.blockId === blockId && (notePath === undefined || a.notePath === notePath))
    .sort((a, b) => a.created - b.created);
}

/** True when the event is Cmd/Ctrl+Enter — the explicit "save body" shortcut. */
export function isSaveShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey);
}

/**
 * Whether an outside `mousedown` should dismiss the popover.
 *
 * Root-cause guard (bug 2026-07-12): every entry point that opens the popover
 * is itself a mouse gesture — clicking a highlighted span, a Composer menu
 * item, or a Selection Toolbar button. That gesture's own `mousedown` reaches
 * `document` while the popover is (or is becoming) visible and, being outside
 * the popover, would immediately dismiss it — so it opened and vanished in the
 * same click. `justOpened` marks the tick in which the popover opened; a
 * mousedown in that window is the opening gesture itself and must be ignored.
 * Real outside clicks on later ticks (justOpened cleared) still dismiss.
 */
export function shouldDismissOnOutsideMousedown(state: {
  visible: boolean;
  justOpened: boolean;
  targetInsidePopover: boolean;
}): boolean {
  return state.visible && !state.justOpened && !state.targetInsidePopover;
}
