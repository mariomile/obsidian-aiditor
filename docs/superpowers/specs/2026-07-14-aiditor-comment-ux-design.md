# AIditor — Comment UX redesign (Notion-light)

**Date:** 2026-07-14
**Status:** design approved, pending spec review
**Scope:** medium, no data migration

## Context

AIditor is a margin-annotation engine (`^ai-id` block anchor + sidecar store,
states `active`/`resolved`/`orphaned`). The current annotation popover shows a
status chip, the quoted span, a body textarea, and Resolve/Delete. Two problems
surfaced in real use:

1. **The "ACTIVE" badge is noise.** Every annotation is born `active`, and the
   popover always renders that status chip — including on a brand-new comment.
   In a Notion/Google-Docs/Craft comment model, a comment has no "active" state;
   status only matters as open-vs-resolved.
2. **The composer does not open immediately.** The create flow awaits
   `ensureBlockId(...)` (a file write of the `^ai-id`) *before* opening the
   popover, and anchors via `coordsAtPos(head)` with a **center-screen
   fallback** — so the composer appears late and sometimes in the wrong place.

Reference feel: Notion (rounded input bar with a round ↑ submit) and Craft
(comment popover, inline "N comment" indicator).

## Decisions (locked)

- **Direction: Notion-light** — keep the current one-comment-per-mark data
  model (one `body` per annotation). No threads, no per-comment author, no
  schema migration. Threads/replies/author are explicitly **out of scope** (see
  Future).
- **Commit model: create-on-annotate, auto-delete-if-empty** — the record is
  created immediately (as today, mark shows at once); if the popover is
  dismissed with an empty (trimmed) body, the record + mark are auto-deleted.
- **Submit is snappy** — the first submit from Compose mode saves **and closes**
  the popover. Re-opening later (click the highlight) shows Saved mode.

## Behavior

### Create flow (fixes "doesn't open immediately")

1. Trigger unchanged: `aiditor:annotate-selection` (command / selection toolbar /
   AI panel).
2. Record created immediately with empty body (as today) → yellow mark appears.
3. Popover opens **optimistically and synchronously**, focus in the textarea,
   placeholder "Scrivi un commento…". Textarea focus must not wait on the
   `ensureBlockId` file write.
4. **Anchor robustly to the selection rectangle** (start/end of the selection),
   never the center-screen fallback. If a selection rect is unavailable, fall
   back to caret coords — never to screen center.
5. **Auto-discard empty:** on dismiss (outside mousedown / Esc / close) with a
   trimmed-empty body → delete the record + mark. No ghost comments.

### Two modes (one popover, different affordances)

- **Compose** (body empty): textarea + a round **↑ Send** button (accent,
  disabled while empty). `Enter` submits, `Shift+Enter` inserts a newline,
  `Cmd/Ctrl+Enter` also submits (kept for muscle memory).
  - First submit → save + **close** (snappy).
- **Saved** (body non-empty, reached by re-opening an existing comment):
  textarea pre-filled and editable + a footer with a muted **timestamp** on the
  left and **Resolve · Delete** on the right. This is the frame the user
  approved. Submit is consistent across modes: `Enter` (and `Cmd/Ctrl+Enter`)
  **saves and closes**; **blur saves without closing** (so no edit is ever
  lost); `Shift+Enter` is a newline.

### Status treatment (removes "Active")

- **active** (default): no status chip at all.
- **resolved**: no badge; the action becomes **Reopen** and the in-text mark
  dims (subtle signal), rather than a colored tag.
- **orphaned**: the *only* state that keeps a visible signal — a minimal inline
  warning row ("⚠ Ancoraggio perso — Re-anchor") plus the Re-anchor action,
  because a lost anchor is a real error condition, not a default state.

## Look (Notion/Craft, Cosmos-aligned)

- Reuse the Cosmos-aligned popover styling already landed (concentric radii,
  `--mv-hairline`, `--cosmos-pop-shadow`, focus ring, press-scale, wash motion),
  all with Obsidian-native fallbacks so AIditor stands alone.
- Add a round **↑ send** button (~28px, accent) at the bottom-right of the
  composer, Notion-style; disabled state when empty.
- Muted timestamp; quiet Resolve/Delete. The yellow highlight remains the
  persistent in-text affordance (Google-Docs model), unchanged.

## Components & boundaries

- **`src/popover-core.ts`** (pure, tested): `shouldDiscard(body): boolean`
  (trimmed-empty check) and a mode selector (`compose` vs `saved`) from the
  annotation state. No Obsidian imports.
- **`src/popover.ts`**: render compose/saved modes, the send button, timestamp,
  drop the status chip in active/resolved, orphaned-only warning, wire
  auto-discard-on-empty into `close()`, submit handling
  (Enter/Shift+Enter/Cmd+Enter/↑).
- **`src/main.ts`** (`openPopoverSeam`): build the anchor from the selection
  rectangle; remove the center-screen fallback path.
- **`styles.css`**: send button, compose/saved footer, resolved/orphaned minimal
  treatments.

## Testing

- `popover-core.test.ts`: `shouldDiscard` (empty, whitespace-only, non-empty),
  mode selection per status/body.
- Manual: typecheck, unit tests, and eyeball in Obsidian — create → type →
  Enter closes; reopen → Saved; dismiss-empty → mark gone; resolve dims the
  mark; orphaned shows the warning.

## Future (out of scope)

- Threaded comments / replies (multiple comments per mark, per-comment author +
  time). This is the Craft-full direction; it needs a sidecar-store migration.
- Craft-style inline "N comment · time" indicator beneath the block.
- Per-comment author identity / avatars (redundant in a solo vault today).
