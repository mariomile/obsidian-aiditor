import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBlockId,
  findBlockId,
  findAllBlockIds,
  standaloneBlockIdInsertion,
  matchQuote,
} from './anchor-core.ts';

describe('generateBlockId', () => {
  it('produces gl- prefix + 6-char base36 id', () => {
    const id = generateBlockId(() => 0.123456);
    assert.match(id, /^gl-[a-z0-9]{6}$/);
  });

  it('avoids collisions against an existing id set', () => {
    let calls = 0;
    // Force the first two draws to collide, third is free.
    const rand = () => {
      calls++;
      return calls <= 2 ? 0.5 : 0.999999;
    };
    const existing = new Set([generateBlockId(() => 0.5)]);
    const id = generateBlockId(rand, existing);
    assert.ok(!existing.has(id));
  });
});

describe('findBlockId', () => {
  it('finds a standalone ^gl-id line at the end of a block', () => {
    const lines = ['Some paragraph text.', '^gl-abc123', ''];
    const found = findBlockId(lines, 0);
    assert.equal(found, 'gl-abc123');
  });

  it('returns null when no block-id follows the block', () => {
    const lines = ['Some paragraph text.', '', 'Another paragraph.'];
    const found = findBlockId(lines, 0);
    assert.equal(found, null);
  });

  it('does not match an inline ^id (never trusted, standalone only)', () => {
    const lines = ['Some paragraph text. ^gl-inline1', ''];
    const found = findBlockId(lines, 0);
    assert.equal(found, null);
  });
});

describe('findAllBlockIds', () => {
  it('scans the whole doc for standalone ^gl-ids', () => {
    const lines = [
      'Para one.',
      '^gl-aaa111',
      '',
      'Para two.',
      '^gl-bbb222',
    ];
    const ids = findAllBlockIds(lines);
    assert.deepEqual([...ids].sort(), ['gl-aaa111', 'gl-bbb222']);
  });

  it('ignores non-glossa block ids', () => {
    const lines = ['Para.', '^other-id'];
    const ids = findAllBlockIds(lines);
    assert.deepEqual([...ids], []);
  });
});

// Apply a LineEdit to a lines array exactly as the coupled applier does, so
// tests can assert on the resulting document (not just the edit descriptor).
function applyLineEdit(lines: string[], edit: { fromLine: number; toLine: number; insert: string[] }): string[] {
  const before = lines.slice(0, edit.fromLine);
  const afterStart = edit.toLine >= edit.fromLine ? edit.toLine + 1 : edit.fromLine;
  const after = lines.slice(afterStart);
  return [...before, ...edit.insert, ...after];
}

describe('standaloneBlockIdInsertion', () => {
  it('inserts a blank line + standalone ^id line after a paragraph block', () => {
    const lines = ['First line.', 'Second line.', '', 'Next para.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 1 }, 'gl-x8k2p1');
    assert.deepEqual(edit, {
      fromLine: 2,
      toLine: 1,
      insert: ['', '^gl-x8k2p1'],
    });
  });

  it('inserts directly (no leading blank) when block is the last line of the doc', () => {
    const lines = ['Only paragraph.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 0 }, 'gl-zzz999');
    assert.deepEqual(edit, {
      fromLine: 1,
      toLine: 0,
      insert: ['', '^gl-zzz999'],
    });
  });

  it('does not insert inline even for hr/table blocks — always a standalone line', () => {
    const lines = ['| a | b |', '| - | - |', '| 1 | 2 |'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 2 }, 'gl-tbl001');
    assert.deepEqual(edit, {
      fromLine: 3,
      toLine: 2,
      insert: ['', '^gl-tbl001'],
    });
  });

  it('produces a correct document after a TABLE block — id standalone, table rows untouched', () => {
    const lines = ['| a | b |', '| - | - |', '| 1 | 2 |', '', 'After.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 2 }, 'gl-tbl001');
    const result = applyLineEdit(lines, edit);
    assert.deepEqual(result, ['| a | b |', '| - | - |', '| 1 | 2 |', '', '^gl-tbl001', '', 'After.']);
    // no table row was mutated to carry an inline ^id
    assert.ok(result.every((l) => !/\|.*\^gl-/.test(l)));
  });

  it('produces a correct document after an HR block — id on its own line, hr not mutated inline', () => {
    const lines = ['Intro.', '', '---', '', 'Outro.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 2, endLine: 2 }, 'gl-hr0001');
    const result = applyLineEdit(lines, edit);
    assert.deepEqual(result, ['Intro.', '', '---', '', '^gl-hr0001', '', 'Outro.']);
    // the hr line itself is still a bare '---', never '--- ^id'
    assert.equal(result[2], '---');
  });

  it('inserts correctly at end-of-file with NO trailing newline', () => {
    const text = 'Only paragraph, no trailing newline';
    const lines = text.split('\n');
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 0 }, 'gl-eof001');
    const result = applyLineEdit(lines, edit);
    assert.deepEqual(result, ['Only paragraph, no trailing newline', '', '^gl-eof001']);
    // re-joined, the id is a standalone line and the original text is intact
    assert.equal(result.join('\n'), 'Only paragraph, no trailing newline\n\n^gl-eof001');
  });

  it('inserts a standalone id line (blank-separated, composer convention) after a LIST ITEM block', () => {
    const lines = ['- first item', '- second item', '', 'After.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 1, endLine: 1 }, 'gl-li0001');
    const result = applyLineEdit(lines, edit);
    assert.deepEqual(result, ['- first item', '- second item', '', '^gl-li0001', '', 'After.']);
    // the id is standalone, never appended inline to a list marker line
    assert.ok(result.every((l) => !/^\s*[-*+].*\^gl-/.test(l)));
  });

  it('inserts a standalone id line (blank-separated) after a BLOCKQUOTE block', () => {
    const lines = ['> a quoted', '> paragraph', '', 'After.'];
    const edit = standaloneBlockIdInsertion(lines, { startLine: 0, endLine: 1 }, 'gl-bq0001');
    const result = applyLineEdit(lines, edit);
    assert.deepEqual(result, ['> a quoted', '> paragraph', '', '^gl-bq0001', '', 'After.']);
    // no blockquote line carries an inline ^id
    assert.ok(result.every((l) => !/^>.*\^gl-/.test(l)));
  });
});

describe('matchQuote', () => {
  it('finds an exact quote match using prefix/suffix context', () => {
    const text = 'Once upon a time there was a castle in the clouds.';
    const result = matchQuote(text, {
      quote: 'a castle',
      prefix: 'e there was ',
      suffix: ' in the clouds',
    });
    assert.ok(result);
    assert.equal(text.slice(result!.start, result!.end), 'a castle');
  });

  it('falls back to plain quote search when prefix/suffix do not match (text shifted)', () => {
    const text = 'Preamble added.\nOnce upon a time there was a castle in the clouds.';
    const result = matchQuote(text, {
      quote: 'a castle',
      prefix: 'WRONG PREFIX',
      suffix: 'WRONG SUFFIX',
    });
    assert.ok(result);
    assert.equal(text.slice(result!.start, result!.end), 'a castle');
  });

  it('returns null when the quote text no longer exists at all', () => {
    const text = 'Completely different content now.';
    const result = matchQuote(text, {
      quote: 'a castle',
      prefix: 'e there was ',
      suffix: ' in the clouds',
    });
    assert.equal(result, null);
  });

  it('disambiguates duplicate quotes using prefix/suffix context', () => {
    const text = 'red apple and green apple and blue apple.';
    const result = matchQuote(text, {
      quote: 'apple',
      prefix: 'green ',
      suffix: ' and blue',
    });
    assert.ok(result);
    assert.equal(text.slice(result!.start, result!.end), 'apple');
    assert.equal(text.slice(Math.max(0, result!.start - 6), result!.start), 'green ');
  });
});
