/**
 * Pure settings shape + defaults (design §8/§9): no Obsidian imports, so this
 * can be unit-tested directly with `node --test`. The coupled `settings.ts`
 * re-exports these and adds the Obsidian `PluginSettingTab` UI.
 */

export type GutterSide = 'left' | 'right';

export interface AIditorSettings {
  /** Vault-relative path to the sidecar store (design §4). Text-input override. */
  storePath: string;
  /** Which side of the editor shows the annotation gutter marker in Live Preview. */
  gutterSide: GutterSide;
}

export const DEFAULT_STORE_PATH = '_system/annotations/store.json';

export const DEFAULT_SETTINGS: AIditorSettings = {
  storePath: DEFAULT_STORE_PATH,
  gutterSide: 'left',
};
