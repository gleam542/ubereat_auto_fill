'use strict';
// 電腦版：用內建瀏覽器打開 Uber Eats 網頁版，並注入與 Tampermonkey 版相同的 userscript。
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib');

const HOME_URL = 'https://www.ubereats.com/tw';
const PARTITION = 'persist:ubereats';
const START_URL = process.env.UEPA_START_URL || HOME_URL; // 測試時可以換掉起始頁

if (process.env.UEPA_USER_DATA) app.setPath('userData', process.env.UEPA_USER_DATA);

let win = null;
let store = {};
const storeFile = () => path.join(app.getPath('userData'), 'uepa-store.json');
const cachedScriptFile = () => path.join(app.getPath('userData'), 'userscript-latest.js');

/* ------------------------------------------------------------------ */
/* 儲存（GM_getValue / GM_setValue）                                     */
/* ------------------------------------------------------------------ */

function loadStore() {
  try {
    store = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch (e) {
    store = {};
  }
}

function writeFileAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function saveStore() {
  try {
    writeFileAtomic(storeFile(), JSON.stringify(store));
  } catch (e) {
    console.error('無法儲存資料', e);
  }
}

/** 只有優惠文章與 Uber Eats 頁面可以用橋接 */
function senderAllowed(event) {
  const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
  return lib.isScriptHost(lib.hostOf(url));
}

ipcMain.on('uepa:get', (event, key) => {
  event.returnValue = senderAllowed(event) && Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
});

ipcMain.on('uepa:set', (event, key, value) => {
  if (senderAllowed(event)) {
    store[key] = String(value);
    saveStore();
  }
  event.returnValue = true;
});

ipcMain.on('uepa:http', async (event, url, id) => {
  const wc = event.sender;
  let status = 0;
  let text = '';
  if (senderAllowed(event) && lib.isSourceUrl(url)) {
    try {
      const res = await session.fromPartition(PARTITION).fetch(url, {
        headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
      });
      status = res.status;
      text = await res.text();
    } catch (e) {
      status = 0;
    }
  }
  if (wc.isDestroyed()) return;
  const js = `window.__uepaHttpCallback&&window.__uepaHttpCallback(${Number(id)},${status},${JSON.stringify(text)})`;
  wc.executeJavaScript(js).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* 注入 userscript 與腳本更新                                            */
/* ------------------------------------------------------------------ */

const readAsset = (name) => fs.readFileSync(path.join(__dirname, 'assets', name), 'utf8');

/** 內建腳本與下載到的新版腳本，取版本較新的那一個 */
function currentScript() {
  const bundled = readAsset('ubereats-promo-autofill.user.js');
  try {
    const downloaded = fs.readFileSync(cachedScriptFile(), 'utf8');
    if (lib.compareVersions(lib.versionOf(downloaded), lib.versionOf(bundled)) > 0) return downloaded;
  } catch (e) {
    /* 沒有下載過 */
  }
  return bundled;
}

function injectIfNeeded(wc) {
  if (!lib.isScriptHost(lib.hostOf(wc.getURL()))) return;
  wc.executeJavaScript(lib.buildInjection(readAsset('gm-shim.js'), currentScript())).catch((e) =>
    console.error('注入腳本失敗', e)
  );
}

async function checkForScriptUpdate(userRequested) {
  let message;
  try {
    const res = await session.fromPartition(PARTITION).fetch(lib.SCRIPT_UPDATE_URL, { cache: 'no-store' });
    const body = await res.text();
    if (res.status !== 200 || !body.includes('// ==UserScript==')) {
      message = `無法檢查更新（HTTP ${res.status}）。repo 需要是公開的才能自動更新。`;
    } else {
      const latest = lib.versionOf(body);
      const current = lib.versionOf(currentScript());
      if (lib.compareVersions(latest, current) > 0) {
        writeFileAtomic(cachedScriptFile(), body);
        message = `腳本已更新到 ${latest}，重新整理頁面後生效。`;
        userRequested = true; // 有更新一定告訴使用者
      } else {
        message = `已經是最新版（${current}）。`;
      }
    }
  } catch (e) {
    message = `無法檢查更新：${e.message}`;
  }
  if (userRequested && win && !win.isDestroyed()) {
    dialog.showMessageBox(win, { type: 'info', title: '檢查腳本更新', message });
  }
}

/* ------------------------------------------------------------------ */
/* 視窗與選單                                                            */
/* ------------------------------------------------------------------ */

function webPreferences() {
  return {
    partition: PARTITION,
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

function setUpWebContents(wc) {
  wc.on('did-finish-load', () => injectIfNeeded(wc));
  // 留在 App 內；ubereats:// 之類的連結直接忽略
  wc.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      // 登入用的彈出視窗（例如 Apple / Google 登入）
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 760, webPreferences: webPreferences() } };
    }
    if (/^(mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function goBack() {
  const history = win.webContents.navigationHistory;
  if (history && history.canGoBack()) history.goBack();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '頁面',
      submenu: [
        { label: 'Uber Eats 首頁', accelerator: 'CmdOrCtrl+Shift+H', click: () => win.loadURL(HOME_URL) },
        { label: '打開優惠文章（手動擷取）', click: () => win.loadURL(lib.SOURCE_URL) },
        { type: 'separator' },
        { label: '上一頁', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: goBack },
        { label: '重新整理', role: 'reload' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '縮小', role: 'zoomOut' },
        { label: '實際大小', role: 'resetZoom' },
        ...(isMac ? [] : [{ type: 'separator' }, { label: '結束', role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: '說明',
      submenu: [
        { label: '檢查腳本更新', click: () => checkForScriptUpdate(true) },
        {
          label: '版本資訊',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: '版本資訊',
              message: `App ${app.getVersion()}｜腳本 ${lib.versionOf(currentScript())}`,
            }),
        },
        { type: 'separator' },
        { label: '開發者工具', role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: 'UberEat 優惠碼',
    webPreferences: webPreferences(),
  });
  setUpWebContents(win.webContents);
  win.loadURL(START_URL);
}

app.on('web-contents-created', (event, wc) => {
  // 彈出視窗也套用同樣的規則
  if (wc.getType() === 'window' && win && wc !== win.webContents) setUpWebContents(wc);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    loadStore();
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(lib.browserLikeUserAgent(ses.getUserAgent()));
    buildMenu();
    createWindow();
    if (!process.env.UEPA_START_URL) checkForScriptUpdate(false);
  });

  app.on('window-all-closed', () => app.quit());
}
