/**
 * Public API (design §7) — mirrors Exo's askExo cross-plugin pattern.
 * Consumers: app.plugins.plugins.aiditor.{addAnnotation,getAnnotations,resolveAnnotation}(...).
 *
 * Write path (addAnnotation): locates the quote in the note text, stamps a
 * ^ai-id after that block, creates an 'active' annotation, returns its id.
 * Read path (getAnnotations / resolveAnnotation): lets sibling plugins — Exo
 * first — read the comments Mario left and close them once acted on, so
 * annotations are legible and actionable to the AI, not locked in the sidecar.
 */

import type { App } from 'obsidian';
import { extractPrefix, extractSuffix, matchQuote } from './anchor-core.ts';
import { ensureBlockId } from './anchor.ts';
import type { Annotation } from './model.ts';
import { getAnnotations as getAnnotationsCore, type GetAnnotationsFilter } from './store-core.ts';
import type { AnnotationVaultStore } from './store.ts';

const CONTEXT_LEN = 32;

export type { GetAnnotationsFilter } from './store-core.ts';

export interface AddAnnotationInput {
  notePath: string;
  quote: string;
  body: string;
  color?: string;
}

export interface AIditorApiDeps {
  app: App;
  store: AnnotationVaultStore;
}

/** Finds the paragraph-ish block span containing the char at `offset`, by blank-line boundaries. */
function blockSpanAtOffset(lines: string[], offset: number): { startLine: number; endLine: number } {
  let running = 0;
  let line = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i]!.length;
    if (offset <= running + lineLen) {
      line = i;
      break;
    }
    running += lineLen + 1; // +1 for the '\n' joiner
    line = i;
  }
  let start = line;
  let end = line;
  while (start > 0 && lines[start - 1]!.trim() !== '') start--;
  while (end < lines.length - 1 && lines[end + 1]!.trim() !== '') end++;
  return { startLine: start, endLine: end };
}

/**
 * addAnnotation — the public, stub AI extension point. Rejects with a clear,
 * descriptive Error when the note path is unknown or the quote can't be
 * matched in the note text.
 */
export function createAIditorApi({ app, store }: AIditorApiDeps) {
  return {
    async addAnnotation(input: AddAnnotationInput): Promise<string> {
      const file = app.vault.getFileByPath(input.notePath);
      if (!file) {
        throw new Error(`AIditor.addAnnotation: no note found at path "${input.notePath}".`);
      }

      const text = await app.vault.read(file);
      const match = matchQuote(text, { quote: input.quote, prefix: '', suffix: '' });
      if (!match) {
        throw new Error(
          `AIditor.addAnnotation: quote not found in "${input.notePath}" — ` +
            `it may have been edited or the text does not match exactly.`,
        );
      }

      const lines = text.split('\n');
      const block = blockSpanAtOffset(lines, match.start);
      const { id: blockId } = await ensureBlockId({ app, file }, block);

      // Re-read: ensureBlockId may have modified the file (stamped a new id),
      // so re-derive prefix/suffix context from the freshest text if it wrote
      // to disk. If the note is open in an editor, ensureBlockId wrote there
      // instead and vault.read would be stale — but prefix/suffix are cosmetic
      // context only (quote is fully re-locatable via matchQuote), so use the
      // text we already matched against for offsets that are still valid.
      const prefix = extractPrefix(text, match.start, CONTEXT_LEN);
      const suffix = extractSuffix(text, match.end, CONTEXT_LEN);

      const annotationId = store.addAnnotation({
        blockId,
        notePath: input.notePath,
        quote: input.quote,
        prefix,
        suffix,
        body: input.body,
        color: input.color ?? 'default',
      });

      return annotationId;
    },

    /**
     * getAnnotations — the public read path. Returns the store's annotations
     * (canonical `Annotation` objects) filtered by note and status. With no
     * filter, returns every unresolved annotation across the vault. Read-only:
     * never mutates the store. Consumers must not mutate the returned objects.
     */
    getAnnotations(filter: GetAnnotationsFilter = {}): Annotation[] {
      return getAnnotationsCore(store.getStore(), filter);
    },

    /**
     * resolveAnnotation — the public action path. Marks an annotation resolved
     * by id so a sibling plugin (Exo) can close a comment once it has acted on
     * it. Returns `false` when no annotation with that id exists (nothing to
     * resolve), `true` when the transition was applied.
     */
    resolveAnnotation(id: string): boolean {
      if (!store.getById(id)) return false;
      store.resolve(id);
      return true;
    },
  };
}

export type AIditorApi = ReturnType<typeof createAIditorApi>;
