import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAnnotation,
  updateBody,
  resolveAnnotation,
  reopenAnnotation,
  deleteAnnotation,
  reanchorAnnotation,
  filterByStatus,
  recomputeOrphans,
} from './store-core.ts';
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

describe('addAnnotation', () => {
  it('is deterministic — same store + input + now yields the same id (no Math.random / no module state)', () => {
    const store = emptyStore();
    const input = {
      blockId: 'ai-abc123',
      notePath: 'Note.md',
      quote: 'hi',
      prefix: '',
      suffix: '',
      body: 'body text',
      color: 'default',
    };
    const a = addAnnotation(store, input, 5000);
    const b = addAnnotation(store, input, 5000);
    assert.equal(a.id, b.id);
    // and the id must be a-prefixed
    assert.match(a.id, /^a-/);
  });

  it('appends a new active annotation with created/updated timestamps', () => {
    const store = emptyStore();
    const result = addAnnotation(store, {
      blockId: 'ai-abc123',
      notePath: 'Note.md',
      quote: 'hi',
      prefix: '',
      suffix: '',
      body: 'body text',
      color: 'default',
    }, 5000);

    assert.equal(result.store.annotations.length, 1);
    const added = result.store.annotations[0]!;
    assert.equal(added.status, 'active');
    assert.equal(added.created, 5000);
    assert.equal(added.updated, 5000);
    assert.equal(added.resolvedAt, null);
    assert.equal(added.id, result.id);
    assert.match(added.id, /^a-/);
    // original store untouched (pure, no mutation)
    assert.equal(store.annotations.length, 0);
  });
});

describe('updateBody', () => {
  it('updates body text and bumps updated timestamp', () => {
    const store: AnnotationStore = { version: 1, annotations: [makeAnnotation()] };
    const next = updateBody(store, 'a-1', 'new body', 9999);
    assert.equal(next.annotations[0]!.body, 'new body');
    assert.equal(next.annotations[0]!.updated, 9999);
  });

  it('leaves the store unchanged if the id is not found', () => {
    const store: AnnotationStore = { version: 1, annotations: [makeAnnotation()] };
    const next = updateBody(store, 'missing', 'new body', 9999);
    assert.deepEqual(next, store);
  });
});

describe('resolveAnnotation / reopenAnnotation', () => {
  it('resolve sets status=resolved and resolvedAt', () => {
    const store: AnnotationStore = { version: 1, annotations: [makeAnnotation()] };
    const next = resolveAnnotation(store, 'a-1', 2000);
    assert.equal(next.annotations[0]!.status, 'resolved');
    assert.equal(next.annotations[0]!.resolvedAt, 2000);
    assert.equal(next.annotations[0]!.updated, 2000);
  });

  it('reopen clears resolvedAt and sets status=active', () => {
    const resolved: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ status: 'resolved', resolvedAt: 2000 })],
    };
    const next = reopenAnnotation(resolved, 'a-1', 3000);
    assert.equal(next.annotations[0]!.status, 'active');
    assert.equal(next.annotations[0]!.resolvedAt, null);
    assert.equal(next.annotations[0]!.updated, 3000);
  });

  it('reopen also works from orphaned status', () => {
    const orphaned: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ status: 'orphaned' })],
    };
    const next = reopenAnnotation(orphaned, 'a-1', 3000);
    assert.equal(next.annotations[0]!.status, 'active');
  });
});

describe('deleteAnnotation', () => {
  it('removes the annotation by id', () => {
    const store: AnnotationStore = { version: 1, annotations: [makeAnnotation(), makeAnnotation({ id: 'a-2' })] };
    const next = deleteAnnotation(store, 'a-1');
    assert.equal(next.annotations.length, 1);
    assert.equal(next.annotations[0]!.id, 'a-2');
  });

  it('is a no-op if the id does not exist', () => {
    const store: AnnotationStore = { version: 1, annotations: [makeAnnotation()] };
    const next = deleteAnnotation(store, 'nope');
    assert.equal(next.annotations.length, 1);
  });
});

describe('reanchorAnnotation', () => {
  it('rebinds an orphaned annotation to a fresh blockId/quote and reactivates it', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ status: 'orphaned', blockId: 'ai-old000' })],
    };
    const next = reanchorAnnotation(store, 'a-1', {
      blockId: 'ai-new111',
      quote: 'new quote',
      prefix: 'p',
      suffix: 's',
    }, 4000);
    const a = next.annotations[0]!;
    assert.equal(a.status, 'active');
    assert.equal(a.blockId, 'ai-new111');
    assert.equal(a.quote, 'new quote');
    assert.equal(a.prefix, 'p');
    assert.equal(a.suffix, 's');
    assert.equal(a.updated, 4000);
  });
});

describe('filterByStatus', () => {
  it('returns only annotations matching the given status', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [
        makeAnnotation({ id: 'a-1', status: 'active' }),
        makeAnnotation({ id: 'a-2', status: 'resolved' }),
        makeAnnotation({ id: 'a-3', status: 'active' }),
      ],
    };
    const active = filterByStatus(store, 'active');
    assert.deepEqual(active.map((a) => a.id), ['a-1', 'a-3']);
  });

  it('can further scope by notePath', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [
        makeAnnotation({ id: 'a-1', status: 'active', notePath: 'A.md' }),
        makeAnnotation({ id: 'a-2', status: 'active', notePath: 'B.md' }),
      ],
    };
    const active = filterByStatus(store, 'active', 'A.md');
    assert.deepEqual(active.map((a) => a.id), ['a-1']);
  });
});

describe('recomputeOrphans', () => {
  it('marks annotations orphaned when their blockId is missing from the note text', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [
        makeAnnotation({ id: 'a-1', notePath: 'Note.md', blockId: 'ai-present' }),
        makeAnnotation({ id: 'a-2', notePath: 'Note.md', blockId: 'ai-missing' }),
      ],
    };
    const noteText = 'Some text.\n^ai-present\n';
    const next = recomputeOrphans(store, 'Note.md', noteText, 6000);
    assert.equal(next.annotations.find((a) => a.id === 'a-1')!.status, 'active');
    assert.equal(next.annotations.find((a) => a.id === 'a-2')!.status, 'orphaned');
  });

  it('does not touch annotations for other notes', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ id: 'a-1', notePath: 'Other.md', blockId: 'ai-missing' })],
    };
    const next = recomputeOrphans(store, 'Note.md', 'no ids here', 6000);
    assert.equal(next.annotations[0]!.status, 'active');
  });

  it('does not resurrect a resolved annotation just because its blockId is present', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ id: 'a-1', notePath: 'Note.md', blockId: 'ai-present', status: 'resolved', resolvedAt: 10 })],
    };
    const next = recomputeOrphans(store, 'Note.md', '^ai-present', 6000);
    assert.equal(next.annotations[0]!.status, 'resolved');
  });

  it('re-activates an orphaned annotation when its blockId reappears in the note (re-anchoring detection)', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ id: 'a-1', notePath: 'Note.md', blockId: 'ai-present', status: 'orphaned' })],
    };
    const next = recomputeOrphans(store, 'Note.md', 'Some text.\n\n^ai-present\n', 7000);
    assert.equal(next.annotations[0]!.status, 'active');
    assert.equal(next.annotations[0]!.updated, 7000);
  });

  it('re-orphaning is idempotent — no timestamp churn when status does not change', () => {
    const store: AnnotationStore = {
      version: 1,
      annotations: [makeAnnotation({ id: 'a-1', notePath: 'Note.md', blockId: 'ai-missing', status: 'orphaned', updated: 42 })],
    };
    const next = recomputeOrphans(store, 'Note.md', 'no ids here', 6000);
    assert.equal(next.annotations[0]!.updated, 42);
  });
});
