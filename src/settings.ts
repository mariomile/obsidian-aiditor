/**
 * Settings tab (design §8/§9): store path override, hotkey hint.
 * `AIditorSettings`/`DEFAULT_SETTINGS` live in the pure `settings-core.ts` (no
 * Obsidian imports, unit-testable) and are re-exported here; this module adds
 * only the Obsidian-coupled `PluginSettingTab` UI.
 *
 * The store-path field is a text-input override surfaced now per design §8;
 * actually rerouting `AnnotationVaultStore`'s read/write target to a
 * non-default path is main.ts plumbing that lands in slice B6 — for now the
 * sidecar always persists at `store.ts::STORE_PATH`, and this field's value
 * is saved to plugin data so B6 has it ready to consume.
 */

import { PluginSettingTab, Setting, type App } from 'obsidian';
import type AIditorPlugin from './main.ts';
import { STORE_PATH } from './store.ts';
import { DEFAULT_SETTINGS } from './settings-core.ts';

export type { AIditorSettings } from './settings-core.ts';
export { DEFAULT_SETTINGS } from './settings-core.ts';

export class AIditorSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AIditorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('AIditor').setHeading();

    new Setting(containerEl)
      .setName('Annotation store path')
      .setDesc(
        `Vault-relative path to the sidecar file annotations are kept in (not in your notes). Default: ${DEFAULT_SETTINGS.storePath}. Currently active: ${STORE_PATH}.`,
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.storePath)
          .setValue(this.plugin.settings.storePath)
          .onChange(async (v) => {
            this.plugin.settings.storePath = v.trim() || DEFAULT_SETTINGS.storePath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Annotate selection hotkey')
      .setDesc(
        'AIditor ships with no default hotkey for "Annotate selection" so it never collides with your existing bindings. Bind one yourself in Settings → Hotkeys → search "AIditor".',
      );
  }
}
