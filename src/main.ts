import { Notice, Plugin, QueryController } from 'obsidian';
import { FavoritesBar } from './toolbar';
import { isNativeController, NativeController, visitComponents } from './native';
import { afterMethod } from './patch';
import { favoriteOrder, setStarred } from './favorites';

export default class BasesEnhancements extends Plugin {
  private readonly bars = new Map<NativeController, FavoritesBar>();
  private active = false;
  private warned = false;

  onload(): void {
    this.active = true;
    const refresh = (value: unknown): void => {
      if (!this.active) return;
      try {
        if (!isNativeController(value) || value.app !== this.app) return;
        // Inline code blocks have a different save lifecycle. Attach only to
        // actual .base files, including file-backed Markdown embeds.
        if (value.query?.file?.extension !== 'base') {
          this.bars.get(value)?.destroy();
          this.bars.delete(value);
          return;
        }
        let bar = this.bars.get(value);
        if (!bar) {
          bar = new FavoritesBar(value);
          this.bars.set(value, bar);
          const bars = this.bars;
          value.register(() => {
            bars.get(value)?.destroy();
            bars.delete(value);
          });
        }
        bar.render();
      } catch (error) {
        console.error('Bases Enhancements: unable to update navigation', error);
        if (!this.warned) {
          this.warned = true;
          new Notice('Bases Enhancements could not attach to this version of Bases. Native views remain available.');
        }
      }
    };
    this.register(afterMethod(QueryController.prototype, 'update', refresh));
    const discover = (): void => {
      this.app.workspace.iterateAllLeaves(leaf => visitComponents(leaf.view, refresh));
    };
    this.app.workspace.onLayoutReady(discover);
    this.registerEvent(this.app.workspace.on('layout-change', discover));
    this.addCommand({
      id: 'toggle-current-view-favorite',
      name: 'Toggle star for current Bases view',
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const controller = (leaf?.view as unknown as { controller?: unknown })?.controller;
        if (!isNativeController(controller) || controller.query?.file?.extension !== 'base') return false;
        const view = controller.query.views.find(entry => entry.name === controller.viewName);
        if (!view) return false;
        if (!checking) {
          setStarred(controller.query.views, view, favoriteOrder(view) === null);
          refresh(controller);
        }
        return true;
      }
    });
  }

  onunload(): void {
    this.active = false;
    for (const bar of this.bars.values()) bar.destroy();
    this.bars.clear();
  }
}
