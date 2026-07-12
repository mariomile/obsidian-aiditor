import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, DEFAULT_STORE_PATH } from './settings-core.ts';

describe('DEFAULT_SETTINGS', () => {
  it('defaults storePath to the design-spec sidecar path', () => {
    assert.equal(DEFAULT_SETTINGS.storePath, '_system/annotations/store.json');
  });

  it('has exactly the one documented settings key', () => {
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), ['storePath']);
  });

  it('DEFAULT_STORE_PATH matches DEFAULT_SETTINGS.storePath (single source of truth)', () => {
    assert.equal(DEFAULT_STORE_PATH, DEFAULT_SETTINGS.storePath);
  });
});
