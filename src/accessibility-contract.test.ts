import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('./panel.ts', import.meta.url), 'utf8');
const popover = readFileSync(new URL('./popover.ts', import.meta.url), 'utf8');

test('annotation tabs and cards use native keyboard-operable buttons', () => {
  assert.match(panel, /createEl\('button', \{\s*cls: `aiditor-panel-tab/);
  assert.match(panel, /cls: 'aiditor-panel-item-main'/);
  assert.doesNotMatch(panel, /tabBtn = tabsEl\.createDiv/);
});

test('popover list and back controls use native buttons', () => {
  assert.match(popover, /listEl\.createEl\('button'/);
  assert.match(popover, /this\.el\.createEl\('button', \{\s*cls: 'aiditor-popover-back'/);
});
