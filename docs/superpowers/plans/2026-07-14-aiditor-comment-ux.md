# AIditor Comment UX (Notion-light) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make leaving a comment feel like Notion — instant focused composer, no "Active" badge, snappy submit — without changing the one-comment-per-mark data model.

**Architecture:** Keep the existing singleton `AnnotationPopover` + sidecar store. Add pure, tested helpers in `popover-core.ts` for the compose/saved mode split, empty-discard rule, and timestamp. Rework `popover.ts` rendering into compose vs saved modes, wire empty-discard into `close()`, and anchor the create-flow popover to the selection rectangle. Show resolved marks dimmed so resolved comments stay reachable in-text.

**Tech Stack:** TypeScript, Obsidian API, CodeMirror 6, `@floating-ui/dom`, `node --test` (pure `*-core.ts` only).

## Global Constraints

- No data migration; the `Annotation` model is unchanged (`model.ts`).
- All `*-core.ts` files stay Obsidian-free and DOM-free (unit-testable with `node --test`).
- Styling consumes Cosmos tokens with Obsidian-native fallbacks (`var(--token, fallback)`); no hard-coded theme colors.
- Copy in English (product/UI). No em dashes in code comments/labels.
- Build deploys into the vault via `.obsidian-plugin-dir`; never hand-copy `main.js`.

---

### Task 1: Pure core helpers (mode, discard, timestamp)

**Files:**
- Modify: `src/popover-core.ts`
- Test: `src/popover-core.test.ts`

**Interfaces:**
- Produces:
  - `shouldDiscardBody(body: string): boolean`
  - `type PopoverMode = 'compose' | 'saved'`
  - `selectPopoverMode(body: string): PopoverMode`
  - `formatCommentTime(created: number, now: number): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/popover-core.test.ts`:

```ts
import { shouldDiscardBody, selectPopoverMode, formatCommentTime } from './popover-core.ts';

test('shouldDiscardBody: empty and whitespace-only are discardable', () => {
  assert.equal(shouldDiscardBody(''), true);
  assert.equal(shouldDiscardBody('   \n\t '), true);
  assert.equal(shouldDiscardBody('hi'), false);
});

test('selectPopoverMode: empty → compose, non-empty → saved', () => {
  assert.equal(selectPopoverMode(''), 'compose');
  assert.equal(selectPopoverMode('  '), 'compose');
  assert.equal(selectPopoverMode('note'), 'saved');
});

test('formatCommentTime: same calendar day → HH:MM', () => {
  const created = new Date(2026, 2, 10, 19, 3).getTime();
  const now = new Date(2026, 2, 10, 22, 0).getTime();
  assert.equal(formatCommentTime(created, now), '19:03');
});

test('formatCommentTime: other day → "D MMM"', () => {
  const created = new Date(2026, 2, 10, 19, 3).getTime();
  const now = new Date(2026, 2, 12, 9, 0).getTime();
  assert.equal(formatCommentTime(created, now), '10 Mar');
});
```

(Reuse the file's existing `import { test } from 'node:test'` / `import assert from 'node:assert/strict'` header; do not duplicate imports.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Dev\ Projects/obsidian-aiditor && npx tsx --test src/popover-core.test.ts` (or `pnpm test`)
Expected: FAIL — `shouldDiscardBody`/`selectPopoverMode`/`formatCommentTime` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/popover-core.ts`:

```ts
/** A trimmed-empty body means "no comment written yet" → discard on close. */
export function shouldDiscardBody(body: string): boolean {
  return body.trim().length === 0;
}

export type PopoverMode = 'compose' | 'saved';

/** Compose for a not-yet-written comment; Saved once it has a body. */
export function selectPopoverMode(body: string): PopoverMode {
  return shouldDiscardBody(body) ? 'compose' : 'saved';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Short comment timestamp: "HH:MM" when `created` is the same calendar day as
 * `now`, else "D MMM" (e.g. "10 Mar"). Locale-light and deterministic.
 */
export function formatCommentTime(created: number, now: number): string {
  const d = new Date(created);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS (all `popover-core` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/popover-core.ts src/popover-core.test.ts
git commit -m "feat(aiditor): pure helpers — compose/saved mode, empty-discard, comment time"
```

---

### Task 2: Popover compose/saved rendering, send button, drop Active badge

**Files:**
- Modify: `src/popover.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `selectPopoverMode`, `shouldDiscardBody`, `formatCommentTime` (Task 1); existing `store.updateBody/resolve/reopen/delete`, `this.actionBtn`, `this.renderDeleteControl`, `this.reanchor`.
- Produces: `this.bodyEl: HTMLTextAreaElement | null` (flushed by `close()` in Task 3).

- [ ] **Step 1: Import the helpers**

In `src/popover.ts`, extend the existing `popover-core` import:

```ts
import {
  annotationsForBlock,
  shouldDismissOnOutsideMousedown,
  shouldDiscardBody,
  selectPopoverMode,
  formatCommentTime,
} from './popover-core.ts';
```

Add the field to the class (near `private justOpened = false;`):

```ts
/** The live composer textarea while a single annotation is shown; null otherwise. */
private bodyEl: HTMLTextAreaElement | null = null;
```

- [ ] **Step 2: Reset `bodyEl` on every render**

At the very top of `render()` (before the branch logic), add:

```ts
this.bodyEl = null;
```

- [ ] **Step 3: Rewrite `renderAnnotation` into compose/saved modes**

Replace the whole `renderAnnotation(annotationId: string)` method body (from the back-link block onward) with:

```ts
  private renderAnnotation(annotationId: string): void {
    const { store } = this.deps;
    const a = store.getById(annotationId);
    if (!a) {
      this.el.createDiv({ cls: 'aiditor-popover-empty', text: 'Annotation not found.' });
      return;
    }

    // Back link when this annotation was reached from a multi-annotation block.
    if (this.blockScope) {
      const list = annotationsForBlock(store.getAll(), this.blockScope.blockId, this.blockScope.notePath);
      if (list.length > 1) {
        const back = this.el.createDiv({ cls: 'aiditor-popover-back', attr: { role: 'button' } });
        setIcon(back, 'chevron-left');
        back.createSpan({ text: 'All annotations' });
        this.registerDomEvent(back, 'click', () => {
          this.annotationId = null;
          this.render();
        });
      }
    }

    // Orphaned is the ONLY status that keeps a visible signal (a lost anchor is
    // an error condition, not a default). Active/resolved show no status chip.
    if (a.status === 'orphaned') {
      const warn = this.el.createDiv({ cls: 'aiditor-popover-warning' });
      setIcon(warn.createSpan({ cls: 'aiditor-popover-warning-icon' }), 'unlink');
      warn.createSpan({ text: 'Anchor lost — re-anchor to a selection' });
    }

    if (a.quote) {
      this.el.createDiv({ cls: 'aiditor-popover-quote', text: a.quote });
    }

    const mode = selectPopoverMode(a.body);

    const textarea = this.el.createEl('textarea', {
      cls: 'aiditor-popover-body',
      attr: { placeholder: 'Write a comment…' },
    });
    textarea.value = a.body;
    this.bodyEl = textarea;

    const saveAndClose = () => {
      store.updateBody(a.id, textarea.value);
      this.close();
    };
    this.registerDomEvent(textarea, 'blur', () => store.updateBody(a.id, textarea.value));
    this.registerDomEvent(textarea, 'keydown', (e) => {
      // Enter (and Cmd/Ctrl+Enter) submit; Shift+Enter is a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (shouldDiscardBody(textarea.value)) {
          this.close(); // empty → discarded by close()
          return;
        }
        saveAndClose();
      }
    });

    const footer = this.el.createDiv({ cls: 'aiditor-popover-footer' });

    if (mode === 'compose') {
      const send = footer.createEl('button', {
        cls: 'aiditor-popover-send',
        attr: { 'aria-label': 'Comment' },
      });
      setIcon(send, 'arrow-up');
      const syncSend = () => send.toggleClass('is-disabled', shouldDiscardBody(textarea.value));
      syncSend();
      this.registerDomEvent(textarea, 'input', syncSend);
      this.registerDomEvent(send, 'click', () => {
        if (shouldDiscardBody(textarea.value)) return;
        saveAndClose();
      });
    } else {
      footer.createSpan({ cls: 'aiditor-popover-time', text: formatCommentTime(a.created, Date.now()) });
      const actions = footer.createDiv({ cls: 'aiditor-popover-actions' });
      if (a.status === 'active') {
        this.actionBtn(actions, 'check', 'Resolve', () => {
          store.resolve(a.id);
          this.close();
        });
      } else if (a.status === 'resolved') {
        this.actionBtn(actions, 'rotate-ccw', 'Reopen', () => {
          store.reopen(a.id);
          this.render();
        });
      } else if (a.status === 'orphaned') {
        this.actionBtn(actions, 'link', 'Re-anchor', () => void this.reanchor(a.id));
      }
      this.renderDeleteControl(actions, a.id);
    }

    // Always focus in compose; also focus when the create flow requested it.
    if (this.focusBody || mode === 'compose') {
      this.focusBody = false;
      window.setTimeout(() => {
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }, 0);
    }
  }
```

- [ ] **Step 4: Hide the "active" chip in the picker list too**

In `renderList()`, guard the status span so a fresh/active item shows no chip:

```ts
      const item = listEl.createDiv({ cls: 'aiditor-popover-list-item' });
      if (a.status !== 'active') {
        item.createSpan({ cls: `aiditor-status aiditor-status--${a.status}`, text: a.status });
      }
      item.createSpan({ cls: 'aiditor-popover-list-item-body', text: a.body || a.quote || '(empty)' });
```

- [ ] **Step 5: Add the styles**

In `styles.css`, replace the old `.aiditor-popover-actions` rule block with a footer + send + time + warning set (keep the existing `.aiditor-popover-btn*` rules):

```css
.aiditor-popover-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}

.aiditor-popover-actions {
  display: flex;
  gap: 6px;
}

/* Notion-style round submit for a not-yet-written comment */
.aiditor-popover-send {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  cursor: pointer;
  transition: background var(--cosmos-t-fast, 140ms) var(--mv-wash, ease),
    transform var(--cosmos-t-fast, 140ms) var(--mv-lift, cubic-bezier(0.22, 1, 0.36, 1)),
    opacity var(--cosmos-t-fast, 140ms) var(--mv-wash, ease);
}

.aiditor-popover-send:hover {
  background: var(--interactive-accent-hover);
}

.aiditor-popover-send:active {
  transform: scale(var(--cosmos-press-scale, 0.98));
}

.aiditor-popover-send .svg-icon,
.aiditor-popover-send svg {
  width: 16px;
  height: 16px;
}

.aiditor-popover-send.is-disabled {
  opacity: 0.4;
  pointer-events: none;
}

.aiditor-popover-time {
  font-size: 0.75em;
  color: var(--text-faint);
}

/* Orphaned-only warning row */
.aiditor-popover-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  color: var(--color-orange, var(--text-error));
  margin-bottom: 8px;
}

.aiditor-popover-warning-icon {
  display: inline-flex;
}

.aiditor-popover-warning-icon .svg-icon,
.aiditor-popover-warning-icon svg {
  width: 14px;
  height: 14px;
}
```

Also remove the now-unused header emission: delete the `const header = this.el.createDiv({ cls: 'aiditor-popover-header' });` line and its `header.createSpan(... aiditor-status ...)` (already removed in Step 3's rewrite). Leave the `.aiditor-popover-header` / `.aiditor-status` CSS in place (still used by the picker list).

- [ ] **Step 6: Typecheck + manual verify**

Run: `pnpm build`
Expected: typecheck clean, esbuild writes `main.js` + `styles.css` into the vault.

Manual (in Obsidian, reload plugin): select text → annotate → composer opens focused, no "ACTIVE" chip, round ↑ send appears and enables once you type; Enter saves and closes.

- [ ] **Step 7: Commit**

```bash
git add src/popover.ts styles.css
git commit -m "feat(aiditor): compose/saved popover modes, round send, drop Active badge"
```

---

### Task 3: Auto-discard empty comment on close

**Files:**
- Modify: `src/popover.ts`

**Interfaces:**
- Consumes: `shouldDiscardBody` (Task 1), `this.bodyEl` (Task 2), `store.delete/updateBody`.

- [ ] **Step 1: Flush + discard in `close()`**

Replace the start of `close()` (before it sets `this.visible = false`) so it flushes the composer and discards an empty comment:

```ts
  close(): void {
    if (!this.visible) return;
    // Notion model: a comment left empty on dismiss is discarded (record + mark);
    // otherwise flush the composer so no edit is lost. Read the textarea directly
    // to avoid depending on the blur/mousedown ordering.
    if (this.annotationId && this.bodyEl) {
      const body = this.bodyEl.value;
      if (shouldDiscardBody(body)) {
        this.deps.store.delete(this.annotationId);
      } else {
        this.deps.store.updateBody(this.annotationId, body);
      }
    }
    this.bodyEl = null;
    this.visible = false;
    this.annotationId = null;
    this.blockScope = null;
    this.focusBody = false;
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.el.hide();
  }
```

- [ ] **Step 2: Typecheck + manual verify**

Run: `pnpm build`
Expected: clean.

Manual: annotate a selection, then press Esc / click outside without typing → the yellow mark disappears (empty record deleted). Annotate again, type, click outside → mark stays, body saved.

- [ ] **Step 3: Commit**

```bash
git add src/popover.ts
git commit -m "feat(aiditor): auto-discard empty comment on dismiss"
```

---

### Task 4: Robust selection-rect anchor (kills the open delay / mis-position)

**Files:**
- Modify: `src/main.ts` (`openPopoverSeam`)

**Interfaces:**
- Consumes: `this.popover.open(annotationId, anchor, { focusBody: true })`.

- [ ] **Step 1: Anchor to the selection rectangle, editor-viewport fallback**

Replace `openPopoverSeam` in `src/main.ts` with:

```ts
  private openPopoverSeam: OpenAnnotationPopover = ({ annotationId }) => {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = (view?.editor as unknown as {
      cm?: {
        coordsAtPos: (p: number) => { left: number; top: number; right: number; bottom: number } | null;
        state: { selection: { main: { from: number; to: number } } };
        scrollDOM: HTMLElement;
      };
    })?.cm;
    const anchor: VirtualElement = { getBoundingClientRect: () => this.selectionRect(cm) };
    this.popover.open(annotationId, anchor, { focusBody: true });
  };

  /** A DOMRect spanning the current selection; never the window center. */
  private selectionRect(cm: {
    coordsAtPos: (p: number) => { left: number; top: number; right: number; bottom: number } | null;
    state: { selection: { main: { from: number; to: number } } };
    scrollDOM: HTMLElement;
  } | undefined): DOMRect {
    if (cm) {
      const { from, to } = cm.state.selection.main;
      const a = cm.coordsAtPos(from);
      const b = cm.coordsAtPos(to) ?? a;
      if (a && b) {
        const left = Math.min(a.left, b.left);
        const top = Math.min(a.top, b.top);
        const right = Math.max(a.right, b.right);
        const bottom = Math.max(a.bottom, b.bottom);
        return new DOMRect(left, top, right - left, bottom - top);
      }
      const r = cm.scrollDOM?.getBoundingClientRect();
      if (r) return new DOMRect(r.left + 24, r.top + 24, 0, 0);
    }
    return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  }
```

- [ ] **Step 2: Typecheck + manual verify**

Run: `pnpm build`
Expected: clean.

Manual: annotate a selection near the top and near the bottom of a long note → the popover anchors next to the selection both times, not at screen center.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "fix(aiditor): anchor create-flow popover to the selection rect"
```

---

### Task 5: Show resolved marks dimmed (keep them reachable in-text)

**Files:**
- Modify: `src/marks.ts`
- Modify: `src/main.ts` (marksHost)
- Modify: `styles.css`

**Interfaces:**
- Produces: `MarksHost.visibleAnnotations: () => Annotation[]` (replaces `activeAnnotations`).

- [ ] **Step 1: Widen the host to active + resolved, tag resolved ranges**

In `src/marks.ts`, rename the host method and add a resolved class:

```ts
export interface MarksHost {
  /** Active + resolved annotations for the note currently shown to the user. */
  visibleAnnotations: () => Annotation[];
  onMarkClick: (annotationId: string, dom: HTMLElement) => void;
  onStoreChange: (listener: () => void) => () => void;
}
```

In `buildDecorations`, tag each range and pick the class:

```ts
function buildDecorations(view: EditorView, host: MarksHost): DecorationSet {
  const text = view.state.doc.toString();
  const ranges: { from: number; to: number; id: string; resolved: boolean }[] = [];
  for (const a of host.visibleAnnotations()) {
    const m = matchQuote(text, { quote: a.quote, prefix: a.prefix, suffix: a.suffix });
    if (!m || m.start >= m.end || m.end > text.length) continue;
    ranges.push({ from: m.start, to: m.end, id: a.id, resolved: a.status === 'resolved' });
  }
  ranges.sort((x, y) => x.from - y.from || x.to - y.to);
  return Decoration.set(
    ranges.map((r) =>
      Decoration.mark({
        class: r.resolved ? 'aiditor-comment-mark aiditor-comment-mark--resolved' : 'aiditor-comment-mark',
        attributes: { [MARK_ATTR]: r.id },
      }).range(r.from, r.to),
    ),
    true,
  );
}
```

- [ ] **Step 2: Supply active + resolved from main.ts**

In `src/main.ts`, update the `marksHost` object: rename `activeAnnotations` to `visibleAnnotations` and widen the filter:

```ts
      visibleAnnotations: () => {
        const notePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
        return this.store
          .getAll()
          .filter(
            (a) =>
              (a.status === 'active' || a.status === 'resolved') && (!notePath || a.notePath === notePath),
          );
      },
```

- [ ] **Step 3: Dim style for resolved marks**

In `styles.css`, after the `.aiditor-comment-mark:hover` rule add:

```css
/* Resolved comment: still reachable in-text, visually receded. */
.aiditor-comment-mark--resolved {
  background: transparent;
  border-bottom: 1px dashed hsla(var(--color-yellow-hsl, 45 90% 60%) / 0.4);
  opacity: 0.65;
}

.aiditor-comment-mark--resolved:hover {
  background: hsla(var(--color-yellow-hsl, 45 90% 60%) / 0.18);
  opacity: 1;
}
```

- [ ] **Step 4: Typecheck + manual verify**

Run: `pnpm build`
Expected: clean (no remaining `activeAnnotations` references — grep to be sure: `grep -rn activeAnnotations src` returns nothing).

Manual: resolve a comment → its highlight recedes to a dashed underline (not gone); clicking it reopens the popover in Saved mode with "Reopen".

- [ ] **Step 5: Commit**

```bash
git add src/marks.ts src/main.ts styles.css
git commit -m "feat(aiditor): keep resolved comments in-text, dimmed"
```

---

### Task 6: Full build + test gate

- [ ] **Step 1: Run the whole suite**

Run: `cd ~/Dev\ Projects/obsidian-aiditor && pnpm build && pnpm test`
Expected: typecheck clean; all tests pass (existing + Task 1's new ones).

- [ ] **Step 2: Grep for leftovers**

Run: `grep -rn "activeAnnotations\|aiditor-popover-header" src styles.css`
Expected: no `activeAnnotations`; `.aiditor-popover-header` only in CSS (picker list still uses `.aiditor-status`).

- [ ] **Step 3: Reload in Obsidian and walk the flow**

Create → type → Enter closes; reopen → Saved; dismiss-empty → mark gone; resolve → dashed/dim; orphaned → warning row + Re-anchor.

## Self-Review notes

- **Spec coverage:** create-immediate-open (Task 2 focus + Task 4 anchor), auto-discard-empty (Task 3), drop Active badge (Task 2 + list guard), resolved-dim (Task 5), orphaned-warning (Task 2), snappy submit (Task 2 Enter→saveAndClose), Notion send button (Task 2), Cosmos-aligned look (Task 2/5 CSS with fallbacks). All covered.
- **Type consistency:** `visibleAnnotations` used in both `marks.ts` and `main.ts` (Task 5). `bodyEl` defined Task 2, consumed Task 3. Pure helpers named identically in Task 1 and consumed in Tasks 2/3.
- **Out of scope (unchanged):** threads/replies, per-comment author, inline "N comment" pill.
