/**
 * Settings tab (design §9): store path override, gutter side, hotkey hint.
 * The store path is display-only guidance for MVP — the sidecar always lives
 * at `_system/annotations/store.json` (src/store.ts::STORE_PATH); surfacing
 * it here just tells Mario where to look, it is not (yet) an editable field
 * that reroutes storage.
 */

import { PluginSettingTab, Setting, type App } from 'obsidian';
import type GlossaPlugin from './main.ts';
import { STORE_PATH } from './store.ts';

export type GutterSide = 'left' | 'right';

export interface GlossaSettings {
  gutterSide: GutterSide;
}

export const DEFAULT_SETTINGS: GlossaSettings = {
  gutterSide: 'left',
};

export class GlossaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GlossaPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Glossa').setHeading();

    new Setting(containerEl)
      .setName('Annotation store')
      .setDesc(
        `Annotations are kept in a single vault-wide sidecar file, not in your notes: ${STORE_PATH}`,
      );

    new Setting(containerEl)
      .setName('Gutter marker side')
      .setDesc('Which side of the editor shows the annotation marker in Live Preview.')
      .addDropdown((d) =>
        d
          .addOption('left', 'Left')
          .addOption('right', 'Right')
          .setValue(this.plugin.settings.gutterSide)
          .onChange(async (v) => {
            this.plugin.settings.gutterSide = v as GutterSide;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Annotate selection hotkey')
      .setDesc(
        'Glossa ships with no default hotkey for "Annotate selection" so it never collides with your existing bindings. Bind one yourself in Settings → Hotkeys → search "Glossa".',
      );
  }
}
