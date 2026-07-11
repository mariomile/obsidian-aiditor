/**
 * Right-sidebar annotations panel (design §5): lists annotations for the
 * active note, with filter tabs Active / Resolved / Orphaned and counts.
 * Clicking an item scrolls the editor to the block and opens the popover.
 * A global cross-vault view is explicitly deferred (design §1).
 */

import { ItemView, MarkdownView, WorkspaceLeaf, type App } from 'obsidian';
import type { Annotation, AnnotationStatus } from './model.ts';
import type { AnnotationVaultStore } from './store.ts';
import type { VirtualElement } from '@floating-ui/dom';

export const VIEW_TYPE_GLOSSA_PANEL = 'glossa-panel';

const TABS: AnnotationStatus[] = ['active', 'resolved', 'orphaned'];
const TAB_LABEL: Record<AnnotationStatus, string> = {
  active: 'Active',
  resolved: 'Resolved',
  orphaned: 'Orphaned',
};

export interface PanelHost {
  app: App;
  store: AnnotationVaultStore;
  openPopover: (annotationId: string, anchor: VirtualElement) => void;
}

export class GlossaPanelView extends ItemView {
  private tab: AnnotationStatus = 'active';
  private unsubStore: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private host: PanelHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GLOSSA_PANEL;
  }
  getDisplayText(): string {
    return 'Glossa annotations';
  }
  getIcon(): string {
    return 'message-square-text';
  }

  async onOpen(): Promise<void> {
    this.unsubStore = this.host.store.onChange(() => this.render());
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.render()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubStore?.();
    this.unsubStore = null;
  }

  private activeNotePath(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file?.path ?? null;
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('glossa-panel');

    const notePath = this.activeNotePath();

    const tabsEl = root.createDiv({ cls: 'glossa-panel-tabs' });
    for (const status of TABS) {
      const count = notePath ? this.host.store.filterByStatus(status, notePath).length : 0;
      const tabBtn = tabsEl.createDiv({
        cls: `glossa-panel-tab${status === this.tab ? ' is-active' : ''}`,
      });
      tabBtn.createSpan({ text: TAB_LABEL[status] });
      tabBtn.createSpan({ cls: 'glossa-panel-tab-count', text: String(count) });
      tabBtn.addEventListener('click', () => {
        this.tab = status;
        this.render();
      });
    }

    const listEl = root.createDiv({ cls: 'glossa-panel-list' });

    if (!notePath) {
      listEl.createDiv({ cls: 'glossa-panel-empty', text: 'Open a note to see its annotations.' });
      return;
    }

    const items = this.host.store.filterByStatus(this.tab, notePath);
    if (items.length === 0) {
      listEl.createDiv({ cls: 'glossa-panel-empty', text: `No ${TAB_LABEL[this.tab].toLowerCase()} annotations.` });
      return;
    }

    for (const a of items) {
      this.renderItem(listEl, a);
    }
  }

  private renderItem(parent: HTMLElement, a: Annotation): void {
    const item = parent.createDiv({ cls: 'glossa-panel-item' });
    if (a.quote) {
      item.createDiv({ cls: 'glossa-panel-item-quote', text: a.quote });
    }
    item.createDiv({
      cls: 'glossa-panel-item-body',
      text: a.body || '(empty annotation)',
    });
    item.addEventListener('click', () => {
      void this.openAndFocus(a, item);
    });
  }

  private async openAndFocus(a: Annotation, anchorEl: HTMLElement): Promise<void> {
    const file = this.app.vault.getFileByPath(a.notePath);
    if (file) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const lineIdx = findLineForBlockId(view?.editor.getValue() ?? '', a.blockId);
      if (view && lineIdx !== null) {
        view.editor.setCursor({ line: lineIdx, ch: 0 });
        view.editor.scrollIntoView({ from: { line: lineIdx, ch: 0 }, to: { line: lineIdx, ch: 0 } }, true);
      }
    }
    const rect = anchorEl.getBoundingClientRect();
    this.host.openPopover(a.id, { getBoundingClientRect: () => rect });
  }
}

/** Finds the 0-based line index of the block a `^gl-<id>` anchors (the line above the marker). */
function findLineForBlockId(noteText: string, blockId: string): number | null {
  const lines = noteText.split('\n');
  const marker = `^${blockId}`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === marker) {
      // The block content is the nearest non-blank line above the marker.
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j]?.trim() !== '') return j;
      }
      return Math.max(0, i - 1);
    }
  }
  return null;
}
