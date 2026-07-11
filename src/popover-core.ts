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
