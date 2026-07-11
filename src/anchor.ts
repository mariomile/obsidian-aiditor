/**
 * Applies anchor-core edits to real notes: reuses an existing standalone
 * ^gl-<id> for a block (never double-stamps), or computes + writes the
 * insertion. Writes go through the active editor (preserves cursor) when the
 * note is open in it, otherwise through `vault.modify`.
 *
 * HARD RULE: never touch frontmatter, never use the YAML-rewriting vault
 * helper that mangles wikilinks — the block-id marker only ever lands as a
 * standalone line in the body.
 */

import { MarkdownView as MarkdownViewClass, type App, type Editor, type MarkdownView, type TFile } from 'obsidian';
import {
  findBlockIdForBlock,
  generateBlockId,
  standaloneBlockIdInsertion,
  findAllBlockIds,
  type BlockSpan,
  type LineEdit,
} from './anchor-core.ts';
import type { AnnotationVaultStore } from './store.ts';

/** Result of ensuring a block has a ^gl-id: the id, plus whether it was newly stamped. */
export interface EnsuredBlockId {
  id: string;
  created: boolean;
}

/** Finds the MarkdownView currently editing `file`, if any (so edits preserve cursor). */
export function findOpenEditorFor(app: App, file: TFile): { view: MarkdownView; editor: Editor } | null {
  let found: { view: MarkdownView; editor: Editor } | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    const view = leaf.view;
    if (view instanceof MarkdownViewClass && view.file?.path === file.path) {
      found = { view, editor: view.editor };
    }
  });
  return found;
}

function lineEditToRange(lines: string[], edit: LineEdit): { fromLine: number; fromCh: number; toLine: number; toCh: number } {
  const fromLine = edit.fromLine;
  const fromCh = 0;
  // toLine === fromLine - 1 means pure insertion (no existing lines replaced).
  const hasExistingRange = edit.toLine >= edit.fromLine;
  const toLine = hasExistingRange ? edit.toLine : edit.fromLine;
  const toCh = hasExistingRange ? (lines[edit.toLine]?.length ?? 0) : 0;
  return { fromLine, fromCh, toLine, toCh };
}

/** Applies a LineEdit to editor text via a single replaceRange call. */
function applyLineEditToEditor(editor: Editor, lines: string[], edit: LineEdit): void {
  const range = lineEditToRange(lines, edit);
  const insertText = edit.insert.join('\n');
  if (edit.toLine < edit.fromLine) {
    // Pure insertion before fromLine: insert the new lines + trailing newline
    // at the very start of that line, pushing existing content down.
    editor.replaceRange(`${insertText}\n`, { line: range.fromLine, ch: 0 });
    return;
  }
  editor.replaceRange(insertText, { line: range.fromLine, ch: range.fromCh }, { line: range.toLine, ch: range.toCh });
}

/** Applies a LineEdit to a plain lines array, returning the new full text. */
function applyLineEditToLines(lines: string[], edit: LineEdit): string {
  const before = lines.slice(0, edit.fromLine);
  const afterStart = edit.toLine >= edit.fromLine ? edit.toLine + 1 : edit.fromLine;
  const after = lines.slice(afterStart);
  return [...before, ...edit.insert, ...after].join('\n');
}

export interface EnsureBlockIdDeps {
  app: App;
  file: TFile;
}

/**
 * Ensures `block` in `file` has a standalone ^gl-id, reusing an existing one
 * if present (never double-stamps). Writes via the open editor when the note
 * is active (preserving cursor), otherwise via vault.modify. Collision-checks
 * new ids against every ^gl-id already present in the note text.
 */
export async function ensureBlockId(
  { app, file }: EnsureBlockIdDeps,
  block: BlockSpan,
): Promise<EnsuredBlockId> {
  const open = findOpenEditorFor(app, file);
  const text = open ? open.editor.getValue() : await app.vault.read(file);
  const lines = text.split('\n');

  const existing = findBlockIdForBlock(lines, block);
  if (existing) return { id: existing, created: false };

  const existingIds = findAllBlockIds(lines);
  const id = generateBlockId(Math.random, existingIds);
  const edit = standaloneBlockIdInsertion(lines, block, id);

  if (open) {
    applyLineEditToEditor(open.editor, lines, edit);
  } else {
    const nextText = applyLineEditToLines(lines, edit);
    await app.vault.modify(file, nextText);
  }
  return { id, created: true };
}

/** Reads the note text for orphan-check purposes, preferring the live editor buffer. */
export async function readNoteText(app: App, file: TFile): Promise<string> {
  const open = findOpenEditorFor(app, file);
  if (open) return open.editor.getValue();
  return app.vault.read(file);
}

/**
 * Runs orphan recompute (design §6) for a single note: reads its text and
 * hands it to the store's pure recompute. Silently no-ops if the file can't
 * be read (e.g. deleted between events) — orphan-check must never throw.
 */
export async function recomputeOrphansForFile(app: App, store: AnnotationVaultStore, file: TFile): Promise<void> {
  try {
    const text = await readNoteText(app, file);
    store.recomputeOrphans(file.path, text);
  } catch {
    // Note unreadable right now — leave existing statuses as-is, try again
    // next time this note becomes active or the store reloads.
  }
}

/**
 * Wires orphan recompute to run on store load and on every active-note
 * change (design §6). Returns an unsubscribe function. Call once from
 * main.ts after the store has loaded.
 *
 * - Runs once immediately for whatever note is active right now.
 * - Re-runs on every `active-leaf-change` for the newly active markdown note.
 */
export function wireOrphanRecompute(app: App, store: AnnotationVaultStore): () => void {
  const runForActive = (): void => {
    const view = app.workspace.getActiveViewOfType(MarkdownViewClass);
    if (!view?.file) return;
    void recomputeOrphansForFile(app, store, view.file);
  };

  runForActive();
  const ref = app.workspace.on('active-leaf-change', () => runForActive());
  return () => app.workspace.offref(ref);
}
