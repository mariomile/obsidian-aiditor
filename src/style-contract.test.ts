import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * mv-kit style contract (obsidian-cosmos-theme/docs/mv-kit.md).
 *
 * Ported from obsidian-horizon's node:test version (commit f9d9c99), itself
 * ported from obsidian-sonar's original (3acb417) — same four assertions,
 * same lineage as portal/masonry/tabx. Encodes only the state landed by the
 * wave-11 mv-kit audit (previous commit), not aspirational rules the audit
 * didn't actually fix. Full per-rule verdict: docs/2026-07-mv-kit-audit.md.
 */

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** Strip comments so prose in doc comments doesn't trip the raw-value scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('mv-kit style contract', () => {
  // Regression guard (mv-kit.md's own MUST NOT, ~lines 23-33): a comment
  // that writes a token glob immediately followed by a slash terminates the
  // comment early. Everything after it parses as garbage and the browser
  // DROPS the enclosing rule — this cost Sonar its `.sonar-modal { width:
  // 880px }` in the 2026-07 audit wave (af28344). Invisible to tsc, to
  // node:test and to the raw-value scan below, so it gets its own assertion.
  // AIditor is exposed here: styles.css carries prose comments that name
  // suite tokens (the file header, the .aiditor-status round-cap waiver).
  it('no CSS comment terminates early (token glob followed by a slash)', () => {
    const offenders = css
      .split('\n')
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /--[\w-]*\*\//.test(line));

    assert.deepEqual(offenders, []);
  });

  it('stripping comments leaves no orphaned prose (structural parse check)', () => {
    // If a comment closed early, its remaining lines survive the strip as
    // stray ` * ...` prose sitting in declaration position.
    const orphans = stripComments(css)
      .split('\n')
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /^\*\s|^\*$/.test(line));

    assert.deepEqual(orphans, []);
  });

  it('raw ms/hex/cubic-bezier values appear only as var() fallbacks', () => {
    const code = stripComments(css);
    const lines = code.split('\n');

    // A raw ms/hex/cubic-bezier is allowed ONLY when it sits inside a
    // `var(--token, <fallback>)` expression — i.e. the line contains a
    // var() with a fallback before the raw value. This is a line-level
    // heuristic (matching mv-kit.md's own "Audit procedure": grep for raw
    // values outside a var() fallback), not a full CSS parse.
    const rawMsPattern = /\b\d+ms\b/g;
    const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g;
    const rawCubicBezierPattern = /cubic-bezier\([^)]*\)/g;

    const violations: string[] = [];

    lines.forEach((line, idx) => {
      // Native Obsidian tokens count too (`var(--color-base-00, #fff)`) —
      // the contract's requirement is "never a bare value", not "only
      // --cosmos-*/--mv-* tokens may carry fallbacks".
      const hasVarFallback = /var\(\s*--[\w-]+\s*,/.test(line);

      for (const pattern of [rawMsPattern, rawHexPattern, rawCubicBezierPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          if (!hasVarFallback) {
            violations.push(`line ${idx + 1}: "${match[0]}" in "${line.trim()}"`);
          }
        }
      }
    });

    assert.deepEqual(violations, []);
  });

  it('caps !important declarations at the post-mv-kit-audit count (ratchet down only)', () => {
    const importantCount = (css.match(/!important;/g) ?? []).length;
    // Ceiling frozen at the exact post-fix count landed by the wave-11
    // mv-kit audit (2026-07): ZERO. AIditor wins every one of its rules on
    // normal cascade — including the :focus-visible blocks, which consume
    // var(--cosmos-focus-ring, …) on `outline` rather than fighting a theme
    // ring with !important. Strictest ceiling in the suite (Sonar 16,
    // Horizon 5). Any edit that introduces one fails this test; the ceiling
    // can only ratchet down.
    assert.ok(
      importantCount <= 0,
      `!important count ${importantCount} exceeds the frozen ceiling of 0`,
    );
  });
});
