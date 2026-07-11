/**
 * Public API stub (design §7) — mirrors Exo's askExo cross-plugin pattern.
 * Consumers: app.plugins.plugins.glossa.addAnnotation({ notePath, quote, body }).
 *
 * STUB ONLY — no AI flow, no Exo coupling. Locates the quote in the note
 * text, stamps a ^gl-id after that block, creates an 'active' annotation,
 * and returns the new annotation id.
 */

import type { App } from 'obsidian';
import { extractPrefix, extractSuffix, matchQuote } from './anchor-core.ts';
import { ensureBlockId } from './anchor.ts';
import type { AnnotationVaultStore } from './store.ts';

const CONTEXT_LEN = 32;

export interface AddAnnotationInput {
  notePath: string;
  quote: string;
  body: string;
  color?: string;
}

export interface GlossaApiDeps {
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
export function createGlossaApi({ app, store }: GlossaApiDeps) {
  return {
    async addAnnotation(input: AddAnnotationInput): Promise<string> {
      const file = app.vault.getFileByPath(input.notePath);
      if (!file) {
        throw new Error(`Glossa.addAnnotation: no note found at path "${input.notePath}".`);
      }

      const text = await app.vault.read(file);
      const match = matchQuote(text, { quote: input.quote, prefix: '', suffix: '' });
      if (!match) {
        throw new Error(
          `Glossa.addAnnotation: quote not found in "${input.notePath}" — ` +
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
  };
}

export type GlossaApi = ReturnType<typeof createGlossaApi>;
