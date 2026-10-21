import fs from 'node:fs/promises';
const port = Number(process.argv[2] ?? 9237);
const expectedVault = process.argv[3] ?? 'Bases View Favorites QA';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Expected a valid loopback debugging port');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(entry => entry.type === 'page' && entry.url === 'app://obsidian.md/index.html');
if (!target) throw new Error('No Obsidian vault window on that debugging port');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = new Set();
socket.onmessage = ({ data }) => {
  const response = JSON.parse(data);
  for (const listener of listeners) listener(response);
  const handler = pending.get(response.id);
  if (!handler) return;
  pending.delete(response.id);
  clearTimeout(handler.timeout);
  response.error ? handler.reject(new Error(JSON.stringify(response.error))) : handler.resolve(response.result);
};
socket.onclose = () => {
  for (const handler of pending.values()) { clearTimeout(handler.timeout); handler.reject(new Error('Test app disconnected')); }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function smoke(vaultName) {
  if (app.vault.getName() !== vaultName) throw new Error(`Refusing to modify ${app.vault.getName()}; expected disposable vault ${vaultName}`);
  if (!app.plugins.plugins['bases-view-favorites']) throw new Error('Install and enable Bases View Favorites first');
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
  const folder = `_bvf-smoke-${Date.now()}`;
  await app.vault.createFolder(folder);
  await app.vault.create(`${folder}/Example.md`, '---\nStatus: ToDo\n---\nExample\n');
  const base = await app.vault.create(`${folder}/Favorites.base`, JSON.stringify({
    filters: `file.folder == "${folder}" && file.ext == "md"`,
    views: [
      { name: 'Home', type: 'table' },
      { name: 'Board', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' } },
      { name: 'List', type: 'list' },
      { name: 'Gallery', type: 'cards' }
    ]
  }, null, 2));
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(base);
  const ctrl = leaf.view.controller;
  const tabs = () => Array.from(ctrl.viewHeaderEl.querySelectorAll('.bvf-tab')).map(el => el.dataset.viewName);
  const canonical = () => { const value = ctrl.query.getSerializable(); value.views.forEach(view => delete view.viewFavorites); return JSON.stringify(value); };
  const original = canonical();
  await wait();
  assert(ctrl.viewHeaderEl.querySelector('.bvf-bar').hidden, 'Empty favorites bar is hidden');
  for (const name of ['Home', 'Board', 'List', 'Gallery']) {
    const host = ctrl.viewMenu.toolbarItem;
    host.setOpen(true);
    await wait();
    host.menu.scrollEl.querySelector(`[aria-label="Star view ${name}"]`).click();
    await wait();
    assert(ctrl.viewName === 'Home' && host.menu.isOpen, `Starring ${name} leaves the active view and dropdown intact`);
    host.setOpen(false);
  }
  for (const [name, type] of [['Home', 'table'], ['Board', 'kanban'], ['List', 'list'], ['Gallery', 'cards']]) {
    ctrl.viewHeaderEl.querySelector(`[data-view-name="${name}"]`).click();
    await wait();
    assert(ctrl.view.type === type && !ctrl.error, `Favorite uses the ${type} renderer`);
  }
  const gallery = ctrl.viewHeaderEl.querySelector('[data-view-name="Gallery"]');
  gallery.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
  assert(tabs().join(',') === 'Home,Board,Gallery,List', 'Keyboard reorder preserves the native view list');
  assert(ctrl.viewHeaderEl.querySelector('[data-view-name="Gallery"]') === gallery, 'Reorder retains the tab DOM node');
  ctrl.selectView('Board');
  const host = ctrl.viewMenu.toolbarItem;
  host.setOpen(true);
  await wait();
  host.menu.pageStack.at(-1).handleNext(ctrl.query.views.find(view => view.name === 'Board'));
  await wait();
  host.menu.scrollEl.querySelector('.bvf-config-star .checkbox-container').click();
  await wait();
  assert(!tabs().includes('Board') && ctrl.viewName === 'Board', 'Unstarring the active view keeps it open');
  host.menu.scrollEl.querySelector('.bvf-config-star .checkbox-container').click();
  await wait();
  assert(tabs().includes('Board'), 'Configure view can star the view again');
  host.setOpen(false);
  assert(canonical() === original, 'All original view filters, layout configuration, and native order are unchanged');
  const order = tabs().join(',');
  await wait(1000);
  assert((await app.vault.read(base)).includes('viewFavorites:'), 'Favorites persist in the base file');
  await app.plugins.disablePlugin('bases-view-favorites');
  assert(!document.querySelector('.bvf-bar,.bvf-star,.bvf-config-star,.bvf-toolbar'), 'Plugin unload removes all injected interface elements');
  ctrl.selectView('Home');
  assert(ctrl.view.type === 'table', 'Native view switching works after plugin unload');
  await app.plugins.enablePlugin('bases-view-favorites');
  await wait();
  assert(tabs().join(',') === order, 'Re-enabling restores favorites without duplicates');
  return { vault: vaultName, sample: base.path, checks };
}

try {
  const result = await send('Runtime.evaluate', {
    expression: `(${smoke.toString()})(${JSON.stringify(expectedVault)})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const report = result.result.value;
  const controller = `app.workspace.getLeavesOfType('bases').find(leaf => leaf.view.file?.path === ${JSON.stringify(report.sample)}).view.controller`;
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await evaluate(`(${controller}).viewMenu.toolbarItem.setOpen(true)`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`(${controller}).viewMenu.toolbarItem.menu.scrollEl.querySelector('[aria-label="Unstar view List"]').focus()`);
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  const keyboardState = starred => `(() => { const c = ${controller}; return c.viewName === 'Home' && c.viewMenu.toolbarItem.menu.isOpen && (!!c.viewHeaderEl.querySelector('[data-view-name="List"]')) === ${starred}; })()`;
  if (!await evaluate(keyboardState(false))) throw new Error('Native Enter did not toggle the focused star independently of view selection');
  await evaluate(`(${controller}).viewMenu.toolbarItem.menu.scrollEl.querySelector('[aria-label="Star view List"]').focus()`);
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  if (!await evaluate(keyboardState(true))) throw new Error('Native Space did not toggle the focused star independently of view selection');
  await evaluate(`(${controller}).viewMenu.toolbarItem.setOpen(false)`);
  report.checks.push('Trusted Enter and Space toggle stars without selecting a view or closing the dropdown');

  // Test a real HTML drag, including Chromium's drag-start threshold.
  await send('Page.captureScreenshot');
  const boxes = await evaluate(`Array.from((${controller}).viewHeaderEl.querySelectorAll('.bvf-tab')).slice(0,2).map(el => ({name:el.dataset.viewName,...el.getBoundingClientRect().toJSON()}))`);
  if (boxes.length < 2 || boxes.some(box => !box.width)) throw new Error('The native test pane must be rendered for the mouse drag test');
  const from = { x: boxes[0].x + boxes[0].width / 2, y: boxes[0].y + boxes[0].height / 2 };
  const to = { x: boxes[1].right - 4, y: boxes[1].y + boxes[1].height / 2 };
  let dragTimeout;
  let dragListener;
  const intercepted = new Promise((resolve, reject) => {
    dragTimeout = setTimeout(() => reject(new Error('No native drag start')), 5000);
    dragListener = event => {
      if (event.method !== 'Input.dragIntercepted') return;
      clearTimeout(dragTimeout);
      resolve(event.params.data);
    };
    listeners.add(dragListener);
  });
  await send('Input.setInterceptDrags', { enabled: true });
  try {
    await send('Input.cancelDragging');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...from });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from });
    for (const distance of [4, 9, 18]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: from.x + distance, y: from.y });
    const data = await intercepted;
    for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, data, ...to });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
    const moved = await evaluate(`(() => { const c = ${controller}; return c.viewHeaderEl.querySelectorAll('.bvf-tab')[1]?.dataset.viewName === ${JSON.stringify(boxes[0].name)} && !c.viewHeaderEl.querySelector('.is-dragging,.bvf-drop-before,.bvf-drop-after'); })()`);
    if (!moved) throw new Error('Native mouse drag did not reorder the favorite tabs cleanly');
    report.checks.push('Trusted native mouse drag reorders tabs and removes drag indicators');
  } finally {
    await send('Input.cancelDragging');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
    clearTimeout(dragTimeout);
    listeners.delete(dragListener);
    await send('Input.setInterceptDrags', { enabled: false });
  }
  console.log(JSON.stringify(report, null, 2));
  const screenshot = await send('Page.captureScreenshot');
  const output = new URL('../.test-build/native-smoke.png', import.meta.url);
  await fs.mkdir(new URL('../.test-build/', import.meta.url), { recursive: true });
  await fs.writeFile(output, Buffer.from(screenshot.data, 'base64'));
  console.log(`Screenshot: ${output.pathname}`);
} finally {
  socket.close();
}
