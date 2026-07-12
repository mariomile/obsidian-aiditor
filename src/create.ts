/**
 * The single createAnnotation flow all entry points funnel into (design §5):
 * command, gutter "+" affordance, and (indirectly, via a separate matching
 * path) the public API in api.ts. Reads the current selection or the block
 * under the caret, ensures a ^ai-id, captures quote+context, creates the
 * record as 'active', then hands off to a typed popover-open callback.
 */

import { MarkdownView, type App } from 'obsidian';
import { extractPrefix, extractSuffix, type BlockSpan } from './anchor-core.ts';
import { ensureBlockId } from './anchor.ts';
import type { AnnotationVaultStore } from './store.ts';

const CONTEXT_LEN = 32;

/**
 * Typed seam for slice B4: called after a new annotation is created, so the
 * popover can open pre-focused on the body editor. B4 owns the real
 * implementation; until then, callers may pass a no-op or a Notice-based stub.
 */
export interface OpenAnnotationPopover {
  (params: { annotationId: string; app: App }): void;
}

export interface CreateAnnotationDeps {
  app: App;
  store: AnnotationVaultStore;
  openPopover: OpenAnnotationPopover;
}

export class NoActiveNoteError extends Error {
  constructor() {
    super('AIditor: no active markdown note with an editor to annotate.');
    this.name = 'NoActiveNoteError';
  }
}

/** Finds the paragraph-ish block span containing `line`, by blank-line boundaries. */
function blockSpanAtLine(lines: string[], line: number): BlockSpan {
  let start = line;
  let end = line;
  while (start > 0 && lines[start - 1]!.trim() !== '') start--;
  while (end < lines.length - 1 && lines[end + 1]!.trim() !== '') end++;
  return { startLine: start, endLine: end };
}

/**
 * The createAnnotation flow: capture selection-or-caret-block, ensure a
 * ^ai-id, create the annotation record, and invoke the popover-open seam.
 * Returns the new annotation id.
 */
export async function createAnnotation({ app, store, openPopover }: CreateAnnotationDeps): Promise<string> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file) throw new NoActiveNoteError();
  const { editor, file } = view;

  const hasSelection = editor.somethingSelected();
  const fullText = editor.getValue();
  const cursor = editor.getCursor('from');

  // No selection: anchor to the block under the caret (blockSpanAtLine,
  // below), but keep `quote` itself to the caret's own line — a precise,
  // unambiguous span that matchQuote can relocate reliably. The block-id
  // still stamps the *whole* block, so the annotation still reads as
  // "attached to this block" per design §3/§5.
  const quote = hasSelection ? editor.getSelection() : editor.getLine(cursor.line);
  const quoteStartOffset = hasSelection
    ? editor.posToOffset(editor.getCursor('from'))
    : editor.posToOffset({ line: cursor.line, ch: 0 });
  const quoteEndOffset = quoteStartOffset + quote.length;

  const lines = fullText.split('\n');
  const block = blockSpanAtLine(lines, hasSelection ? editor.getCursor('from').line : cursor.line);

  const { id: blockId } = await ensureBlockId({ app, file }, block);

  const prefix = extractPrefix(fullText, quoteStartOffset, CONTEXT_LEN);
  const suffix = extractSuffix(fullText, quoteEndOffset, CONTEXT_LEN);

  const annotationId = store.addAnnotation({
    blockId,
    notePath: file.path,
    quote,
    prefix,
    suffix,
    body: '',
    color: 'default',
  });

  openPopover({ annotationId, app });
  return annotationId;
}
