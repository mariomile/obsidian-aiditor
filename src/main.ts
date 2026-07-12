import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import type { VirtualElement } from '@floating-ui/dom';
import { AnnotationVaultStore } from './store.ts';
import { wireOrphanRecompute } from './anchor.ts';
import { createAnnotation, type OpenAnnotationPopover } from './create.ts';
import { createAIditorApi, type AIditorApi } from './api.ts';
import { AnnotationPopover } from './popover.ts';
import { aiditorGutterExtension, refreshAIditorGutterEffect, type GutterHost } from './gutter.ts';
import { AIditorPanelView, VIEW_TYPE_AIDITOR_PANEL, type PanelHost } from './panel.ts';
import { aiditorReadingPostProcessor } from './reading.ts';
import { DEFAULT_SETTINGS, AIditorSettingTab, type AIditorSettings } from './settings.ts';

export default class AIditorPlugin extends Plugin {
  settings!: AIditorSettings;
  store!: AnnotationVaultStore;

  private popover!: AnnotationPopover;
  private unwireOrphanRecompute: (() => void) | null = null;
  /** Public extension point (design §7): app.plugins.plugins.aiditor.addAnnotation(...) */
  addAnnotation!: AIditorApi['addAnnotation'];

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new AnnotationVaultStore(this.app.vault);
    await this.store.load();

    // Expose the public API directly on the plugin instance (design §7),
    // mirroring Exo's askExo cross-plugin pattern:
    //   app.plugins.plugins.aiditor.addAnnotation({ notePath, quote, body })
    const api = createAIditorApi({ app: this.app, store: this.store });
    this.addAnnotation = api.addAnnotation;

    this.popover = new AnnotationPopover({ app: this.app, store: this.store });
    this.addChild(this.popover);

    // Orphan recompute: once now for whatever note is active, then again on
    // every active-leaf-change (design §6).
    this.unwireOrphanRecompute = wireOrphanRecompute(this.app, this.store);

    // Gutter markers stay in sync with store mutations that don't touch the
    // note text (resolve/reopen/delete) via each editor's own ViewPlugin
    // subscription (GutterHost.onStoreChange), so no global refresh is wired
    // here — see aiditorGutterExtension.

    const gutterHost: GutterHost = {
      countForBlockId: (blockId) => {
        const notePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
        return this.store
          .getAll()
          .filter((a) => a.blockId === blockId && a.status === 'active' && (!notePath || a.notePath === notePath))
          .length;
      },
      onMarkerClick: (blockId, dom) => {
        const notePath = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
        const rect = dom.getBoundingClientRect();
        const anchor: VirtualElement = { getBoundingClientRect: () => rect };
        this.popover.openForBlock(blockId, notePath ?? undefined, anchor);
      },
      onPlusClick: (line, dom) => {
        void this.annotateAtLine(line, dom);
      },
      onStoreChange: (listener) => this.store.onChange(() => listener()),
    };
    this.registerEditorExtension(aiditorGutterExtension(gutterHost, this.settings.gutterSide));

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
          this.refreshAllGutters();
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
    // No specific DOM anchor available from create.ts's caret-based flow —
    // anchor to the editor's current cursor position on screen.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = (view?.editor as unknown as { cm?: { coordsAtPos: (p: number) => DOMRect | null; state: { selection: { main: { head: number } } } } })?.cm;
    const coords = cm ? cm.coordsAtPos(cm.state.selection.main.head) : null;
    const rect = coords ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    const anchor: VirtualElement = { getBoundingClientRect: () => rect };
    this.popover.open(annotationId, anchor, { focusBody: true });
  };

  private async runCreateAnnotation(): Promise<void> {
    try {
      await createAnnotation({ app: this.app, store: this.store, openPopover: this.openPopoverSeam });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`AIditor: ${message}`);
    }
  }

  private async annotateAtLine(line: number, dom: HTMLElement): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return;
    view.editor.setCursor({ line, ch: 0 });
    try {
      const openAt: OpenAnnotationPopover = ({ annotationId }) => {
        const rect = dom.getBoundingClientRect();
        const anchor: VirtualElement = { getBoundingClientRect: () => rect };
        this.popover.open(annotationId, anchor, { focusBody: true });
      };
      await createAnnotation({ app: this.app, store: this.store, openPopover: openAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`AIditor: ${message}`);
    }
  }

  private refreshAllGutters(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const cm = (view.editor as unknown as { cm?: { dispatch: (spec: unknown) => void } }).cm;
      cm?.dispatch({ effects: refreshAIditorGutterEffect.of(null) });
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
