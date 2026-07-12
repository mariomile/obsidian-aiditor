import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGutterMarkers, type VisibleLine } from './gutter-core.ts';

/** Build a VisibleLine[] from a flat doc, given the 0-based line numbers that are "visible". */
function visibleLines(doc: string, visible: number[]): VisibleLine[] {
  const lines = doc.split('\n');
  return visible.map((n) => ({ line: n, text: lines[n] ?? '' }));
}

describe('deriveGutterMarkers', () => {
  it('places a marker on the content line above a ^ai-id whose blockId has ≥1 active annotation', () => {
    const doc = ['A paragraph.', '', '^ai-abc123', '', 'Another.'].join('\n');
    const counts = new Map([['ai-abc123', 1]]);
    const result = deriveGutterMarkers(
      visibleLines(doc, [0, 1, 2, 3, 4]),
      (id) => counts.get(id) ?? 0,
    );
    const markers = result.filter((m) => m.kind === 'marker');
    assert.equal(markers.length, 1);
    assert.equal(markers[0]!.line, 0);
    assert.equal(markers[0]!.blockId, 'ai-abc123');
    assert.equal(markers[0]!.count, 1);
  });

  it('shows the count when a block has more than one active annotation', () => {
    const doc = ['A paragraph.', '^ai-abc123'].join('\n');
    const counts = new Map([['ai-abc123', 3]]);
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1]), (id) => counts.get(id) ?? 0);
    const marker = result.find((m) => m.kind === 'marker');
    assert.ok(marker);
    assert.equal(marker!.count, 3);
  });

  it('omits the marker when the blockId has zero active annotations', () => {
    const doc = ['A paragraph.', '^ai-abc123'].join('\n');
    const result = deriveGutterMarkers(visibleLines(doc, [0, 1]), () => 0);
    assert.equal(result.filter((m) => m.kind === 'marker').length, 0);
  });

  it('does NOT scan lines outside the visible ranges — a ^ai-id in a hidden range yields no marker', () => {
    const doc = ['Visible top.', '^ai-visible', 'Hidden middle.', '^ai-hidden', 'Visible bottom.'].join('\n');
    const counts = new Map([['ai-visible', 1], ['ai-hidden', 1]]);
    // Only lines 0,1 and 4 are visible; the hidden ^ai-hidden (line 3) is not scanned.
    const result = deriveGutterMarkers(
      visibleLines(doc, [0, 1, 4]),
      (id) => counts.get(id) ?? 0,
    );
    const markerIds = result.filter((m) => m.kind === 'marker').map((m) => m.blockId);
    assert.deepEqual(markerIds, ['ai-visible']);
  });
});
