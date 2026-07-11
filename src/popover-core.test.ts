import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { annotationsForBlock, isSaveShortcut } from './popover-core.ts';
import { type Annotation } from './model.ts';

function ann(overrides: Partial<Annotation>): Annotation {
  return {
    id: 'a-1',
    blockId: 'gl-abc123',
    notePath: 'Note.md',
    quote: 'q',
    prefix: '',
    suffix: '',
    body: '',
    color: 'default',
    status: 'active',
    created: 1,
    updated: 1,
    resolvedAt: null,
    ...overrides,
  };
}

describe('annotationsForBlock', () => {
  it('returns every annotation sharing the block in the note, ordered by creation', () => {
    const all = [
      ann({ id: 'a-1', blockId: 'gl-x', created: 300 }),
      ann({ id: 'a-2', blockId: 'gl-x', created: 100 }),
      ann({ id: 'a-3', blockId: 'gl-y', created: 200 }),
      ann({ id: 'a-4', blockId: 'gl-x', notePath: 'Other.md', created: 50 }),
    ];
    const result = annotationsForBlock(all, 'gl-x', 'Note.md');
    assert.deepEqual(result.map((a) => a.id), ['a-2', 'a-1']);
  });

  it('ignores notePath scoping when notePath is undefined', () => {
    const all = [
      ann({ id: 'a-1', blockId: 'gl-x', notePath: 'A.md' }),
      ann({ id: 'a-2', blockId: 'gl-x', notePath: 'B.md' }),
    ];
    const result = annotationsForBlock(all, 'gl-x', undefined);
    assert.equal(result.length, 2);
  });

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(annotationsForBlock([ann({ blockId: 'gl-z' })], 'gl-x', 'Note.md'), []);
  });
});

describe('isSaveShortcut', () => {
  it('is true for Cmd+Enter (macOS)', () => {
    assert.equal(isSaveShortcut({ key: 'Enter', metaKey: true, ctrlKey: false }), true);
  });

  it('is true for Ctrl+Enter (Windows/Linux)', () => {
    assert.equal(isSaveShortcut({ key: 'Enter', metaKey: false, ctrlKey: true }), true);
  });

  it('is false for a plain Enter (newline in the textarea)', () => {
    assert.equal(isSaveShortcut({ key: 'Enter', metaKey: false, ctrlKey: false }), false);
  });

  it('is false for Cmd+other-key', () => {
    assert.equal(isSaveShortcut({ key: 'a', metaKey: true, ctrlKey: false }), false);
  });
});
