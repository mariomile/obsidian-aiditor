/**
 * The annotation popover (design §5): view/edit body, Resolve, Reopen,
 * Delete, and (for orphans) Re-anchor to the current selection. One
 * singleton instance is owned by main.ts and repositioned/refilled per open()
 * call — mirrors composer's ComposerMenu singleton-popover pattern.
 */

import { Component, MarkdownView, Notice, setIcon, type App } from 'obsidian';
import { computePosition, offset, flip, shift, type VirtualElement } from '@floating-ui/dom';
import { extractPrefix, extractSuffix, type BlockSpan } from './anchor-core.ts';
import { ensureBlockId } from './anchor.ts';
import type { AnnotationVaultStore } from './store.ts';

const CONTEXT_LEN = 32;

export interface PopoverDeps {
  app: App;
  store: AnnotationVaultStore;
}

export class AnnotationPopover extends Component {
  private el: HTMLElement;
  private visible = false;
  private annotationId: string | null = null;

  constructor(private deps: PopoverDeps) {
    super();
    this.el = document.body.createDiv({ cls: 'glossa-popover' });
    this.el.hide();

    this.registerDomEvent(document, 'mousedown', (e) => {
      if (this.visible && !this.el.contains(e.target as Node)) this.close();
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

  /** Opens (or refills, if already open) the popover for `annotationId`, anchored to `anchor`. */
  open(annotationId: string, anchor: VirtualElement): void {
    this.annotationId = annotationId;
    this.render();
    this.el.show();
    this.visible = true;
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
    this.visible = false;
    this.annotationId = null;
    this.el.hide();
  }

  private render(): void {
    const { store } = this.deps;
    this.el.empty();
    if (!this.annotationId) return;
    const a = store.getById(this.annotationId);
    if (!a) {
      this.el.createDiv({ cls: 'glossa-popover-empty', text: 'Annotation not found.' });
      return;
    }

    const header = this.el.createDiv({ cls: 'glossa-popover-header' });
    header.createSpan({ cls: `glossa-status glossa-status--${a.status}`, text: a.status });
    if (a.quote) {
      this.el.createDiv({ cls: 'glossa-popover-quote', text: a.quote });
    }

    const textarea = this.el.createEl('textarea', {
      cls: 'glossa-popover-body',
      attr: { placeholder: 'Annotation…' },
    });
    textarea.value = a.body;
    this.register(
      (() => {
        const handler = () => store.updateBody(a.id, textarea.value);
        textarea.addEventListener('blur', handler);
        return () => textarea.removeEventListener('blur', handler);
      })(),
    );

    const actions = this.el.createDiv({ cls: 'glossa-popover-actions' });

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
      this.actionBtn(actions, 'link', 'Re-anchor to selection', () => void this.reanchor(a.id));
    }

    this.actionBtn(actions, 'trash-2', 'Delete', () => {
      store.delete(a.id);
      this.close();
    });

    window.setTimeout(() => textarea.focus(), 0);
  }

  private actionBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const btn = parent.createEl('button', { cls: 'glossa-popover-btn', attr: { 'aria-label': label } });
    setIcon(btn, icon);
    btn.createSpan({ text: label });
    this.registerDomEvent(btn, 'click', onClick);
  }

  /** Re-anchor (design §6): rebind an orphaned annotation to the current selection. */
  private async reanchor(annotationId: string): Promise<void> {
    const { app, store } = this.deps;
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || !view.editor.somethingSelected()) {
      new Notice('Glossa: select text in the note to re-anchor to.');
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
