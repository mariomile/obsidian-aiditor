/**
 * Pure, Obsidian-free helpers for the annotations panel (design §5): per-status
 * counts scoped to a note, per-filter empty-state copy, quote/body truncation,
 * and relative-timestamp formatting. No DOM, no Obsidian imports — the coupled
 * `panel.ts` ItemView calls these to decide what to render.
 */

import type { Annotation, AnnotationStatus } from './model.ts';
import { filterByStatus } from './store-core.ts';
import type { AnnotationStore } from './model.ts';

export const PANEL_TABS: AnnotationStatus[] = ['active', 'resolved', 'orphaned'];

const TAB_LABEL: Record<AnnotationStatus, string> = {
  active: 'Active',
  resolved: 'Resolved',
  orphaned: 'Orphaned',
};

const EMPTY_STATE_MESSAGE: Record<AnnotationStatus, string> = {
  active: 'No active annotations',
  resolved: 'No resolved annotations',
  orphaned: 'No orphaned annotations',
};

/** "Active (3)" — the tab label plus its live count, scoped to `notePath`. */
export function tabLabelWithCount(status: AnnotationStatus, count: number): string {
  return `${TAB_LABEL[status]} (${count})`;
}

/** The empty-state message for a given filter tab. */
export function emptyStateMessage(status: AnnotationStatus): string {
  return EMPTY_STATE_MESSAGE[status];
}

/**
 * Live counts for all three filter tabs, scoped to a single note. When
 * `notePath` is null (no active note), every count is 0 — the panel never
 * shows a global cross-vault count (design §1/§5).
 */
export function countsForNote(
  store: AnnotationStore,
  notePath: string | null,
): Record<AnnotationStatus, number> {
  const counts = { active: 0, resolved: 0, orphaned: 0 } as Record<AnnotationStatus, number>;
  if (notePath === null) return counts;
  for (const status of PANEL_TABS) {
    counts[status] = filterByStatus(store, status, notePath).length;
  }
  return counts;
}

/**
 * The annotations for one filter tab, scoped to `notePath`. Returns `[]`
 * when there is no active note — the panel never falls back to a
 * cross-vault listing (design §1/§5).
 */
export function itemsForTab(
  store: AnnotationStore,
  status: AnnotationStatus,
  notePath: string | null,
): Annotation[] {
  if (notePath === null) return [];
  return filterByStatus(store, status, notePath);
}

/** Truncates `text` to `maxLen` chars, appending an ellipsis when cut. Collapses newlines to spaces first. */
export function truncate(text: string, maxLen: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Coarse relative-time label ("2h ago", "just now", "3d ago"), given the
 * event timestamp (ms epoch) and the current time. Never returns a future
 * label — negative deltas (clock skew) clamp to "just now".
 */
export function relativeTime(timestampMs: number, nowMs: number): string {
  const deltaMs = nowMs - timestampMs;
  if (deltaMs < MINUTE) return 'just now';
  if (deltaMs < HOUR) return `${Math.floor(deltaMs / MINUTE)}m ago`;
  if (deltaMs < DAY) return `${Math.floor(deltaMs / HOUR)}h ago`;
  if (deltaMs < WEEK) return `${Math.floor(deltaMs / DAY)}d ago`;
  const weeks = Math.floor(deltaMs / WEEK);
  return `${weeks}w ago`;
}
