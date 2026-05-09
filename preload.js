/**
 * Electron 预加载脚本  v2.2 (Final)
 * ==================================
 * 通过 contextBridge 向渲染进程暴露安全的 IPC API。
 * 数据存储仍在渲染进程的 localStorage 中，主进程仅管理窗口。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* ---- 环境 ---- */
  isElectron: true,

  /* ---- 窗口管理 ---- */

  /**
   * 请求主进程创建/聚焦一个便签窗口。
   * @param {{ noteId: string, bounds?: { x, y, width, height } }} options
   * @returns {Promise<{ success: boolean, noteId: string, existing: boolean }>}
   */
  createNoteWindow: function (options) {
    return ipcRenderer.invoke('create-note-window', options);
  },

  /**
   * 请求主进程关闭便签窗口（不删除数据，仅关闭窗口）。
   * @param {string} noteId
   * @returns {Promise<{ success: boolean }>}
   */
  closeNoteWindow: function (noteId) {
    return ipcRenderer.invoke('close-note-window', noteId);
  },

  /**
   * 通知主进程更新窗口置顶状态（同步 note.isPinned）。
   * @param {string} noteId
   * @param {boolean} isPinned
   */
  setNotePin: function (noteId, isPinned) {
    ipcRenderer.send('set-note-pin', noteId, isPinned);
  },

  /**
   * 通知主进程更新窗口位置/尺寸（单向 send）。
   * @param {string} noteId
   * @param {{ x, y, width, height }} bounds
   */
  updateNoteBounds: function (noteId, bounds) {
    ipcRenderer.send('update-note-bounds', noteId, bounds);
  },

  /* ---- 查询 ---- */

  /** @returns {Promise<string[]>} 当前打开的 noteId 列表 */
  getOpenNotes: function () {
    return ipcRenderer.invoke('get-open-notes');
  },

  /** @returns {Promise<object>} Store 中的窗口 Map */
  getSavedWindows: function () {
    return ipcRenderer.invoke('get-saved-windows');
  },

  /** @returns {string|null} 从 process.argv 解析 noteId */
  getNoteIdArg: function () {
    var args = process.argv;
    for (var i = 0; i < args.length; i++) {
      if (args[i].startsWith('--note-id=')) {
        return args[i].split('=')[1];
      }
    }
    return null;
  },

  /* ---- 更新 ---- */

  /** 手动触发检查更新 */
  checkForUpdate: function () {
    return ipcRenderer.invoke('check-for-update');
  },

  /** 获取应用版本号 */
  getAppVersion: function () {
    return ipcRenderer.invoke('get-app-version');
  },

  /** 监听主进程发来的更新状态变化 */
  onUpdateStatus: function (callback) {
    ipcRenderer.on('update-status', function (event, data) {
      callback(data);
    });
  }
});
