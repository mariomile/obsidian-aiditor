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

  // mv-kit §6 (Elevation & motion depth) — wave 2026-07 dinamica, per
  // docs/2026-07-mv-kit-audit.md's "§6 — wave 2026-07 dinamica" section.
  //
  // "A touch tap must never leave a stuck hover state — plugins must not
  // fight it with custom :hover outside @media (hover: hover) on
  // phone-reachable elements." All 12 of AIditor's `.aiditor-*:hover` rules
  // are phone-reachable (the highlight marks are tapped in the editor; the
  // popover/panel render on phone with no JS mobile-gating anywhere in
  // src/, confirmed by the existing @media (pointer: coarse) block already
  // targeting the same selectors) — a bare rule at the top level fires on
  // tap and leaves the wash "stuck" since touch has no pointer to leave.
  // Brace-depth scan (ported from obsidian-portal's equivalent assertion,
  // commit 133c93d): every unclosed `@media (hover: hover)` opener is
  // tracked by the CSS nesting depth it opened at; a `:hover` occurrence is
  // a violation unless it's currently inside one.
  it('§6: every :hover selector is gated behind @media (hover: hover)', () => {
    const lines = stripComments(css).split('\n');
    const violations: string[] = [];

    let depth = 0;
    const mediaStack: { openedAtDepth: number; isHoverGate: boolean }[] = [];

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      const mediaOpen = /^@media\s*\(([^)]*)\)\s*\{/.exec(line);
      if (mediaOpen) {
        mediaStack.push({
          openedAtDepth: depth,
          isHoverGate: /hover:\s*hover/.test(mediaOpen[1] ?? ''),
        });
      }

      if (/:hover\b/.test(line)) {
        const insideHoverGate = mediaStack.some((m) => m.isHoverGate);
        if (!insideHoverGate) {
          violations.push(`line ${idx + 1}: "${line}"`);
        }
      }

      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      depth += opens - closes;

      let top = mediaStack.at(-1);
      while (top !== undefined && depth <= top.openedAtDepth) {
        mediaStack.pop();
        top = mediaStack.at(-1);
      }
    });

    assert.deepEqual(violations, []);
  });

  // mv-kit §1 MUST (docs/mv-kit.md, "Radius + surfaces scale" table row for
  // --cosmos-pop-shadow): "plugins never hardcode elevation shadows for
  // floating surfaces — consume --cosmos-pop-shadow (or fall back to its
  // literal value) instead." A `var()` fallback that points at ANOTHER
  // var() (e.g. `var(--cosmos-pop-shadow, var(--shadow-l))`) is not a
  // literal — it fails silently in a Cosmos-less vault whenever the native
  // theme doesn't define that second token, and even when it does,
  // `--shadow-l` is a single-layer native shadow, structurally different
  // from the kit's 2-layer Pop-tier recipe (dark:
  // `rgba(0,0,0,.28) 0 12px 32px, rgba(0,0,0,.16) 0 2px 8px`, verbatim from
  // cosmos-tokens.css). `.aiditor-popover` is AIditor's only Pop-tier
  // surface (the comment popover, closes on outside-click) — this asserts
  // its fallback is the literal recipe, not a variable reference.
  it('§6/§1: the Pop-tier popover shadow falls back to a literal value, not another var()', () => {
    const code = stripComments(css);
    const match = /\.aiditor-popover\s*\{[^}]*\}/.exec(code);
    assert.ok(match, 'expected to find a .aiditor-popover rule block');

    const block = match![0];
    const shadowDecl = /box-shadow:\s*([^;]+);/.exec(block);
    assert.ok(shadowDecl, 'expected .aiditor-popover to declare box-shadow');

    const value: string = shadowDecl![1]!;
    assert.ok(
      value.includes('var(--cosmos-pop-shadow'),
      `expected box-shadow to consume --cosmos-pop-shadow, got: ${value}`,
    );

    // The fallback (everything after the first comma inside the outer
    // var(), up to its closing paren) must NOT itself be a var() reference.
    const fallbackMatch = /var\(\s*--cosmos-pop-shadow\s*,\s*([\s\S]+)\)$/.exec(value.trim());
    assert.ok(fallbackMatch, `expected a var(--cosmos-pop-shadow, <fallback>) shape, got: ${value}`);
    const fallback: string = fallbackMatch![1]!;
    assert.ok(
      !/^var\(/.test(fallback.trim()),
      `fallback must be a literal shadow value, not another var() reference: "${fallback}"`,
    );
    // Sanity: the literal actually looks like a 2-layer rgba shadow recipe.
    assert.ok(
      /rgba\(0,\s*0,\s*0,\s*0\.\d+\)\s+0(px)?\s+\d+(px)?\s+\d+(px)?/.test(fallback),
      `fallback doesn't look like the kit's 2-layer Pop-tier shadow recipe: "${fallback}"`,
    );
  });
});
