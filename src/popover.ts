/**
 * The annotation popover (design §5): view/edit body, Resolve, Reopen,
 * Delete (with confirmation), and (for orphans) Re-anchor to the current
 * selection. When a block carries more than one annotation the popover shows
 * a selectable list; picking one drills into its editor. One singleton
 * instance is owned by main.ts and repositioned/refilled per open() call —
 * mirrors composer's ComposerMenu singleton-popover pattern.
 *
 * Positioning uses `@floating-ui/dom` `computePosition` with offset/flip/shift
 * middleware plus `autoUpdate` while open, so the popover tracks its anchor as
 * the editor scrolls or resizes. Dismisses on outside click and on Esc.
 * Theme-aware — colors come only from Obsidian CSS variables.
 */

import { Component, MarkdownView, Notice, setIcon, type App } from 'obsidian';
import { computePosition, autoUpdate, offset, flip, shift, type VirtualElement } from '@floating-ui/dom';
import { extractPrefix, extractSuffix, type BlockSpan } from './anchor-core.ts';
import { ensureBlockId } from './anchor.ts';
import {
  annotationsForBlock,
  shouldDismissOnOutsideMousedown,
  shouldDiscardBody,
  selectPopoverMode,
  formatCommentTime,
} from './popover-core.ts';
import type { AnnotationVaultStore } from './store.ts';

const CONTEXT_LEN = 32;

export interface PopoverDeps {
  app: App;
  store: AnnotationVaultStore;
}

export interface OpenOptions {
  /** Pre-focus the body editor (used when reached via the create flow). */
  focusBody?: boolean;
}

export class AnnotationPopover extends Component {
  private el: HTMLElement;
  private visible = false;
  private annotationId: string | null = null;
  /** When set, the popover is scoped to a block and may show a picker list. */
  private blockScope: { blockId: string; notePath: string | undefined } | null = null;
  private focusBody = false;
  private cleanupAutoUpdate: (() => void) | null = null;
  /** True only for the tick in which the popover opened — see show()/shouldDismissOnOutsideMousedown. */
  private justOpened = false;
  /** The live composer textarea while a single annotation is shown; null otherwise. */
  private bodyEl: HTMLTextAreaElement | null = null;

  constructor(private deps: PopoverDeps) {
    super();
    this.el = document.body.createDiv({ cls: 'aiditor-popover' });
    this.el.hide();

    this.registerDomEvent(document, 'mousedown', (e) => {
      if (
        shouldDismissOnOutsideMousedown({
          visible: this.visible,
          justOpened: this.justOpened,
          targetInsidePopover: this.el.contains(e.target as Node),
        })
      ) {
        this.close();
      }
    });
    this.registerDomEvent(document, 'keydown', (e) => {
      if (this.visible && e.key === 'Escape') this.close();
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  containsTarget(t: Node): boolean {
    return this.el.contains(t);
  }

  /** Opens (or refills, if already open) the popover for a single `annotationId`. */
  open(annotationId: string, anchor: VirtualElement, opts: OpenOptions = {}): void {
    this.annotationId = annotationId;
    this.blockScope = null;
    this.focusBody = opts.focusBody ?? false;
    this.show(anchor);
  }

  /**
   * Opens the popover scoped to a block: if the block has exactly one
   * annotation it drills straight in; if it has several it shows a picker.
   */
  openForBlock(blockId: string, notePath: string | undefined, anchor: VirtualElement, opts: OpenOptions = {}): void {
    const list = annotationsForBlock(this.deps.store.getAll(), blockId, notePath);
    this.blockScope = { blockId, notePath };
    this.focusBody = opts.focusBody ?? false;
    this.annotationId = list.length === 1 ? list[0]!.id : null;
    this.show(anchor);
  }

  private show(anchor: VirtualElement): void {
    this.render();
    this.el.show();
    this.visible = true;
    // Ignore the opening gesture's own outside-mousedown; clear on the next tick
    // so genuine later outside clicks still dismiss (see the document handler).
    this.justOpened = true;
    window.setTimeout(() => {
      this.justOpened = false;
    }, 0);
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = autoUpdate(anchor, this.el, () => this.position(anchor));
  }

  private position(anchor: VirtualElement): void {
    void computePosition(anchor, this.el, {
      placement: 'right-start',
      middleware: [offset(8), flip({ fallbackPlacements: ['left-start', 'bottom-start'] }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (!this.visible) return;
      this.el.style.left = `${x}px`;
      this.el.style.top = `${y}px`;
    });
  }

  close(): void {
    if (!this.visible) return;
    // Notion model: a comment left empty on dismiss is discarded (record + mark);
    // otherwise flush the composer so no edit is lost. Read the textarea directly
    // to avoid depending on blur/mousedown ordering.
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

  private render(): void {
    this.el.empty();
    this.bodyEl = null;

    // Block-scoped with multiple annotations and none selected yet → picker.
    if (this.blockScope && this.annotationId === null) {
      this.renderList();
      return;
    }
    if (!this.annotationId) {
      this.el.createDiv({ cls: 'aiditor-popover-empty', text: 'No annotation.' });
      return;
    }
    this.renderAnnotation(this.annotationId);
  }

  private renderList(): void {
    const { store } = this.deps;
    const scope = this.blockScope!;
    const list = annotationsForBlock(store.getAll(), scope.blockId, scope.notePath);
    if (list.length === 0) {
      this.el.createDiv({ cls: 'aiditor-popover-empty', text: 'No annotation.' });
      return;
    }
    this.el.createDiv({ cls: 'aiditor-popover-list-header', text: `${list.length} annotations` });
    const listEl = this.el.createDiv({ cls: 'aiditor-popover-list' });
    for (const a of list) {
      const item = listEl.createDiv({ cls: 'aiditor-popover-list-item' });
      // No chip for the default "active" state; only resolved/orphaned carry one.
      if (a.status !== 'active') {
        item.createSpan({ cls: `aiditor-status aiditor-status--${a.status}`, text: a.status });
      }
      item.createSpan({ cls: 'aiditor-popover-list-item-body', text: a.body || a.quote || '(empty)' });
      this.registerDomEvent(item, 'click', () => {
        this.annotationId = a.id;
        this.render();
      });
    }
  }

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
      // Enter (and Cmd/Ctrl+Enter) submit; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (shouldDiscardBody(textarea.value)) {
          this.close(); // empty → close() discards the record + mark
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

    // Focus the composer in compose mode, and whenever the create flow asked.
    if (this.focusBody || mode === 'compose') {
      this.focusBody = false;
      window.setTimeout(() => {
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }, 0);
    }
  }

  /** Delete is explicit only: first click arms a confirm, second click deletes. */
  private renderDeleteControl(parent: HTMLElement, annotationId: string): void {
    const btn = parent.createEl('button', {
      cls: 'aiditor-popover-btn aiditor-popover-btn--danger',
      attr: { 'aria-label': 'Delete' },
    });
    setIcon(btn, 'trash-2');
    const label = btn.createSpan({ text: 'Delete' });
    let armed = false;
    this.registerDomEvent(btn, 'click', () => {
      if (!armed) {
        armed = true;
        btn.addClass('is-armed');
        label.setText('Confirm delete');
        return;
      }
      this.deps.store.delete(annotationId);
      this.close();
    });
  }

  private actionBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const btn = parent.createEl('button', {
      cls: 'aiditor-popover-btn aiditor-popover-btn--primary',
      attr: { 'aria-label': label },
    });
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    this.registerDomEvent(btn, 'click', onClick);
  }

  /** Re-anchor (design §6): rebind an orphaned annotation to the current selection. */
  private async reanchor(annotationId: string): Promise<void> {
    const { app, store } = this.deps;
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || !view.editor.somethingSelected()) {
      new Notice('AIditor: select text in the note to re-anchor to.');
      return;
    }
    const { editor, file } = view;
    const quote = editor.getSelection();
    const fullText = editor.getValue();
    const startOffset = editor.posToOffset(editor.getCursor('from'));
    const endOffset = startOffset + quote.length;

    const lines = fullText.split('\n');
    const cursorLine = editor.getCursor('from').line;
    const block = blockSpanAtLine(lines, cursorLine);
    const { id: blockId } = await ensureBlockId({ app, file }, block);

    store.reanchor(annotationId, {
      blockId,
      quote,
      prefix: extractPrefix(fullText, startOffset, CONTEXT_LEN),
      suffix: extractSuffix(fullText, endOffset, CONTEXT_LEN),
    });
    this.render();
  }

  onunload(): void {
    this.cleanupAutoUpdate?.();
    this.el.remove();
  }
}

function blockSpanAtLine(lines: string[], line: number): BlockSpan {
  let start = line;
  let end = line;
  while (start > 0 && lines[start - 1]!.trim() !== '') start--;
  while (end < lines.length - 1 && lines[end + 1]!.trim() !== '') end++;
  return { startLine: start, endLine: end };
}
