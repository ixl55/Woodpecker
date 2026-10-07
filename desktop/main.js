// Woodpecker desktop: one window, the interface served from inside the app, the engine in this process.
import { BrowserWindow, Menu, app, ipcMain, nativeTheme, net, protocol, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ApiError, createApi } from './engine/api.js';
import { loadCatalog } from './engine/catalog.js';
import { Store } from './engine/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(here, 'renderer');
const HOST = 'woodpecker';
const START_URL = `app://${HOST}/index.html`;

// development runs can point at their own data folder, so trying things never touches the real progress
if (process.env.WOODPECKER_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.WOODPECKER_USER_DATA);

// Nothing is loaded from the network, so skip the disk caches that would otherwise grow in the data folder.
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let store = null;
  let handle = null;

  /** app://woodpecker/<file> -> a file inside renderer/, never anything outside it */
  function serveFile(request) {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(RENDERER, rel);
    if (url.host !== HOST || !file.startsWith(RENDERER + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  }

  const fromApp = (frame) => {
    try {
      const url = new URL(frame.url);
      return url.protocol === 'app:' && url.host === HOST;
    } catch {
      return false;
    }
  };

  /** Last size and position, if that spot is still on a connected screen. */
  function savedBounds() {
    const b = store.data.window;
    if (!b) return { width: 1280, height: 840 };
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
    return visible ? { x: b.x, y: b.y, width: b.width, height: b.height } : { width: b.width, height: b.height };
  }

  function createWindow() {
    win = new BrowserWindow({
      ...savedBounds(),
      minWidth: 900,
      minHeight: 620,
      title: 'Woodpecker',
      icon: path.join(RENDERER, 'img', 'logo-256.png'),
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f14' : '#eff2f5', // the default dark and light grounds
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    if (store.data.window?.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());

    // the window only ever shows the app itself
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`app://${HOST}/`)) event.preventDefault();
    });

    win.on('close', () => {
      store.data.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      store.save();
    });
    win.loadURL(START_URL);

    // development check: WOODPECKER_SNAPSHOT=<file.png> saves the first screen and quits, logging page errors
    const snapshot = process.env.WOODPECKER_SNAPSHOT;
    if (snapshot && !app.isPackaged) {
      win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('page:', e.message); });
      win.webContents.once('did-finish-load', () => setTimeout(async () => {
        const hash = process.env.WOODPECKER_SNAPSHOT_HASH;
        if (hash) {
          await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (process.env.WOODPECKER_SNAPSHOT_JS) { await win.webContents.executeJavaScript(process.env.WOODPECKER_SNAPSHOT_JS); await new Promise((r) => setTimeout(r, 800)); }
        const { writeFile } = await import('node:fs/promises');
        console.log('probe:', await win.webContents.executeJavaScript(`JSON.stringify({hash: location.hash, cg: document.querySelectorAll('cg-board').length, mini: document.querySelectorAll('.board-mini').length, miniHtml: (document.querySelector('#next-board')||{}).outerHTML?.slice(0,200), h1: document.querySelector('h1')?.textContent})`));
        await writeFile(snapshot, (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500));
    }
  }

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    store = new Store(path.join(app.getPath('userData'), 'progress.json'));
    handle = createApi(store, loadCatalog(path.join(here, 'resources', 'puzzles.json')));
    protocol.handle('app', serveFile);

    ipcMain.handle('api', (event, method, apiPath, body) => {
      if (!fromApp(event.senderFrame)) return { ok: false, status: 403, detail: 'Not allowed.' };
      try {
        return { ok: true, data: handle(String(method), String(apiPath), body) };
      } catch (err) {
        if (err instanceof ApiError) return { ok: false, status: err.status, detail: err.message };
        console.error(err);
        return { ok: false, status: 500, detail: 'Something went wrong. Try again.' };
      }
    });

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
