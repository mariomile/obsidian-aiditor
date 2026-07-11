import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGutterMarkers, type VisibleLine } from './gutter-core.ts';

/** Build a VisibleLine[] from a flat doc, given the 0-based line numbers that are "visible". */
function visibleLines(doc: string, visible: number[]): VisibleLine[] {
  const lines = doc.split('\n');
  return visible.map((n) => ({ line: n, text: lines[n] ?? '' }));
}

describe('deriveGutterMarkers', () => {
  it('places a marker on the content line above a ^gl-id whose blockId has ≥1 active annotation', () => {
    const doc = ['A paragraph.', '', '^gl-abc123', '', 'Another.'].join('\n');
    const counts = new Map([['gl-abc123', 1]]);
    const result = deriveGutterMarkers(
      visibleLines(doc, [0, 1, 2, 3, 4]),
      (id) => counts.get(id) ?? 0,
    );
    const markers = result.filter((m) => m.kind === 'marker');
    assert.equal(markers.length, 1);
    assert.equal(markers[0]!.line, 0);
    assert.equal(markers[0]!.blockId, 'gl-abc123');
    assert.equal(markers[0]!.count, 1);
  });

  it('shows the count when a block has more than one active annotation', () => {
    const doc = ['A paragraph.', '^gl-abc123'].join('\n');
    const counts = new Map([['gl-abc123', 3]]);
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1]), (id) => counts.get(id) ?? 0);
    const marker = result.find((m) => m.kind === 'marker');
    assert.ok(marker);
    assert.equal(marker!.count, 3);
  });

  it('omits the marker when the blockId has zero active annotations', () => {
    const doc = ['A paragraph.', '^gl-abc123'].join('\n');
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1]), () => 0);
    assert.equal(result.filter((m) => m.kind === 'marker').length, 0);
  });

  it('does NOT scan lines outside the visible ranges — a ^gl-id in a hidden range yields no marker', () => {
    const doc = ['Visible top.', '^gl-visible', 'Hidden middle.', '^gl-hidden', 'Visible bottom.'].join('\n');
    const counts = new Map([['gl-visible', 1], ['gl-hidden', 1]]);
    // Only lines 0,1 and 4 are visible; the hidden ^gl-hidden (line 3) is not scanned.
    const result = deriveGutterMarkers(
      visibleLines(doc, [0, 1, 4]),
      (id) => counts.get(id) ?? 0,
    );
    const markerIds = result.filter((m) => m.kind === 'marker').map((m) => m.blockId);
    assert.deepEqual(markerIds, ['gl-visible']);
  });

  it('offers a ＋ affordance on a block-start line that has no ^gl-id yet', () => {
    const doc = ['First block.', '', 'Second block.'].join('\n');
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1, 2]), () => 0);
    const plusLines = result.filter((m) => m.kind === 'plus').map((m) => m.line).sort((a, b) => a - b);
    assert.deepEqual(plusLines, [0, 2]);
  });

  it('does not offer ＋ on a block that already carries an annotated marker', () => {
    const doc = ['Annotated block.', '^gl-abc123'].join('\n');
    const counts = new Map([['gl-abc123', 1]]);
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1]), (id) => counts.get(id) ?? 0);
    assert.equal(result.filter((m) => m.kind === 'plus' && m.line === 0).length, 0);
  });

  it('does not offer ＋ on the ^gl-id line itself or on blank lines', () => {
    const doc = ['Text.', '', '^gl-abc123'].join('\n');
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1, 2]), () => 0);
    const plusLines = result.filter((m) => m.kind === 'plus').map((m) => m.line);
    assert.ok(!plusLines.includes(1)); // blank
    assert.ok(!plusLines.includes(2)); // ^gl-id line
  });

  it('treats a block-start as the first non-blank line after a blank line or doc start', () => {
    // line 1 is a continuation of the block starting at line 0 → no ＋ on line 1
    const doc = ['Line one of block', 'line two of block', '', 'New block'].join('\n');
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1, 2, 3]), () => 0);
    const plusLines = result.filter((m) => m.kind === 'plus').map((m) => m.line).sort((a, b) => a - b);
    assert.deepEqual(plusLines, [0, 3]);
  });
});
