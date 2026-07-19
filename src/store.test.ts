import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { AnnotationVaultStore, STORE_PATH } from './store.ts';

function storeWith(write: (path: string, data: string) => Promise<void>): AnnotationVaultStore {
  const vault = {
    adapter: {
      exists: async () => true,
      mkdir: async () => undefined,
      read: async () => '',
      write,
    },
  } as unknown as Vault;
  return new AnnotationVaultStore(vault);
}

const annotation = {
  blockId: 'ai-test',
  notePath: 'Note.md',
  quote: 'Note',
  prefix: '',
  suffix: '',
  body: 'Review this',
  color: 'default',
};

describe('AnnotationVaultStore persistence', () => {
  it('recovers after a failed write instead of poisoning the queue', async () => {
    const writes: string[] = [];
    let fail = true;
    const store = storeWith(async (path, data) => {
      assert.equal(path, STORE_PATH);
      if (fail) {
        fail = false;
        throw new Error('disk unavailable');
      }
      writes.push(data);
    });

    store.addAnnotation(annotation);
    await assert.rejects(store.flush(), /disk unavailable/);
    await store.flush();

    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0]!).annotations.length, 1);
  });

  it('persists a mutation that arrives while an earlier snapshot is in flight', async () => {
    const writes: string[] = [];
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const store = storeWith(async (_path, data) => {
      writes.push(data);
      if (writes.length === 1) await firstWrite;
    });

    const id = store.addAnnotation(annotation);
    const firstFlush = store.flush();
    store.updateBody(id, 'Updated while saving');
    const secondFlush = store.flush();
    releaseFirst();
    await Promise.all([firstFlush, secondFlush]);

    assert.equal(writes.length, 2);
    assert.equal(JSON.parse(writes[0]!).annotations[0].body, 'Review this');
    assert.equal(JSON.parse(writes[1]!).annotations[0].body, 'Updated while saving');
  });
});
