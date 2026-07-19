/**
 * Vault-persisted annotation store. Wraps the pure store-core mutations and
 * persists the whole AnnotationStore to `_system/annotations/store.json`
 * (relative to whatever vault the plugin runs in) via `vault.adapter`.
 *
 * Writes are read-modify-write of the whole file, debounced so rapid
 * mutations coalesce (design §11 risk 3), plus an explicit flush() the
 * plugin calls on unload. Load tolerates a missing or corrupt file — it
 * never throws, it starts from an empty store.
 */

import type { Vault } from 'obsidian';
import { emptyStore, type Annotation, type AnnotationStatus, type AnnotationStore } from './model.ts';
import * as storeCore from './store-core.ts';
import type { NewAnnotationInput, ReanchorInput } from './store-core.ts';

export const ANNOTATIONS_DIR = '_system/annotations';
export const STORE_PATH = `${ANNOTATIONS_DIR}/store.json`;

const DEBOUNCE_MS = 500;

export type StoreChangeListener = (store: AnnotationStore) => void;

function isValidStore(value: unknown): value is AnnotationStore {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.annotations);
}

/**
 * Obsidian-coupled wrapper around store-core. Owns the in-memory
 * AnnotationStore, persists it to the vault adapter, and notifies
 * subscribers (gutter, panel) on every mutation.
 */
export class AnnotationVaultStore {
  private readonly vault: Vault;
  private store: AnnotationStore = emptyStore();
  private listeners = new Set<StoreChangeListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightWrite: Promise<void> | null = null;
  private revision = 0;
  private persistedRevision = 0;
  private queuedRevision = 0;
  private consecutiveFailures = 0;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /** Loads the store from disk. Missing or corrupt file → empty store, never throws. */
  async load(): Promise<void> {
    try {
      const adapter = this.vault.adapter;
      const exists = await adapter.exists(STORE_PATH);
      if (!exists) {
        this.store = emptyStore();
        return;
      }
      const raw = await adapter.read(STORE_PATH);
      const parsed: unknown = JSON.parse(raw);
      this.store = isValidStore(parsed) ? parsed : emptyStore();
    } catch {
      // Missing dir, malformed JSON, permission error, whatever — never crash boot.
      this.store = emptyStore();
    }
    this.notify();
  }

  /** Current in-memory snapshot. Callers must not mutate the returned object. */
  getStore(): AnnotationStore {
    return this.store;
  }

  getAll(): Annotation[] {
    return this.store.annotations;
  }

  getById(id: string): Annotation | undefined {
    return this.store.annotations.find((a) => a.id === id);
  }

  filterByStatus(status: AnnotationStatus, notePath?: string): Annotation[] {
    return storeCore.filterByStatus(this.store, status, notePath);
  }

  onChange(listener: StoreChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.store);
  }

  private setStore(next: AnnotationStore): void {
    this.store = next;
    this.revision++;
    this.consecutiveFailures = 0;
    this.notify();
    this.scheduleWrite();
  }

  addAnnotation(input: NewAnnotationInput): string {
    const now = Date.now();
    const { store, id } = storeCore.addAnnotation(this.store, input, now);
    this.setStore(store);
    return id;
  }

  updateBody(id: string, body: string): void {
    this.setStore(storeCore.updateBody(this.store, id, body, Date.now()));
  }

  resolve(id: string): void {
    this.setStore(storeCore.resolveAnnotation(this.store, id, Date.now()));
  }

  reopen(id: string): void {
    this.setStore(storeCore.reopenAnnotation(this.store, id, Date.now()));
  }

  delete(id: string): void {
    this.setStore(storeCore.deleteAnnotation(this.store, id));
  }

  reanchor(id: string, input: ReanchorInput): void {
    this.setStore(storeCore.reanchorAnnotation(this.store, id, input, Date.now()));
  }

  /** Runs orphan recompute for `notePath` given its current text. */
  recomputeOrphans(notePath: string, noteText: string): void {
    const next = storeCore.recomputeOrphans(this.store, notePath, noteText, Date.now());
    if (next === this.store) return; // no-op, avoid a spurious write/notify
    this.setStore(next);
  }

  private scheduleWrite(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush().catch((error: unknown) => {
        console.error('AIditor: failed to persist annotations', error);
      });
    }, DEBOUNCE_MS);
  }

  /**
   * Forces an immediate write of the current in-memory store, bypassing the
   * debounce. Safe to call repeatedly (coalesces with any write already in
   * flight). The plugin MUST call this on unload so no trailing debounced
   * write is lost.
   */
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.revision <= this.persistedRevision) return;
    if (this.revision <= this.queuedRevision && this.inFlightWrite) {
      await this.inFlightWrite;
      return;
    }

    // Capture the exact revision now. Later mutations queue a second snapshot
    // after this one instead of being incorrectly marked as persisted by it.
    const targetRevision = this.revision;
    const payload = JSON.stringify(this.store, null, 2);
    this.queuedRevision = targetRevision;
    const previous = this.inFlightWrite?.catch(() => undefined) ?? Promise.resolve();
    const run = previous
      .then(() => this.writeSnapshot(payload))
      .then(
        () => {
          this.persistedRevision = Math.max(this.persistedRevision, targetRevision);
          this.consecutiveFailures = 0;
        },
        (error: unknown) => {
          this.consecutiveFailures++;
          if (this.queuedRevision <= targetRevision) {
            this.queuedRevision = this.persistedRevision;
          }
          throw error;
        },
      );
    const tracked = run.finally(() => {
      if (this.inFlightWrite === tracked) this.inFlightWrite = null;
      if (
        this.revision > this.queuedRevision &&
        this.debounceTimer === null &&
        this.consecutiveFailures <= 3
      ) {
        this.scheduleWrite();
      }
    });
    this.inFlightWrite = tracked;
    await tracked;
  }

  private async writeSnapshot(payload: string): Promise<void> {
    const adapter = this.vault.adapter;
    const dirExists = await adapter.exists(ANNOTATIONS_DIR);
    if (!dirExists) await adapter.mkdir(ANNOTATIONS_DIR);
    await adapter.write(STORE_PATH, payload);
  }
}
