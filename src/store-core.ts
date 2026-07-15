/**
 * Pure CRUD + filters + status transitions over an in-memory AnnotationStore,
 * plus orphan recomputation given a note's text. No Obsidian imports, no clock —
 * callers inject the timestamp at the coupled call sites (src/store.ts, src/anchor.ts).
 */

import type { Annotation, AnnotationStatus, AnnotationStore } from './model.ts';
import { findAllBlockIds } from './anchor-core.ts';

/**
 * Derives a stable annotation id purely from the injected timestamp and the
 * store's current size — no clock read, no `Math.random`, no module-level
 * mutable state, so `addAnnotation` is deterministic and unit-testable.
 * The `seq` (existing annotation count) disambiguates multiple adds sharing
 * the same millisecond timestamp within one store.
 */
function newAnnotationId(now: number, seq: number): string {
  return `a-${now.toString(36)}-${seq.toString(36)}`;
}

export interface NewAnnotationInput {
  blockId: string;
  notePath: string;
  quote: string;
  prefix: string;
  suffix: string;
  body: string;
  color: string;
}

export interface AddAnnotationResult {
  store: AnnotationStore;
  id: string;
}

/** Appends a new `active` annotation. Pure — returns a new store, never mutates input. */
export function addAnnotation(
  store: AnnotationStore,
  input: NewAnnotationInput,
  now: number,
): AddAnnotationResult {
  const id = newAnnotationId(now, store.annotations.length);
  const annotation: Annotation = {
    id,
    blockId: input.blockId,
    notePath: input.notePath,
    quote: input.quote,
    prefix: input.prefix,
    suffix: input.suffix,
    body: input.body,
    color: input.color,
    status: 'active',
    created: now,
    updated: now,
    resolvedAt: null,
  };
  return { store: { ...store, annotations: [...store.annotations, annotation] }, id };
}

function mapAnnotation(
  store: AnnotationStore,
  id: string,
  fn: (a: Annotation) => Annotation,
): AnnotationStore {
  let changed = false;
  const annotations = store.annotations.map((a) => {
    if (a.id !== id) return a;
    changed = true;
    return fn(a);
  });
  if (!changed) return store;
  return { ...store, annotations };
}

export function updateBody(store: AnnotationStore, id: string, body: string, now: number): AnnotationStore {
  return mapAnnotation(store, id, (a) => ({ ...a, body, updated: now }));
}

export function resolveAnnotation(store: AnnotationStore, id: string, now: number): AnnotationStore {
  return mapAnnotation(store, id, (a) => ({ ...a, status: 'resolved', resolvedAt: now, updated: now }));
}

export function reopenAnnotation(store: AnnotationStore, id: string, now: number): AnnotationStore {
  return mapAnnotation(store, id, (a) => ({ ...a, status: 'active', resolvedAt: null, updated: now }));
}

export function deleteAnnotation(store: AnnotationStore, id: string): AnnotationStore {
  const annotations = store.annotations.filter((a) => a.id !== id);
  if (annotations.length === store.annotations.length) return store;
  return { ...store, annotations };
}

export interface ReanchorInput {
  blockId: string;
  quote: string;
  prefix: string;
  suffix: string;
}

/** Rebinds an (typically orphaned) annotation to a fresh block and reactivates it. */
export function reanchorAnnotation(
  store: AnnotationStore,
  id: string,
  input: ReanchorInput,
  now: number,
): AnnotationStore {
  return mapAnnotation(store, id, (a) => ({
    ...a,
    blockId: input.blockId,
    quote: input.quote,
    prefix: input.prefix,
    suffix: input.suffix,
    status: 'active',
    updated: now,
  }));
}

/** Filters by status, optionally further scoped to a single note path. */
export function filterByStatus(
  store: AnnotationStore,
  status: AnnotationStatus,
  notePath?: string,
): Annotation[] {
  return store.annotations.filter(
    (a) => a.status === status && (notePath === undefined || a.notePath === notePath),
  );
}

/**
 * The default status set for the public read API when a caller passes no
 * `status`: everything not yet resolved. An AI reader wants what still needs
 * attention (`active` marks that anchor to live text, `orphaned` marks whose
 * text was edited away) — never the archived resolved trail.
 */
export const OPEN_STATUSES: readonly AnnotationStatus[] = ['active', 'orphaned'];

export interface GetAnnotationsFilter {
  /** Restrict to a single note (vault path). Omit → all notes. */
  notePath?: string;
  /** Restrict to one or more statuses. Omit → {@link OPEN_STATUSES}. */
  status?: AnnotationStatus | AnnotationStatus[];
}

/**
 * Pure read query backing the public `getAnnotations` API. Applies the
 * status default policy (open set) and optional note scoping. Never mutates.
 */
export function getAnnotations(store: AnnotationStore, filter: GetAnnotationsFilter = {}): Annotation[] {
  const statuses = filter.status === undefined
    ? OPEN_STATUSES
    : Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
  const statusSet = new Set<AnnotationStatus>(statuses);
  return store.annotations.filter(
    (a) => statusSet.has(a.status) && (filter.notePath === undefined || a.notePath === filter.notePath),
  );
}

/**
 * For every non-resolved annotation belonging to `notePath`, checks whether its
 * blockId is still present in `noteText` (scanned via anchor-core's standalone
 * ^ai-id scanner). Missing → marked `orphaned`. Present again → `active`.
 * Resolved annotations are never touched (resolving is a separate, explicit
 * lifecycle transition — orphan recompute must not resurrect or re-orphan them).
 * Idempotent: no-op (no timestamp churn) when status would not change.
 */
export function recomputeOrphans(
  store: AnnotationStore,
  notePath: string,
  noteText: string,
  now: number,
): AnnotationStore {
  const presentIds = findAllBlockIds(noteText.split('\n'));
  let changed = false;
  const annotations = store.annotations.map((a) => {
    if (a.notePath !== notePath) return a;
    if (a.status === 'resolved') return a;
    const present = presentIds.has(a.blockId);
    const nextStatus: AnnotationStatus = present ? 'active' : 'orphaned';
    if (a.status === nextStatus) return a;
    changed = true;
    return { ...a, status: nextStatus, updated: now };
  });
  if (!changed) return store;
  return { ...store, annotations };
}
