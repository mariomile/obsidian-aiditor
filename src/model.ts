/**
 * Shared types for Glossa annotations and the sidecar store.
 * Pure types only — no Obsidian imports, no runtime logic.
 */

export type AnnotationStatus = 'active' | 'resolved' | 'orphaned';

export interface Annotation {
  /** annotation id (stable, primary key), e.g. "a-<uuid>" */
  id: string;
  /** the ^gl-id it anchors to, WITHOUT the caret, e.g. "gl-x8k2p1" */
  blockId: string;
  /** display + fast lookup; re-derivable via blockId search if stale */
  notePath: string;
  /** the exact selected text */
  quote: string;
  /** up to 32 chars of context before the quote */
  prefix: string;
  /** up to 32 chars of context after the quote */
  suffix: string;
  /** the annotation text (markdown) */
  body: string;
  /** reserved; single palette entry for MVP */
  color: string;
  status: AnnotationStatus;
  created: number;
  updated: number;
  resolvedAt: number | null;
}

export interface AnnotationStore {
  version: 1;
  annotations: Annotation[];
}

export function emptyStore(): AnnotationStore {
  return { version: 1, annotations: [] };
}
