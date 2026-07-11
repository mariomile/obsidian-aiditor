/**
 * Right-sidebar annotations panel (design §5): lists annotations for the
 * active note, with filter tabs Active / Resolved / Orphaned and live counts.
 * Clicking an item scrolls the editor to the block and opens the popover.
 * Orphaned items show their stored quote plus Re-anchor (opens the popover,
 * which owns the actual re-anchor-to-selection flow, design §6) and Delete
 * (direct `store.delete`) actions. A global cross-vault view is explicitly
 * deferred (design §1) — this view only ever lists the active note.
 */

import { ItemView, MarkdownView, Notice, setIcon, WorkspaceLeaf, type App } from 'obsidian';
import type { Annotation, AnnotationStatus } from './model.ts';
import type { AnnotationVaultStore } from './store.ts';
import type { VirtualElement } from '@floating-ui/dom';
import {
  PANEL_TABS,
  tabLabelWithCount,
  emptyStateMessage,
  countsForNote,
  itemsForTab,
  truncate,
  relativeTime,
} from './panel-core.ts';

export const VIEW_TYPE_GLOSSA_PANEL = 'glossa-panel';

const QUOTE_TRUNCATE_LEN = 80;
const BODY_TRUNCATE_LEN = 140;

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
    const counts = countsForNote(this.host.store.getStore(), notePath);

    const tabsEl = root.createDiv({ cls: 'glossa-panel-tabs' });
    for (const status of PANEL_TABS) {
      const tabBtn = tabsEl.createDiv({
        cls: `glossa-panel-tab${status === this.tab ? ' is-active' : ''}`,
      });
      tabBtn.createSpan({ cls: 'glossa-panel-tab-label', text: tabLabelWithCount(status, counts[status]) });
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

    const items = itemsForTab(this.host.store.getStore(), this.tab, notePath);
    if (items.length === 0) {
      listEl.createDiv({ cls: 'glossa-panel-empty', text: emptyStateMessage(this.tab) });
      return;
    }

    for (const a of items) {
      this.renderItem(listEl, a);
    }
  }

  private renderItem(parent: HTMLElement, a: Annotation): void {
    const item = parent.createDiv({ cls: 'glossa-panel-item' });
    if (a.quote) {
      item.createDiv({ cls: 'glossa-panel-item-quote', text: truncate(a.quote, QUOTE_TRUNCATE_LEN) });
    }
    item.createDiv({
      cls: 'glossa-panel-item-body',
      text: a.body ? truncate(a.body, BODY_TRUNCATE_LEN) : '(empty annotation)',
    });
    item.createDiv({ cls: 'glossa-panel-item-time', text: relativeTime(a.updated, Date.now()) });

    if (a.status === 'orphaned') {
      this.renderOrphanActions(item, a);
      // Orphaned items still open the popover on click (e.g. clicking the
      // quote/body), but the action row below stops click-through so
      // Re-anchor/Delete don't also trigger the scroll-and-open flow.
    }

    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.glossa-panel-item-actions')) return;
      void this.openAndFocus(a, item);
    });
  }

  private renderOrphanActions(item: HTMLElement, a: Annotation): void {
    const actions = item.createDiv({ cls: 'glossa-panel-item-actions' });

    const reanchorBtn = actions.createEl('button', {
      cls: 'glossa-panel-item-action',
      attr: { 'aria-label': 'Re-anchor' },
    });
    setIcon(reanchorBtn, 'link');
    reanchorBtn.createSpan({ text: 'Re-anchor' });
    reanchorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Re-anchoring needs a live text selection in the editor; the popover
      // owns that flow (design §6) — the panel opens it rather than
      // duplicating selection-capture logic here.
      const rect = reanchorBtn.getBoundingClientRect();
      this.host.openPopover(a.id, { getBoundingClientRect: () => rect });
      new Notice('Glossa: select the new text in the note, then click "Re-anchor to selection".');
    });

    const deleteBtn = actions.createEl('button', {
      cls: 'glossa-panel-item-action glossa-panel-item-action--danger',
      attr: { 'aria-label': 'Delete' },
    });
    setIcon(deleteBtn, 'trash-2');
    const deleteLabel = deleteBtn.createSpan({ text: 'Delete' });
    let armed = false;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        deleteBtn.addClass('is-armed');
        deleteLabel.setText('Confirm delete');
        return;
      }
      this.host.store.delete(a.id);
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
