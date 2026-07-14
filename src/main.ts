import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import type { VirtualElement } from '@floating-ui/dom';
import { AnnotationVaultStore } from './store.ts';
import { wireOrphanRecompute } from './anchor.ts';
import { createAnnotation, type OpenAnnotationPopover } from './create.ts';
import { createAIditorApi, type AIditorApi } from './api.ts';
import { AnnotationPopover } from './popover.ts';
import { aiditorMarksExtension, refreshAIditorMarksEffect, type MarksHost } from './marks.ts';
import { AIditorPanelView, VIEW_TYPE_AIDITOR_PANEL, type PanelHost } from './panel.ts';
import { aiditorReadingPostProcessor } from './reading.ts';
import { DEFAULT_SETTINGS, AIditorSettingTab, type AIditorSettings } from './settings.ts';

/** The subset of the (untyped) CodeMirror EditorView we read for popover anchoring. */
interface EditorCoords {
  coordsAtPos: (p: number) => { left: number; top: number; right: number; bottom: number } | null;
  state: { selection: { main: { from: number; to: number } } };
  scrollDOM: HTMLElement;
}

export default class AIditorPlugin extends Plugin {
  settings!: AIditorSettings;
  store!: AnnotationVaultStore;

  private popover!: AnnotationPopover;
  private unwireOrphanRecompute: (() => void) | null = null;
  /** Public extension points (design §7): app.plugins.plugins.aiditor.*
   *  Write path (create a comment) + read/action path (let Exo read comments
   *  Mario left and close them once acted on). */
  addAnnotation!: AIditorApi['addAnnotation'];
  getAnnotations!: AIditorApi['getAnnotations'];
  resolveAnnotation!: AIditorApi['resolveAnnotation'];

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new AnnotationVaultStore(this.app.vault);
    await this.store.load();

    // Expose the public API directly on the plugin instance (design §7),
    // mirroring Exo's askExo cross-plugin pattern:
    //   app.plugins.plugins.aiditor.addAnnotation({ notePath, quote, body })
    const api = createAIditorApi({ app: this.app, store: this.store });
    this.addAnnotation = api.addAnnotation;
    this.getAnnotations = api.getAnnotations;
    this.resolveAnnotation = api.resolveAnnotation;

    this.popover = new AnnotationPopover({ app: this.app, store: this.store });
    this.addChild(this.popover);

    // Orphan recompute: once now for whatever note is active, then again on
    // every active-leaf-change (design §6).
    this.unwireOrphanRecompute = wireOrphanRecompute(this.app, this.store);

    // Commented text is highlighted INLINE (not in a gutter — a gutter reserves
    // a column and narrows the editor). Each editor's ViewPlugin rebuilds its
    // decorations on doc/viewport change and on store mutations that don't
    // touch the note text (resolve/reopen/delete) via MarksHost.onStoreChange.
    const marksHost: MarksHost = {
      visibleAnnotations: () => {
        const notePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
        return this.store
          .getAll()
          .filter(
            (a) =>
              (a.status === 'active' || a.status === 'resolved') && (!notePath || a.notePath === notePath),
          );
      },
      onMarkClick: (annotationId, dom) => {
        const rect = dom.getBoundingClientRect();
        const anchor: VirtualElement = { getBoundingClientRect: () => rect };
        this.popover.open(annotationId, anchor);
      },
      onStoreChange: (listener) => this.store.onChange(() => listener()),
    };
    this.registerEditorExtension(aiditorMarksExtension(marksHost));

    // Reading-view marker seam — intentionally stubbed for MVP (design §11.1,
    // src/reading.ts). Registering it now means picking the real
    // implementation up later needs no main.ts changes.
    this.registerMarkdownPostProcessor(aiditorReadingPostProcessor());

    const panelHost: PanelHost = {
      app: this.app,
      store: this.store,
      openPopover: (annotationId, anchor) => this.popover.open(annotationId, anchor),
    };
    this.registerView(VIEW_TYPE_AIDITOR_PANEL, (leaf: WorkspaceLeaf) => new AIditorPanelView(leaf, panelHost));

    this.addSettingTab(new AIditorSettingTab(this.app, this));

    // No default hotkey by design — README points users to Settings → Hotkeys
    // so "Annotate selection" never silently steals a binding.
    this.addCommand({
      id: 'annotate-selection',
      name: 'Annotate selection',
      editorCallback: () => {
        void this.runCreateAnnotation();
      },
    });

    this.addCommand({
      id: 'open-annotations-panel',
      name: 'Open annotations panel',
      callback: () => {
        void this.activatePanel();
      },
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file) {
          this.refreshAllMarks();
        }
      }),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openPopoverSeam: OpenAnnotationPopover = ({ annotationId }) => {
    // Anchor to the selection rectangle so the composer opens right next to the
    // commented text — never at the window center (the old head-only fallback).
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = (view?.editor as unknown as { cm?: EditorCoords })?.cm;
    const anchor: VirtualElement = { getBoundingClientRect: () => this.selectionRect(cm) };
    this.popover.open(annotationId, anchor, { focusBody: true });
  };

  /** A DOMRect spanning the current selection; falls back to the editor viewport, never the window center. */
  private selectionRect(cm: EditorCoords | undefined): DOMRect {
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

  private async runCreateAnnotation(): Promise<void> {
    try {
      await createAnnotation({ app: this.app, store: this.store, openPopover: this.openPopoverSeam });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`AIditor: ${message}`);
    }
  }

  private refreshAllMarks(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const cm = (view.editor as unknown as { cm?: { dispatch: (spec: unknown) => void } }).cm;
      cm?.dispatch({ effects: refreshAIditorMarksEffect.of(null) });
    });
  }

  async activatePanel(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_AIDITOR_PANEL)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_AIDITOR_PANEL, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  onunload(): void {
    this.unwireOrphanRecompute?.();
    this.unwireOrphanRecompute = null;
    // Flush any pending debounced store write so nothing is lost on disable/reload.
    void this.store.flush();
  }
}
