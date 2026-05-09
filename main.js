/**
 * Electron 主进程 — 多窗口便签桌面应用  v2.2 (Final)
 * ====================================================
 * 模块：
 *   - Store (electron-store) 持久化窗口状态 (Map 格式)
 *   - noteWindows Map 管理 noteId → BrowserWindow
 *   - IPC: create / close / pin / bounds / query
 *   - 启动时恢复窗口，恢复 alwaysOnTop
 *
 * 启动：
 *   1. migrateStore → 读取 Store['windows']
 *   2. 遍历恢复每个便签窗口 (位置 + 尺寸 + 置顶)
 *   3. 无窗口则打开 control.html
 */

const { app, BrowserWindow, ipcMain, screen, Menu, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

/* ---- 窗口限制 ---- */
const WIN_MIN_W = 220, WIN_MIN_H = 200;
const WIN_MAX_W = 700, WIN_MAX_H = 800;
const WIN_DEFAULT_W = 320, WIN_DEFAULT_H = 360;

/* ---- Store ---- */
const store = new Store({ name: 'window-state', defaults: { windows: {} } });

function migrateStore() {
  var windows = store.get('windows');
  if (Array.isArray(windows)) {
    var map = {};
    windows.forEach(function (w) { if (w.noteId) map[w.noteId] = { x: w.x, y: w.y, width: w.width, height: w.height }; });
    store.set('windows', map);
  }
}

/* ---- 中文菜单 ---- */
var menuTemplate = [
  {
    label: '文件',
    submenu: [
      { label: '新建便签', accelerator: 'CmdOrCtrl+N', click: function () { createControlWindow(); } },
      { label: '打开控制面板', click: function () { createControlWindow(); } },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
    ]
  },
  {
    label: '编辑',
    submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' }
    ]
  },
  {
    label: '视图',
    submenu: [
      { label: '重新加载', role: 'reload' },
      { label: '强制重新加载', role: 'forceReload' },
      { label: '开发者工具', role: 'toggleDevTools' },
      { type: 'separator' },
      { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' },
      { label: '重置缩放', role: 'resetZoom' }
    ]
  },
  {
    label: '帮助',
    submenu: [
      { label: '检查更新', click: function () { autoUpdater.checkForUpdatesAndNotify(); } },
      { type: 'separator' },
      { label: '关于便签工具', click: function () {
        dialog.showMessageBox({
          type: 'info', title: '关于便签工具',
          message: '便签工具 v' + app.getVersion() + '\n基于 Electron 的多窗口桌面便签应用\nMIT License'
        });
      }}
    ]
  }
];
var menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);

/* ---- 窗口映射 ---- */
var noteWindows = new Map();
var controlWindow = null;

function clamp(v, min, max) { return v ? Math.max(min, Math.min(max, v)) : v; }

function persistWindowStates() {
  var w = {};
  noteWindows.forEach(function (win, id) {
    if (!win.isDestroyed()) { var b = win.getBounds(); w[id] = { x: b.x, y: b.y, width: b.width, height: b.height }; }
  });
  store.set('windows', w);
}

/**
 * 创建便签窗口。
 * @param {string} noteId
 * @param {{ x, y, width, height, isPinned? }} [saved]
 */
function createNoteWindow(noteId, saved) {
  var b = saved || {};
  var opts = {
    width: clamp(b.width, WIN_MIN_W, WIN_MAX_W) || WIN_DEFAULT_W,
    height: clamp(b.height, WIN_MIN_H, WIN_MAX_H) || WIN_DEFAULT_H,
    minWidth: WIN_MIN_W, minHeight: WIN_MIN_H,
    maxWidth: WIN_MAX_W, maxHeight: WIN_MAX_H,
    frame: false, resizable: true, minimizable: true,
    maximizable: false, fullscreenable: false,
    skipTaskbar: false, hasShadow: true, title: '便签',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  };
  if (typeof b.x === 'number') opts.x = b.x;
  if (typeof b.y === 'number') opts.y = b.y;

  var win = new BrowserWindow(opts);
  win.loadFile('index.html', { query: { noteId: noteId } });
  noteWindows.set(noteId, win);

  // 恢复置顶状态（从 Store 的 isPinned 读取，或等待渲染进程 IPC 通知）
  // isPinned 字段存在 localStorage note 中，渲染进程加载后会通过 IPC 同步

  var saveTimer = null;
  function debounce() { clearTimeout(saveTimer); saveTimer = setTimeout(persistWindowStates, 500); }
  win.on('resize', debounce);
  win.on('moved', debounce);
  win.on('closed', function () { noteWindows.delete(noteId); persistWindowStates(); });

  return win;
}

function createControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) { controlWindow.focus(); return controlWindow; }
  controlWindow = new BrowserWindow({
    width: 380, height: 520, minWidth: 300, minHeight: 400,
    title: '便签管理', resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  controlWindow.loadFile('control.html');
  controlWindow.on('closed', function () { controlWindow = null; });
  return controlWindow;
}

/* ---- IPC ---- */

ipcMain.handle('create-note-window', function (e, opts) {
  var noteId = opts && opts.noteId;
  if (!noteId) return { success: false };

  var existing = noteWindows.get(noteId);
  if (existing && !existing.isDestroyed()) { existing.focus(); return { success: true, noteId: noteId, existing: true }; }

  var bounds = (opts && opts.bounds) || {};
  if (typeof bounds.x !== 'number') {
    var area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    var n = noteWindows.size;
    bounds.x = area.x + 60 + (n % 5) * 30;
    bounds.y = area.y + 40 + (n % 5) * 30;
  }
  createNoteWindow(noteId, bounds);
  persistWindowStates();
  return { success: true, noteId: noteId, existing: false };
});

ipcMain.handle('close-note-window', function (e, noteId) {
  var win = noteWindows.get(noteId);
  if (win && !win.isDestroyed()) win.close();
  noteWindows.delete(noteId);
  persistWindowStates();
  return { success: true };
});

ipcMain.on('set-note-pin', function (e, noteId, isPinned) {
  var win = noteWindows.get(noteId);
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(!!isPinned);
  }
});

ipcMain.on('update-note-bounds', function (e, noteId, bounds) {
  var win = noteWindows.get(noteId);
  if (win && !win.isDestroyed() && bounds) {
    var cur = win.getBounds();
    win.setBounds({
      x: typeof bounds.x === 'number' ? clamp(bounds.x, -100, 9999) : cur.x,
      y: typeof bounds.y === 'number' ? clamp(bounds.y, -100, 9999) : cur.y,
      width: clamp(bounds.width, WIN_MIN_W, WIN_MAX_W) || cur.width,
      height: clamp(bounds.height, WIN_MIN_H, WIN_MAX_H) || cur.height
    });
    persistWindowStates();
  }
});

ipcMain.handle('get-open-notes', function () {
  var ids = [];
  noteWindows.forEach(function (w, id) { if (!w.isDestroyed()) ids.push(id); });
  return ids;
});

ipcMain.handle('get-saved-windows', function () { return store.get('windows', {}); });

ipcMain.handle('check-for-update', function () {
  return autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.handle('get-app-version', function () {
  return app.getVersion();
});

/* ---- 自动更新 ---- */

autoUpdater.autoDownload = true;    // 自动下载更新
autoUpdater.autoInstallOnAppQuit = true;  // 退出时自动安装

// 发现新版本
autoUpdater.on('update-available', function (info) {
  // 向控制窗口发送更新通知
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('update-status', { status: 'available', version: info.version });
  }
});

// 下载进度
autoUpdater.on('download-progress', function (progress) {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('update-status', {
      status: 'downloading',
      percent: Math.floor(progress.percent)
    });
  }
});

// 下载完成，提示重启
autoUpdater.on('update-downloaded', function (info) {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('update-status', { status: 'downloaded', version: info.version });
  }
  dialog.showMessageBox({
    type: 'info',
    title: '更新已下载',
    message: '新版本 ' + info.version + ' 已下载完成。\n点击确定立即重启安装更新。',
    buttons: ['立即重启', '稍后']
  }).then(function (result) {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

// 更新出错
autoUpdater.on('error', function (err) {
  console.error('[autoUpdater] 更新出错:', err.message);
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('update-status', { status: 'error', message: err.message });
  }
});

/* ---- 生命周期 ---- */

app.whenReady().then(function () {
  migrateStore();
  var saved = store.get('windows', {});
  var ids = Object.keys(saved);
  if (ids.length > 0) {
    ids.forEach(function (id) { createNoteWindow(id, saved[id]); });
  }
  if (noteWindows.size === 0) createControlWindow();
  if (!controlWindow) createControlWindow();

  // 启动后自动检查更新（不阻塞启动流程）
  setTimeout(function () {
    autoUpdater.checkForUpdatesAndNotify().catch(function (err) {
      console.log('[autoUpdater] 检查更新失败（可能是网络问题或未配置 GitHub）：', err.message);
    });
  }, 3000);
});

app.on('window-all-closed', function () {
  persistWindowStates();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) {
    var s = store.get('windows', {}); var ids = Object.keys(s);
    if (ids.length) ids.forEach(function (id) { createNoteWindow(id, s[id]); });
    else createControlWindow();
  }
});

app.on('before-quit', persistWindowStates);
