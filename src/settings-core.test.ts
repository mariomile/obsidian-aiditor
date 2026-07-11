import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, DEFAULT_STORE_PATH } from './settings-core.ts';

describe('DEFAULT_SETTINGS', () => {
  it('defaults storePath to the design-spec sidecar path', () => {
    assert.equal(DEFAULT_SETTINGS.storePath, '_system/annotations/store.json');
  });

  it('defaults gutterSide to left', () => {
    assert.equal(DEFAULT_SETTINGS.gutterSide, 'left');
  });

  it('has exactly the two documented settings keys', () => {
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), ['gutterSide', 'storePath']);
  });

  it('DEFAULT_STORE_PATH matches DEFAULT_SETTINGS.storePath (single source of truth)', () => {
    assert.equal(DEFAULT_STORE_PATH, DEFAULT_SETTINGS.storePath);
  });
});
