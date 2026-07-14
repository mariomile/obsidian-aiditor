import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationsForBlock,
  isSaveShortcut,
  shouldDismissOnOutsideMousedown,
  shouldDiscardBody,
  selectPopoverMode,
  formatCommentTime,
} from './popover-core.ts';
import { type Annotation } from './model.ts';

function ann(overrides: Partial<Annotation>): Annotation {
  return {
    id: 'a-1',
    blockId: 'ai-abc123',
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
      ann({ id: 'a-1', blockId: 'ai-x', created: 300 }),
      ann({ id: 'a-2', blockId: 'ai-x', created: 100 }),
      ann({ id: 'a-3', blockId: 'ai-y', created: 200 }),
      ann({ id: 'a-4', blockId: 'ai-x', notePath: 'Other.md', created: 50 }),
    ];
    const result = annotationsForBlock(all, 'ai-x', 'Note.md');
    assert.deepEqual(result.map((a) => a.id), ['a-2', 'a-1']);
  });

  it('ignores notePath scoping when notePath is undefined', () => {
    const all = [
      ann({ id: 'a-1', blockId: 'ai-x', notePath: 'A.md' }),
      ann({ id: 'a-2', blockId: 'ai-x', notePath: 'B.md' }),
    ];
    const result = annotationsForBlock(all, 'ai-x', undefined);
    assert.equal(result.length, 2);
  });

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(annotationsForBlock([ann({ blockId: 'ai-z' })], 'ai-x', 'Note.md'), []);
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

describe('shouldDismissOnOutsideMousedown', () => {
  it('does NOT dismiss on the opening gesture (justOpened) — the bug fix', () => {
    // The click that opened the popover also fires an outside mousedown in the
    // same tick; it must be ignored, or the popover opens and vanishes at once.
    assert.equal(
      shouldDismissOnOutsideMousedown({ visible: true, justOpened: true, targetInsidePopover: false }),
      false,
    );
  });

  it('dismisses on a genuine outside mousedown once justOpened has cleared', () => {
    assert.equal(
      shouldDismissOnOutsideMousedown({ visible: true, justOpened: false, targetInsidePopover: false }),
      true,
    );
  });

  it('never dismisses when the mousedown is inside the popover', () => {
    assert.equal(
      shouldDismissOnOutsideMousedown({ visible: true, justOpened: false, targetInsidePopover: true }),
      false,
    );
  });

  it('never dismisses when the popover is not visible', () => {
    assert.equal(
      shouldDismissOnOutsideMousedown({ visible: false, justOpened: false, targetInsidePopover: false }),
      false,
    );
  });
});

describe('shouldDiscardBody', () => {
  it('treats empty and whitespace-only as discardable', () => {
    assert.equal(shouldDiscardBody(''), true);
    assert.equal(shouldDiscardBody('   \n\t '), true);
  });

  it('keeps a body with real content', () => {
    assert.equal(shouldDiscardBody('hi'), false);
  });
});

describe('selectPopoverMode', () => {
  it('is compose for an empty body', () => {
    assert.equal(selectPopoverMode(''), 'compose');
    assert.equal(selectPopoverMode('  '), 'compose');
  });

  it('is saved once a body exists', () => {
    assert.equal(selectPopoverMode('note'), 'saved');
  });
});

describe('formatCommentTime', () => {
  it('shows HH:MM on the same calendar day', () => {
    const created = new Date(2026, 2, 10, 19, 3).getTime();
    const now = new Date(2026, 2, 10, 22, 0).getTime();
    assert.equal(formatCommentTime(created, now), '19:03');
  });

  it('shows "D MMM" on a different day', () => {
    const created = new Date(2026, 2, 10, 19, 3).getTime();
    const now = new Date(2026, 2, 12, 9, 0).getTime();
    assert.equal(formatCommentTime(created, now), '10 Mar');
  });
});
