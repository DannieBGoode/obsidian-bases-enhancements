import { App, Component, QueryController, Scope } from 'obsidian';
import { FavoriteView } from './favorites';

/** Private surface verified against Obsidian 1.14.4; keep it confined here. */
export interface NativeController extends QueryController {
  app: App;
  query: { views: FavoriteView[]; file?: { extension: string } } | null;
  viewName: string;
  view?: unknown;
  viewHeaderEl: HTMLElement;
  viewContainerEl: HTMLElement;
  viewMenu: { toolbarItem: {
    containerEl: HTMLElement;
    menu: { scrollEl: HTMLElement; pageStack: NativePage[] };
  } };
  plugin: { getRegistration(type: string): { icon?: string } | undefined };
  selectView(name: string): void;
  update(): void;
}

export interface NativePage {
  containerEl: HTMLElement;
  scope: Scope;
  view?: FavoriteView;
  formEl?: HTMLElement;
  chooser?: { values: { config: FavoriteView | null }[]; suggestions: HTMLElement[] };
}

export function isNativeController(value: unknown): value is NativeController {
  const controller = value as Partial<NativeController> | null;
  return !!controller && typeof controller.selectView === 'function'
    && !!controller.viewHeaderEl?.querySelector('.bases-toolbar')
    && !!controller.viewMenu?.toolbarItem?.menu?.scrollEl
    && Array.isArray(controller.viewMenu.toolbarItem.menu.pageStack)
    && typeof controller.plugin?.getRegistration === 'function';
}

export function visitComponents(component: Component, visit: (value: unknown) => void, seen = new Set<unknown>()): void {
  if (seen.has(component)) return;
  seen.add(component);
  visit(component);
  const children = (component as Component & { _children?: Component[] })._children;
  for (const child of children ?? []) visitComponents(child, visit, seen);
}
