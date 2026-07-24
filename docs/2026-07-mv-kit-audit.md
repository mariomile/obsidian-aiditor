# mv-kit audit — AIditor (wave 11)

Audit of `styles.css` (496 lines pre-fix, 549 post-fix) + the UI code
(`src/popover.ts`, `src/panel.ts`, `src/create.ts`, `src/settings.ts`,
`src/reading.ts`, `src/marks.ts`) against
`obsidian-cosmos-theme/docs/mv-kit.md`, both desktop and phone columns.
Scope: coherence-only fixes (radius / type / icons / motion tokens / empty
states / microcopy). No layout redesign, no DOM restructure — per
`obsidian-cosmos-theme/docs/2026-07-24-suite-coherence-design.md` §C/D
non-goals.

Per-rule verdict: **pass** (already compliant) / **fixed** (this wave) /
**waived** (kit rule doesn't apply here, with reason).

**Two-stage wave.** An earlier, interrupted pass had already landed four
uncommitted fixes in `styles.css` (status chip / popover-empty /
list-header type tokens, the whisper recipe on the popover empty state, and
a documented round-cap waiver comment on `.aiditor-status`). Those are
credited as **fixed (stage 1)** below and were preserved verbatim — this
pass only added the residual gaps they hadn't reached, marked **fixed
(stage 2)**.

AIditor entered the wave already fairly token-native: it consumed 14
distinct suite tokens before this wave (the plugin was written after the
mv-kit existed). It now consumes 19, every one with a literal fallback
equal to the pre-fix value, so a Cosmos-less vault renders identically on
desktop.

## Golden rule — theme-independent consumption

| Check | Desktop | Phone | Verdict |
|---|---|---|---|
| Every `var(--cosmos-*)`/`var(--mv-*)` has a literal fallback | grep for `var(--cosmos-…)`/`var(--mv-…)` with no comma: **zero hits** post-fix | same file, same result | **pass** — including the three tokens added this wave (`--cosmos-r-floating-surface`, `--cosmos-touch-min`, `--cosmos-native`), each carrying the pre-fix literal as its fallback. |
| No plugin stylesheet redefines `--mv-*`/`--cosmos-*` at `:root`/`body` | `grep -c ':root' styles.css` → **0**; the file has no `:root`/`body` rule at all | same | **pass** — AIditor defines no custom properties of its own; it only ever consumes. `--mv-label-weight` / `--mv-label-track` (the two suite tokens the brief flagged) are consumed as `var(--mv-label-weight, 600)` / `var(--mv-label-track, 0.05em)`, whose fallbacks equal the canonical values in `cosmos-tokens.css` lines 105–106. Not defined, only read. |
| No token glob immediately followed by a slash inside a CSS comment | `grep -- '--[a-zA-Z0-9_-]*\*/'` → **zero hits**, including the comment stage 1 added on `.aiditor-status` (it writes `--cosmos-r-pill`, a whole token name, never the glob) | same | **pass** — no rewording needed; the stage-1 comment passes assertions (c) and (d) of `src/style-contract.test.ts` as written. The file-header comment at line 16 writes `--mv-* / --cosmos-*` with a space before the slash, which does not close the comment. |

## §1 Radius + surfaces

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.aiditor-popover` container radius | was `var(--mv-r-card, var(--radius-m, 11px))` — the card token on a floating surface | same rule, no phone variant | **fixed (stage 2)** — now `var(--cosmos-r-floating-surface, var(--mv-r-card, var(--radius-m, 11px)))`. Kit §1 names `--cosmos-r-floating-surface` for exactly this surface class ("Menus, popovers, floating panels"); the previous chain is preserved untouched as the fallback, so a Cosmos-less vault still renders 11px. |
| `.aiditor-popover-quote`, `.aiditor-popover-body`, `.aiditor-popover-btn`, `.aiditor-popover-list-item`, `.aiditor-panel-item`, `.aiditor-panel-item-action` radius (6 sites) | `var(--mv-r1, var(--radius-s, 6px))` | same | **pass** — already the suite chip/toolbar token with its canonical 6px fallback. |
| `.aiditor-status` (status badge) `border-radius: 999px` | fixed-height ~19px badge | same | **waived** — accepted, commented decision from stage 1: the round-cap idiom on a fixed tiny badge, not the tab-pill *surface* `--cosmos-r-pill` names (`--cosmos-r-pill` resolves to the tab radius, ~8px, which would visibly square this badge). Same waiver class as Sonar wave 1's grab-handle/badge-dot and Horizon wave 5's status dots. Left exactly as stage 1 left it. |
| `.aiditor-popover-send` `border-radius: 999px` on a 28×28px circular icon button | round-cap on a square box = circle | same | **waived** — same round-cap idiom; a circular submit affordance, not a pill/card/chip surface. |
| `.aiditor-comment-mark` `border-radius: 3px` (inline text highlight) | glyph-scale corner on an inline run | same | **waived** — an inline highlight run, not a surface in the kit's §1 vocabulary; forcing it onto `--mv-r-chip` (5px) would visibly balloon a 1.5px-underlined text span. Same waiver class as Horizon's `.horizon-chip__check` 3px checkbox glyph. |
| Elevation shadow on the floating surface | `box-shadow: var(--cosmos-pop-shadow, var(--shadow-l))` on `.aiditor-popover` | same | **pass** — the kit's §1 MUST verbatim: the suite pop elevation, with Obsidian's native `--shadow-l` as the Cosmos-less fallback. AIditor's only floating surface. |
| Hairline borders / card washes | `var(--mv-hairline, …)` ×5, `var(--mv-card-bg, …)` ×3, `var(--mv-card-bg-hover, …)` ×3 | same | **pass** — token-sourced throughout, no hand-picked rgba surfaces. |

## §2 Type sizes, icon sizes, touch targets

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.aiditor-status` micro-label size | was `font-size: 0.68rem` (a bespoke rem value) | same | **fixed (stage 1)** — now `var(--font-ui-smaller, 0.68rem)`. Kit §2 MUST NOT: "a plugin ships a bespoke micro-label font size … instead of `var(--font-ui-smaller)`". |
| `.aiditor-popover-list-header` micro-label size | was `font-size: 0.68rem` | same | **fixed (stage 1)** — now `var(--font-ui-smaller, 0.68rem)`. |
| `.aiditor-popover-empty` whisper size | was `font-size: 0.85em` | same | **fixed (stage 1)** — now `var(--font-ui-smaller, 0.85em)`. |
| `.aiditor-panel-empty` whisper size | was `font-size: 0.85em` — the one empty state stage 1 didn't reach | same | **fixed (stage 2)** — now `var(--font-ui-smaller, 0.85em)`. See §4. |
| **Touch targets** — `.aiditor-popover-send` (28×28px), `.aiditor-popover-btn` (~26px tall), `.aiditor-panel-item-action` (~26px tall), `.aiditor-panel-tab` (~28px tall), `.aiditor-popover-list-item` (~30px tall), `.aiditor-popover-back` (~18px tall) | unchanged — kit's desktop column is explicitly "N/A (no minimum enforced)" | **all six were below the 44px floor, with no phone-scoped rule anywhere in the file** (the only `@media` in the pre-fix file was `prefers-reduced-motion`) | **fixed (stage 2)** — a new `@media (pointer: coarse)` block gives `.aiditor-popover-send` `min-width`+`min-height: var(--cosmos-touch-min, 44px)` and the five row-shaped targets `min-height: var(--cosmos-touch-min, 44px)`. Row targets take height only: they already span the popover/panel width, so a `min-width` would be a no-op at best and a layout distortion at worst. Desktop geometry is untouched. |
| `.aiditor-comment-mark` (the inline highlight that opens the popover — technically the primary tap target) | inline text run | inline text run | **waived** — an inline span inside prose; its box is dictated by the text it wraps and cannot be given a 44px floor without breaking line layout. The kit's touch-min rule targets chrome controls (`.view-action`, `.clickable-icon`, toolbar options), not inline text runs. Mitigated in practice: tapping anywhere in the highlighted run opens the popover, and the run is a whole phrase, not a glyph. |
| Icon sizing (`.svg-icon`/`svg` at 14px/16px, 5 sites) | raw px on the SVG wrapper | same | **pass** — matches the kit's own §2 row ("Cosmos defines no separate icon-size scale"); icons are native `setIcon()` Lucide names (`unlink`, …). Same verdict class as Sonar wave 1 and Horizon wave 5. |
| Body/content type (`.aiditor-popover-quote` 0.85em, `.aiditor-popover-body` 0.9em, `.aiditor-popover-time` 0.75em, `.aiditor-panel-item-*` 0.75–0.85em) | relative `em` sizes on content, not micro-labels | same | **pass, not a §2 case** — the kit's type rule governs micro-labels and empty states specifically. These are body copy, quoted spans and timestamps inside a component that already sets its own scale; re-tokenizing them would be a typographic redesign, not a coherence fix. |

## §3 Motion

| Token / animation | Before | After | Verdict |
|---|---|---|---|
| All hover/wash transitions (`.aiditor-comment-mark`, `-popover-body`, `-popover-send`, `-popover-btn`, `-popover-list-item`, `-popover-back`, `-panel-tab`, `-panel-item`, `-panel-item-action`) | already `var(--cosmos-t-fast, 140ms) var(--mv-wash, cubic-bezier(0.25, 1, 0.5, 1))` for colour/background, `var(--mv-lift, cubic-bezier(0.22, 1, 0.36, 1))` for transform | unchanged | **pass** — AIditor shipped with the correct two-tier split already: `--mv-wash` for colour/background, `--mv-lift` for physical transform. 22 `--cosmos-t-fast` consumptions, 15 `--mv-wash`, 8 `--mv-lift`, all with literal fallbacks. |
| `aiditor-pop-in` popover entrance, desktop | `var(--cosmos-t-base, 180ms) var(--mv-lift, cubic-bezier(0.22, 1, 0.36, 1))` | unchanged | **pass** — the kit's desktop column has no chrome-entrance requirement, and `--cosmos-t-base` is exactly the "popover pop-in" duration tier. `--mv-lift` is the kit's physical reveal easing; a popover reveal is squarely in its remit on a fine pointer. |
| `aiditor-pop-in` popover entrance, **phone** | same desktop pairing — the kit's phone `cosmos-pop-in` MUST (`var(--cosmos-t-base) var(--cosmos-native)`) was unmet | `@media (pointer: coarse)` re-declares the animation as `var(--cosmos-t-base, 180ms) var(--cosmos-native, cubic-bezier(0.32, 0.72, 0, 1))` | **fixed (stage 2)** — the phone chrome-entrance pairing, verbatim. The *keyframe geometry* stays AIditor's own (`opacity` + `scale(0.97) translateY(-2px) → none`) rather than the kit's `translateY(4px) → none`: **waived** on geometry — both are opacity + a composited transform, and swapping the curve of an already-shipped entrance is a visual redesign, not a token substitution. What the kit's §3 MUST actually enforces (duration/easing come from tokens, never raw values) is now satisfied on both columns. |
| **Press-scale** (`--cosmos-press-scale`) | present on `.aiditor-popover-send:active`, `.aiditor-popover-btn:active`, `.aiditor-panel-item-action:active` — **absent** on `.aiditor-panel-tab`, `.aiditor-panel-item`, `.aiditor-popover-list-item`, `.aiditor-popover-back` | the four missing targets now scale on `:active` inside the `@media (pointer: coarse)` block, with `transform` appended to each one's existing base transition (`var(--cosmos-t-fast, 140ms) var(--mv-lift, …)`) | **fixed (stage 2)** — kit §3 MUST: "tap targets apply `transform: scale(var(--cosmos-press-scale, 0.98))` on active/press." Scoped to coarse pointers so desktop click behaviour is byte-identical (the appended `transform` transition is inert on desktop — nothing ever changes the transform there). `transform`-only, composited. |
| `prefers-reduced-motion: reduce` | one top-level block zeroing `.aiditor-popover`'s animation | **extended** — the coarse-pointer block re-declares that animation *after* the top-level override, so it carries its own nested `@media (prefers-reduced-motion: reduce)` that re-zeroes the animation and kills the transition on the four new press-scale targets | **fixed (extended)** — this is a real cascade trap, not belt-and-suspenders: without the nested block, a phone with reduced motion enabled would have had the entrance animation resurrected by the later, more specific `@media` re-declaration. Same class of extension TabX wave 4 and Horizon wave 5 applied. |
| Animated properties | `background`, `background-color`, `color`, `border-color`, `box-shadow`, `opacity`, `transform` | unchanged plus the new `transform` | **pass** — no layout-triggering property (`width`/`height`/`top`/`left`) is animated anywhere in the file, on any column. |
| `--cosmos-spring` (overshoot) | never used | unchanged | **pass** — correctly not reached for on hover or reveal. The plausible future candidate is the resolve/reopen confirmation, which currently re-renders statically; nothing to misuse it on today. |
| Raw `ms` / `cubic-bezier` outside a `var()` fallback | grep: **zero hits** pre- and post-fix | same | **pass** — mechanically enforced from this wave on by assertion (a) of `src/style-contract.test.ts`. |

## §4 Empty-state pattern

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.aiditor-popover-empty` ("No annotation.", "Annotation not found.") | was `color: var(--text-muted)` + `font-size: 0.85em` | same | **fixed (stage 1)** — now `color: var(--text-faint)` + `font-size: var(--font-ui-smaller, 0.85em)`, the kit's whisper recipe verbatim. |
| `.aiditor-panel-empty` ("Open a note to see its annotations.", per-tab empty copy) | was `color: var(--text-muted)` + `font-size: 0.85em` — the residual gap stage 1 didn't reach | same, no phone variant | **fixed (stage 2)** — now `color: var(--text-faint)` + `font-size: var(--font-ui-smaller, 0.85em)`. Kit §4 MUST NOT: "never `--text-normal` or a larger size (an empty state is not a call to action)"; `--text-muted` is a step above the whisper the recipe names. `text-align: center` and the padding are kept — the kit's recipe governs colour and size, not placement. |
| `.aiditor-popover-list-header` section eyebrow ("N annotations") | `font-size: var(--font-ui-smaller, 0.68rem)`, `font-weight: var(--mv-label-weight, 600)`, `text-transform: uppercase`, `letter-spacing: var(--mv-label-track, 0.05em)`, `color: var(--text-faint)` | same | **pass** (colour + size **fixed (stage 1)**, structure already correct) — the micro-label recipe, expressed through the suite's own label tokens rather than the raw literals the kit's §4 code block spells out. `--mv-label-weight: 600` / `--mv-label-track: 0.05em` are `cosmos-tokens.css` lines 105–106, i.e. the suite's canonical resolution of the recipe's `var(--font-medium)` / `0.06em`; consuming the token is strictly *more* coherent than re-typing the literal, and the fallbacks match. |
| `.aiditor-status` (status badge: ACTIVE / RESOLVED / ORPHANED) | uppercase + `--mv-label-track` + `--mv-label-weight` + `var(--font-ui-smaller)` | same | **pass** — a state badge rather than a section eyebrow, but it correctly reuses the same micro-label vocabulary instead of inventing a bespoke uppercase treatment. |
| Panel/popover copy that *isn't* an empty state (`(empty annotation)`, `(empty)` placeholders inside a populated row) | rendered inside `.aiditor-panel-item-body` / `.aiditor-popover-list-item-body`, i.e. normal row styling | same | **pass** — a populated row whose body happens to be blank is not a section empty state; it correctly reuses row styling rather than inventing a second empty pattern. Same verdict class as Sonar's "No matching command" disabled row. |

## §5 Microcopy voice

| Rule | Desktop | Phone | Verdict |
|---|---|---|---|
| No native `<select>` | `grep` for `createEl('select'` / `<select` across `src/`: **zero hits** | same | **pass** |
| No `mod-cta` on buttons | `grep -rn 'mod-cta' src/`: **zero hits** | same | **pass** — the affirmative action (`.aiditor-popover-btn--primary`, Resolve / Reopen / Re-anchor) is already the suite's "quiet primary": accent-tinted, not a loud solid CTA, as its own inline comment states. |
| English product copy, PM jargon untranslated | every UI string in `src/popover.ts`, `src/panel.ts`, `src/settings.ts` is English ("Write a comment…", "Anchor lost — re-anchor to a selection", "All annotations", "Re-anchor", "Delete", "Open a note to see its annotations.") | same | **pass** — AIditor is English end-to-end. No Italian-language carve-out to flag (contrast Horizon wave 5, which is Italian end-to-end and was waived). |
| Sentence-case labels | all of the above are sentence case; the sole uppercase surfaces are `.aiditor-status` and `.aiditor-popover-list-header`, both micro-labels | same | **pass** — micro-labels are §4's explicit uppercase exception. |
| `.mva-pv` / `.mva-sel` / `.mva-btn` form convention | `src/settings.ts` delegates entirely to Obsidian's native `Setting`/`PluginSettingTab` API (`new Setting(containerEl).setName('Annotation store path')…`), with no bespoke form | n/a | **pass, correctly out of scope** — same verdict as Sonar wave 1 and Horizon wave 5: the `.mva-*` convention governs *custom* plugin forms; there is no bespoke form here to normalize. AIditor's buttons (`.aiditor-popover-btn`, `.aiditor-panel-item-action`) are component chrome, not form controls. |
| Chip + popover pickers, never native `<select>` | AIditor has no picker controls of its own | same | **pass, not applicable** |

## `!important` audit

**Zero occurrences**, pre- and post-fix (`grep -c '!important' styles.css` → `0`). The
whole file wins on normal cascade — including the `:focus-visible` blocks,
which use `var(--cosmos-focus-ring, …)` on `outline` rather than fighting a
theme ring with `!important`. Assertion (b) of `src/style-contract.test.ts`
freezes the ceiling at exactly **0** (ratchet-down only): any future edit
that introduces an `!important` fails the contract test. This is the
strictest ceiling in the suite (Sonar 16, Horizon 5) and it is honest — no
fix in this wave needed one.

## Not touched (explicit non-goals, confirmed out of scope)

- No layout/DOM changes anywhere — every fix is a token substitution, a
  missing property on an existing selector, or a new pointer-scoped block
  that adds nothing on desktop.
- `.aiditor-container` / `.aiditor-hint` are dead rules (no `src/` reference
  to either class). Removing dead CSS is a cleanup, not a coherence fix, and
  would blur the wave's diff — flagged here, deliberately not touched.
- The `aiditor-pop-in` keyframe geometry (see §3) — the timing pairing is
  now kit-canonical on both columns; re-curving an already-shipped entrance
  is a visual decision for Mario, not an audit fix.
- Body/quote/timestamp type scale (see §2) — content typography, outside
  the kit's micro-label/empty-state remit.
- `.aiditor-comment-mark` touch floor (see §2) — an inline prose run cannot
  take a 44px minimum without breaking line layout.

## Verification

- `pnpm typecheck` — **0 errors** (`tsc --noEmit`, clean exit, no output).
- `pnpm test` — pre-fix and post-fix: **28 suites, 80 tests, 80 pass / 0
  fail** across the 6 existing test files (`anchor-core`, `panel-core`,
  `popover-core`, `settings-core`, `store-core`, `store`). The following
  commit adds `src/style-contract.test.ts` (**+1 suite, +4 tests** → 29
  suites, 84 tests, 84 pass / 0 fail).
- **There is no lint script in this repo.** `package.json` exposes `dev`,
  `build`, `release:check`, `typecheck`, `test` — no `lint`, and no eslint
  config or dependency. Reported as-is; none was invented or added for this
  wave.
- Desktop screenshot / live vault reload verification: **pending** — not
  performed this wave (no live vault-reload check run in this session).
- Phone verification: **pending Mario's on-device sign-off** — per hard
  constraint, Obsidian's `EmulateMobile` was **not** used (it persists in
  `localStorage` and kills Node-dependent plugins). Every phone verdict
  above was reached statically, by reading the resulting CSS and media
  queries against the kit's phone column.
