import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tabLabelWithCount,
  emptyStateMessage,
  countsForNote,
  itemsForTab,
  truncate,
  relativeTime,
  PANEL_TABS,
} from './panel-core.ts';
import { emptyStore, type Annotation, type AnnotationStore } from './model.ts';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a-1',
    blockId: 'ai-abc123',
    notePath: 'Note.md',
    quote: 'hello world',
    prefix: 'before ',
    suffix: ' after',
    body: 'a comment',
    color: 'default',
    status: 'active',
    created: 1000,
    updated: 1000,
    resolvedAt: null,
    ...overrides,
  };
}

function storeWith(annotations: Annotation[]): AnnotationStore {
  return { ...emptyStore(), annotations };
}

describe('tabLabelWithCount', () => {
  it('formats the label with its live count', () => {
    assert.equal(tabLabelWithCount('active', 3), 'Active (3)');
    assert.equal(tabLabelWithCount('resolved', 0), 'Resolved (0)');
    assert.equal(tabLabelWithCount('orphaned', 12), 'Orphaned (12)');
  });
});

describe('emptyStateMessage', () => {
  it('returns the exact per-filter empty-state copy', () => {
    assert.equal(emptyStateMessage('active'), 'No active annotations');
    assert.equal(emptyStateMessage('resolved'), 'No resolved annotations');
    assert.equal(emptyStateMessage('orphaned'), 'No orphaned annotations');
  });
});

describe('PANEL_TABS', () => {
  it('is exactly Active, Resolved, Orphaned in that order', () => {
    assert.deepEqual(PANEL_TABS, ['active', 'resolved', 'orphaned']);
  });
});

describe('countsForNote', () => {
  it('counts per status scoped to the given note only', () => {
    const store = storeWith([
      makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'active' }),
      makeAnnotation({ id: 'a-2', notePath: 'A.md', status: 'active' }),
      makeAnnotation({ id: 'a-3', notePath: 'A.md', status: 'resolved' }),
      makeAnnotation({ id: 'a-4', notePath: 'A.md', status: 'orphaned' }),
      // Different note — must not leak into A.md's counts.
      makeAnnotation({ id: 'a-5', notePath: 'B.md', status: 'active' }),
    ]);
    assert.deepEqual(countsForNote(store, 'A.md'), { active: 2, resolved: 1, orphaned: 1 });
  });

  it('returns all-zero counts when there is no active note (never a global count)', () => {
    const store = storeWith([
      makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'active' }),
      makeAnnotation({ id: 'a-2', notePath: 'B.md', status: 'active' }),
    ]);
    assert.deepEqual(countsForNote(store, null), { active: 0, resolved: 0, orphaned: 0 });
  });

  it('is zero for a note with no annotations', () => {
    const store = storeWith([makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'active' })]);
    assert.deepEqual(countsForNote(store, 'Other.md'), { active: 0, resolved: 0, orphaned: 0 });
  });
});

describe('itemsForTab', () => {
  it('scopes to the active note only, per status', () => {
    const store = storeWith([
      makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'active' }),
      makeAnnotation({ id: 'a-2', notePath: 'B.md', status: 'active' }),
    ]);
    const items = itemsForTab(store, 'active', 'A.md');
    assert.deepEqual(items.map((a) => a.id), ['a-1']);
  });

  it('returns an empty array when there is no active note', () => {
    const store = storeWith([makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'active' })]);
    assert.deepEqual(itemsForTab(store, 'active', null), []);
  });

  it('returns an empty array for a note with no matching-status annotations', () => {
    const store = storeWith([makeAnnotation({ id: 'a-1', notePath: 'A.md', status: 'resolved' })]);
    assert.deepEqual(itemsForTab(store, 'active', 'A.md'), []);
  });
});

describe('truncate', () => {
  it('leaves short text untouched', () => {
    assert.equal(truncate('hello', 20), 'hello');
  });

  it('cuts long text and appends an ellipsis, respecting maxLen', () => {
    const result = truncate('a'.repeat(50), 10);
    assert.equal(result.length, 10);
    assert.ok(result.endsWith('…'));
  });

  it('collapses internal newlines/whitespace runs to single spaces', () => {
    assert.equal(truncate('line one\nline two\n\nline three', 100), 'line one line two line three');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;

  it('renders "just now" for sub-minute deltas', () => {
    assert.equal(relativeTime(now - 30_000, now), 'just now');
  });

  it('renders minutes for sub-hour deltas', () => {
    assert.equal(relativeTime(now - 5 * 60_000, now), '5m ago');
  });

  it('renders hours for sub-day deltas', () => {
    assert.equal(relativeTime(now - 2 * 60 * 60_000, now), '2h ago');
  });

  it('renders days for sub-week deltas', () => {
    assert.equal(relativeTime(now - 3 * 24 * 60 * 60_000, now), '3d ago');
  });

  it('renders weeks beyond a week', () => {
    assert.equal(relativeTime(now - 15 * 24 * 60 * 60_000, now), '2w ago');
  });

  it('clamps clock-skew (future) timestamps to "just now" rather than a negative label', () => {
    assert.equal(relativeTime(now + 60_000, now), 'just now');
  });
});
