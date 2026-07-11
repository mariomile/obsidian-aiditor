# Glossa — Design Spec

> Obsidian plugin. Durable-but-resolvable **margin annotations** anchored to blocks.
> A *gloss* is literally a marginal note. Family: Exo / Sonar / Cosmos (Latinate).
> Design locked with Mario 2026-07-11. This file is the source of truth for implementation.

---

## 1. What it does (job-to-be-done)

Attach a **comment/annotation to a specific block** in a note, *without mutating the block's prose*. The annotation lives with the note durably (survives edits, sync, reopen), can be **resolved** (archived, not deleted), and can be **reopened**. Primary use: self-review of drafts before publishing, and durable marginalia the author rereads months later.

Not in scope for MVP: multi-user, threading/replies, AI-generated annotations (only the extension point), a global cross-vault annotation browser, export.

## 2. Lifecycle (decided: hybrid "C")

An annotation has a `status`:

- `active` — shown as a gutter marker + in the panel's Active filter.
- `resolved` — hidden from the gutter; visible under the panel's Resolved filter; **reopenable**.
- `orphaned` — its anchor block/`^gl-id` no longer exists in the note; hidden from gutter; shown under the panel's Orphaned filter with the stored quote so it can be **re-anchored or deleted**.

Deletion is only ever explicit (never automatic). Resolving ≠ deleting.

## 3. Anchoring (decided: Strategy 1 — block-id + text-quote fallback)

Each annotated block gets an Obsidian block reference `^gl-<shortid>` on a **standalone line** (never inline — inline `^id` breaks `hr`/tables, known gotcha). The block-id is the **durable anchor**: it lives inside the file, so it survives edits and syncs to iPhone/iPad with zero external state.

As cheap insurance we **also** store a text-quote fallback (`quote` + `prefix`/`suffix` context, W3C-annotation style). If the `^gl-id` is deleted, the annotation becomes `orphaned` and the stored quote lets the user re-anchor instead of losing it.

**Block-id rules:**
- Generate `gl-` + 6-char base36 id (collision-checked against the store).
- Insert as a standalone line immediately after the target block, per composer/hr-safe convention. Reuse an existing block-id if the block already has one (don't double-stamp).
- Never touch frontmatter. Never use `processFrontMatter` (mangles wikilinks).

## 4. Storage (decided: central sidecar JSON)

Single file: `_system/annotations/store.json` in the vault. Rationale: keeps note frontmatter/body clean (only the tiny `^gl-id` marker lands in the note), Obsidian-Sync-friendly, no per-note-rename fragility (annotations are keyed by their own id + block-id, and the note is re-locatable by searching the block-id vault-wide if `notePath` goes stale). Single-user ⇒ last-write-wins is acceptable.

`store.json` shape:

```jsonc
{
  "version": 1,
  "annotations": [
    {
      "id": "a-<uuid>",           // annotation id (stable, primary key)
      "blockId": "gl-x8k2p1",     // the ^gl-id it anchors to (without the caret)
      "notePath": "Active/...md", // display + fast lookup; re-derivable via blockId search
      "quote": "the exact selected text",
      "prefix": "…up to 32 chars before…",
      "suffix": "…up to 32 chars after…",
      "body": "the annotation text (markdown)",
      "color": "default",          // reserved; single palette entry for MVP
      "status": "active",          // active | resolved | orphaned
      "created": 1720000000000,
      "updated": 1720000000000,
      "resolvedAt": null
    }
  ]
}
```

Timestamps: pass `Date.now()` at the call sites in coupled code only (pure cores never call it — they take timestamps as params, to stay testable).

## 5. Surfaces & interaction

**Create** — three entry points, all funnel into one `createAnnotation` flow:
1. Command "Glossa: Annotate selection" (with a rebindable hotkey).
2. A "＋" affordance on block hover in the gutter (Live Preview), near the composer gutter pattern.
3. Public API (§7) for future AI callers.

The flow: read the current selection (or the block under the caret if no selection), ensure the block has a `^gl-id`, capture `quote/prefix/suffix`, create the record `active`, open the popover pre-focused on the body editor.

**Gutter marker** — in Live Preview, blocks whose `^gl-id` has ≥1 `active` annotation show a subtle margin marker (count badge if >1). Click → popover.

**Popover** (`@floating-ui/dom`) — read/edit body, Resolve, Reopen, Delete, and (for orphans) Re-anchor to current selection. Theme-aware.

**Sidebar panel** (right-side `ItemView`, reuse Memory-Cockpit/Masonry view scaffolding) — lists annotations **for the active note**, with filter tabs Active / Resolved / Orphaned and counts. Click an item → scroll editor to the block + open popover. (A global cross-vault view is explicitly deferred.)

**Reading view** — secondary surface. Render markers on block-id'd elements via a `MarkdownPostProcessor`. If reliable element-matching proves fiddly, MVP may ship Live-Preview-only and land reading-view as a fast-follow; this is called out as a scoped risk, not silently dropped.

## 6. Orphan handling

On store load and on active-note change, verify each annotation's `^gl-id` still exists in its note (cheap: scan the note text for `^<blockId>`). Missing ⇒ mark `orphaned` (don't delete). The panel's Orphaned tab shows the stored `quote`; "Re-anchor" lets the user select new text and rebinds the annotation to a fresh `^gl-id`.

## 7. AI extension point (YAGNI — stub only)

Expose a public method on the plugin instance, mirroring Exo's `askExo` cross-plugin pattern:

```ts
// consumers: app.plugins.plugins.glossa.addAnnotation({ notePath, quote, body })
addAnnotation(input: { notePath: string; quote: string; body: string; color?: string }): Promise<string>
```

It locates the quote in the note, stamps a `^gl-id`, and creates an `active` annotation — returning the new annotation id. **Do not** build any AI flow, prompt UI, or Exo coupling in MVP. Just this method + a one-line note in the README that Exo can call it later.

## 8. Architecture — module breakdown

Mirror composer's convention: pure, Obsidian-free `*-core.ts` (with colocated `*.test.ts` run via `node --test`) separated from Obsidian-coupled `*.ts`.

| Module | Kind | Responsibility |
|---|---|---|
| `src/model.ts` | types | `Annotation`, `AnnotationStatus`, store shape |
| `src/anchor-core.ts` | **pure** | block-id generation, collision check, standalone-line insertion into a doc string, `^id` presence scan, text-quote (prefix/quote/suffix) match/relocate |
| `src/store-core.ts` | **pure** | CRUD + filters + status transitions over an in-memory store object; orphan-recompute given a note's text |
| `src/store.ts` | coupled | load/save `_system/annotations/store.json` via `vault.adapter`; wraps store-core; debounced writes |
| `src/anchor.ts` | coupled | apply anchor-core edits to the active editor / note file |
| `src/create.ts` | coupled | the createAnnotation flow (selection → anchor → record → popover) |
| `src/gutter.ts` | coupled | CM6 gutter/margin markers for Live Preview (＋ on hover, marker on annotated blocks) |
| `src/reading.ts` | coupled | MarkdownPostProcessor markers for Reading view (secondary) |
| `src/popover.ts` | coupled | floating-ui popover (view/edit/resolve/reopen/delete/re-anchor) |
| `src/panel.ts` | coupled | right-sidebar `ItemView` with Active/Resolved/Orphaned filters |
| `src/api.ts` | coupled | public `addAnnotation` |
| `src/settings.ts` | coupled | settings tab (store path override, gutter side, hotkey hint) |
| `src/main.ts` | coupled | plugin entry: wire store, register editor extension + post-processor + view + commands, expose API |

Pure cores that MUST have tests: `anchor-core` (id gen determinism given a seed/counter, collision avoidance, standalone-line insertion correctness on tricky docs incl. tables/hr, quote relocation on shifted text) and `store-core` (add/update/resolve/reopen/delete, filter-by-status, orphan recompute).

## 9. Build & project conventions (match the suite exactly)

- Package manager **pnpm**; `type: module`; author "Mario Miletta"; MIT.
- `esbuild.config.mjs` copied from composer (cjs, target es2021, externals include `obsidian`, `electron`, all `@codemirror/*`, node builtins; `.obsidian-plugin-dir` deploy; `production` arg minifies).
- `.obsidian-plugin-dir` → `/Users/mariomiletta/Vaults/marioverse.ai/.obsidian/plugins/glossa` (build deploys fresh `main.js` + `manifest.json` + `styles.css` there; the plugin still has to be enabled by Mario in Obsidian — do not auto-enable).
- `tsconfig.json` copied from composer (strict, noUncheckedIndexedAccess, Bundler resolution, lib ES2021+DOM).
- Scripts: `dev` (watch), `build` = `pnpm typecheck && node esbuild.config.mjs production`, `typecheck` = `tsc --noEmit`, `test` = `node --experimental-strip-types --test "src/**/*.test.ts"`.
- Deps to pin like composer: `@codemirror/state`, `@codemirror/view`, `@floating-ui/dom`, `obsidian`, `esbuild`, `typescript`, `@types/node`.
- `manifest.json`: `id: "glossa"`, `name: "Glossa"`, `minAppVersion: "1.10.0"`, `isDesktopOnly: true` for MVP (mobile is a documented fast-follow — the suite is desktop-first).
- `styles.css`: theme-aware, use Obsidian CSS variables; prefix classes `glossa-` (marker, popover, panel).
- `README.md`: what it is, the anchoring model, the AI extension point one-liner, dev/build instructions.
- `.gitignore` for `node_modules`, `main.js`, `*.map`.

## 10. Verification (what "done" means)

- `pnpm install` clean.
- `pnpm build` passes (tsc `--noEmit` + esbuild production, zero type errors).
- `pnpm test` passes (all `*-core.test.ts` green).
- No writes to the real vault other than the standard build deploy of `main.js`/`manifest.json`/`styles.css` into `.obsidian/plugins/glossa`. Never modify any real note or `_system/` file during the build/test.

## 11. Scoped risks (do not silently drop)

1. **Reading-view marker matching** may be fiddly (Obsidian's rendered block-id elements aren't trivially queryable). MVP may ship Live-Preview-only; if so, say it explicitly in the README + leave `reading.ts` stubbed with a TODO.
2. **Gutter block→line mapping** in CM6: markers are placed by scanning doc lines for `^gl-` refs; verify placement stays correct across folds and long docs.
3. **Store write races** (rapid create/resolve): debounce + read-modify-write the whole file; single-user makes this safe but keep writes atomic.
