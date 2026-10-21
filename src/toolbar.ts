import { Menu, Scope, setIcon, ToggleComponent } from 'obsidian';
import { favoriteOrder, FavoriteView, moveFavorite, setStarred, starredViews } from './favorites';
import { NativeController } from './native';
import { HIDE_EMPTY_FIELDS_KEY, hideEmptyFields, KanbanEnhancements } from './kanban';

export class FavoritesBar {
  private readonly bar: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly kanban: KanbanEnhancements;
  private readonly observer: MutationObserver;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly injected = new Set<HTMLElement>();
  private readonly toggles = new WeakMap<HTMLElement, ToggleComponent>();
  private readonly starScopes = new Map<HTMLElement, () => void>();
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;
  private pending = false;
  private dragged: string | null = null;
  private dropIndex = -1;
  private scrollFrame = 0;
  private scrollSpeed = 0;
  private signature = '';

  constructor(private readonly controller: NativeController) {
    const toolbar = controller.viewHeaderEl.querySelector<HTMLElement>('.bases-toolbar')!;
    this.toolbar = toolbar;
    this.kanban = new KanbanEnhancements(controller);
    const doc = toolbar.ownerDocument;
    this.bar = toolbar.createDiv();
    this.bar.className = 'bvf-bar';
    this.bar.setAttribute('role', 'tablist');
    this.bar.setAttribute('aria-label', 'Starred views');
    this.bar.hidden = true;
    controller.viewMenu.toolbarItem.containerEl.insertAdjacentElement('afterend', this.bar);
    toolbar.classList.add('bvf-toolbar');
    this.cleanups.push(() => toolbar.classList.remove('bvf-toolbar', 'bvf-has-favorites'));
    const win = doc.defaultView!;
    this.observer = new win.MutationObserver(() => this.scheduleMenus());
    this.observer.observe(controller.viewMenu.toolbarItem.menu.scrollEl, { childList: true, subtree: true });
    this.listen(this.bar, 'keydown', event => this.onKey(event as KeyboardEvent));
    this.listen(this.bar, 'dragover', event => this.onDragOver(event as DragEvent));
    this.listen(this.bar, 'drop', event => this.onDrop(event as DragEvent));
    this.listen(this.bar, 'dragend', () => this.endDrag());
    this.listen(this.bar, 'dragleave', event => {
      if (!this.bar.contains((event as DragEvent).relatedTarget as Node | null)) this.clearDrop();
    });
  }

  private get views(): FavoriteView[] { return this.controller.query?.views ?? []; }

  render(): void {
    if (this.disposed) return;
    this.kanban.render();
    const favorites = starredViews(this.views);
    const signature = JSON.stringify(favorites.map(view => [view.name, view.type, favoriteOrder(view), this.icon(view)]));
    if (signature !== this.signature) {
      this.signature = signature;
      const focused = this.bar.ownerDocument.activeElement as HTMLElement | null;
      const focusedName = focused?.closest<HTMLElement>('.bvf-tab')?.dataset.viewName;
      const names = new Set(favorites.map(view => view.name));
      for (const [name, button] of this.buttons) {
        if (!names.has(name)) { button.remove(); this.buttons.delete(name); }
      }
      favorites.forEach((view, index) => {
        let button = this.buttons.get(view.name);
        if (!button) {
          button = this.createTab(view.name);
          this.buttons.set(view.name, button);
        }
        const icon = this.icon(view);
        if (button.dataset.icon !== icon) {
          setIcon(button.querySelector<HTMLElement>('.bvf-tab-icon')!, icon);
          button.dataset.icon = icon;
        }
        if (this.bar.children[index] !== button) this.bar.insertBefore(button, this.bar.children[index] ?? null);
      });
      if (focusedName && focused && focused !== this.bar.ownerDocument.activeElement) {
        this.buttons.get(focusedName)?.focus({ preventScroll: true });
      }
    }
    this.bar.hidden = favorites.length === 0;
    this.toolbar.classList.toggle('bvf-has-favorites', favorites.length > 0);
    const selected = this.controller.viewName;
    for (const [name, button] of this.buttons) {
      const active = name === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active || (!this.buttons.has(selected) && name === favorites[0]?.name) ? 0 : -1;
    }
    this.scheduleMenus();
  }

  private icon(view: FavoriteView): string {
    return this.controller.plugin.getRegistration(view.type)?.icon ?? 'file-question';
  }

  private createTab(name: string): HTMLButtonElement {
    const button = this.bar.createEl('button');
    button.type = 'button';
    button.className = 'bvf-tab';
    button.dataset.viewName = name;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-label', name);
    button.title = `${name}\nDrag to reorder · Alt+Left/Right to move · Right-click for actions`;
    button.draggable = true;
    const icon = button.createSpan('bvf-tab-icon');
    icon.setAttribute('aria-hidden', 'true');
    button.createSpan({ cls: 'bvf-tab-label', text: name });
    // Listeners belong to this node, which is released when its view disappears.
    button.addEventListener('click', () => {
      if (this.dragged || !this.views.some(view => view.name === name)) return;
      this.controller.selectView(name);
      this.render();
      this.reveal(button);
    });
    button.addEventListener('contextmenu', event => this.contextMenu(event, name));
    button.addEventListener('dragstart', event => {
      if (!event.dataTransfer) return;
      this.dragged = name;
      button.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-bases-view-favorite', name);
    });
    return button;
  }

  private onKey(event: KeyboardEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.bvf-tab');
    if (!button || event.isComposing) return;
    const favorites = starredViews(this.views);
    const index = favorites.findIndex(view => view.name === button.dataset.viewName);
    const rtl = this.bar.ownerDocument.defaultView!.getComputedStyle(this.bar).direction === 'rtl';
    const direction = (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0) * (rtl ? -1 : 1);
    if (direction && event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      this.move(button.dataset.viewName!, index + direction);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    if (direction) next = (index + direction + favorites.length) % favorites.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = favorites.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const target = this.buttons.get(favorites[next]?.name);
    target?.focus({ preventScroll: true });
    if (target) this.reveal(target);
  }

  private reveal(button: HTMLElement): void {
    // Scroll the strip, never the document or board underneath it.
    const tab = button.getBoundingClientRect();
    const strip = this.bar.getBoundingClientRect();
    if (tab.left < strip.left) this.bar.scrollLeft -= strip.left - tab.left;
    else if (tab.right > strip.right) this.bar.scrollLeft += tab.right - strip.right;
  }

  private contextMenu(event: MouseEvent, name: string): void {
    event.preventDefault();
    event.stopPropagation();
    const index = starredViews(this.views).findIndex(view => view.name === name);
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Unstar view').setIcon('star-off').onClick(() => this.toggle(name, false)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Move earlier').setIcon('arrow-left').setDisabled(index <= 0).onClick(() => this.move(name, index - 1)));
    menu.addItem(item => item.setTitle('Move later').setIcon('arrow-right').setDisabled(index >= this.buttons.size - 1).onClick(() => this.move(name, index + 1)));
    menu.showAtMouseEvent(event);
  }

  private move(name: string, index: number): void {
    if (moveFavorite(this.views, name, index)) this.render();
    const button = this.buttons.get(name);
    button?.focus({ preventScroll: true });
    if (button) this.reveal(button);
  }

  private toggle(name: string, starred: boolean): void {
    const view = this.views.find(entry => entry.name === name);
    if (!view) return;
    setStarred(this.views, view, starred);
    this.render();
  }

  private onDragOver(event: DragEvent): void {
    if (!this.dragged) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.clearDrop();
    const favorites = starredViews(this.views);
    const target = (event.target as HTMLElement).closest<HTMLElement>('.bvf-tab');
    if (!target) return;
    const from = favorites.findIndex(view => view.name === this.dragged);
    const at = favorites.findIndex(view => view.name === target.dataset.viewName);
    const rect = target.getBoundingClientRect();
    const rtl = this.bar.ownerDocument.defaultView!.getComputedStyle(this.bar).direction === 'rtl';
    const after = rtl ? event.clientX < rect.left + rect.width / 2 : event.clientX >= rect.left + rect.width / 2;
    const insertion = at + (after ? 1 : 0);
    this.dropIndex = insertion > from ? insertion - 1 : insertion;
    if (this.dropIndex !== from) target.classList.add(after ? 'bvf-drop-after' : 'bvf-drop-before');
    const strip = this.bar.getBoundingClientRect();
    this.scrollSpeed = event.clientX < strip.left + 24 ? -5 : event.clientX > strip.right - 24 ? 5 : 0;
    this.autoScroll();
  }

  private autoScroll(): void {
    if (this.scrollFrame || !this.scrollSpeed) return;
    this.scrollFrame = this.bar.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (!this.dragged || !this.scrollSpeed) return;
      this.bar.scrollLeft += this.scrollSpeed;
      this.autoScroll();
    });
  }

  private onDrop(event: DragEvent): void {
    if (!this.dragged) return;
    event.preventDefault();
    event.stopPropagation();
    const name = this.dragged;
    const index = this.dropIndex;
    this.endDrag();
    if (index >= 0) this.move(name, index);
  }

  private clearDrop(): void {
    this.dropIndex = -1;
    this.scrollSpeed = 0;
    this.bar.querySelectorAll('.bvf-drop-before, .bvf-drop-after').forEach(el => el.classList.remove('bvf-drop-before', 'bvf-drop-after'));
  }

  private endDrag(): void {
    this.dragged = null;
    this.clearDrop();
    this.buttons.forEach(button => button.classList.remove('is-dragging'));
    if (this.scrollFrame) this.bar.ownerDocument.defaultView!.cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
  }

  private scheduleMenus(): void {
    if (this.pending || this.disposed) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!this.disposed) this.renderMenus();
    });
  }

  private renderMenus(): void {
    for (const node of this.injected) {
      if (node.isConnected) continue;
      this.starScopes.get(node)?.();
      this.starScopes.delete(node);
      this.injected.delete(node);
    }
    const pages = this.controller.viewMenu.toolbarItem.menu.pageStack;
    const page = pages[pages.length - 1];
    if (!page) return;
    if (page.containerEl.classList.contains('bases-views-page') && page.chooser) {
      page.chooser.values.forEach((value, index) => {
        if (!value.config) return;
        const name = value.config.name;
        const row = page.chooser!.suggestions[index];
        if (!row) return;
        let button = row.querySelector<HTMLButtonElement>('.bvf-star');
        if (!button) {
          button = row.createEl('button', { prepend: true });
          button.type = 'button';
          button.className = 'clickable-icon bvf-star';
          button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
          button.addEventListener('keydown', event => {
            if (event.defaultPrevented) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            button!.click();
          });
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const view = this.views.find(entry => entry.name === name);
            if (view) this.toggle(name, favoriteOrder(view) === null);
          });
          row.insertBefore(button, row.lastElementChild);
          this.addStarScope(button, page.scope);
          this.injected.add(button);
        }
        const starred = favoriteOrder(value.config) !== null;
        const label = `${starred ? 'Unstar' : 'Star'} view ${name}`;
        if (button.getAttribute('aria-label') !== label) {
          button.setAttribute('aria-label', label);
          button.setAttribute('aria-pressed', String(starred));
          button.title = label;
          button.classList.toggle('is-starred', starred);
          setIcon(button, 'star');
        }
      });
    }
    if (page.view && page.formEl) {
      const view = page.view;
      let row = page.formEl.querySelector<HTMLElement>('.bvf-config-star');
      const starred = favoriteOrder(view) !== null;
      if (!row) {
        row = page.formEl.createDiv('input-row bvf-config-star');
        page.formEl.firstElementChild?.insertAdjacentElement('afterend', row);
        row.createDiv({ cls: 'input-row-label', text: 'Star view' });
        const toggle = new ToggleComponent(row.createDiv('input-row-content'));
        toggle.setValue(starred).onChange(value => this.toggle(view.name, value));
        toggle.toggleEl.setAttribute('aria-label', 'Star view');
        this.toggles.set(row, toggle);
        this.injected.add(row);
      }
      this.toggles.get(row)?.setValue(starred);
      if (view.type === 'kanban') {
        let emptyRow = page.formEl.querySelector<HTMLElement>('.bvf-config-hide-empty');
        if (!emptyRow) {
          emptyRow = page.formEl.createDiv('input-row bvf-config-hide-empty');
          row.insertAdjacentElement('afterend', emptyRow);
          emptyRow.createDiv({ cls: 'input-row-label', text: 'Hide empty fields' });
          const toggle = new ToggleComponent(emptyRow.createDiv('input-row-content'));
          toggle.setValue(hideEmptyFields(view)).onChange(value => {
            view.set(HIDE_EMPTY_FIELDS_KEY, value);
            this.kanban.render();
          });
          toggle.toggleEl.setAttribute('aria-label', 'Hide empty fields');
          this.toggles.set(emptyRow, toggle);
          this.injected.add(emptyRow);
        }
        this.toggles.get(emptyRow)?.setValue(hideEmptyFields(view));
      } else {
        page.formEl.querySelector('.bvf-config-hide-empty')?.remove();
      }
    }
  }

  private addStarScope(button: HTMLButtonElement, parent: Scope): void {
    // The native chooser consumes Enter during capture. A public child Scope
    // handles the focused star first and returns other keys to the popup.
    const scope = new Scope(parent);
    for (const key of ['Enter', ' ']) scope.register([], key, event => {
      if (!event.repeat) button.click();
      return false;
    });
    const keymap = this.controller.app.keymap;
    const focus = (): void => keymap.pushScope(scope);
    const blur = (): void => keymap.popScope(scope);
    button.addEventListener('focus', focus);
    button.addEventListener('blur', blur);
    this.starScopes.set(button, () => {
      blur();
      button.removeEventListener('focus', focus);
      button.removeEventListener('blur', blur);
    });
  }

  private listen(element: HTMLElement, type: string, callback: EventListener): void {
    element.addEventListener(type, callback);
    this.cleanups.push(() => element.removeEventListener(type, callback));
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.kanban.destroy();
    this.endDrag();
    for (const cleanup of this.starScopes.values()) cleanup();
    this.starScopes.clear();
    this.bar.remove();
    for (const node of this.injected) node.remove();
    this.injected.clear();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.buttons.clear();
  }
}
