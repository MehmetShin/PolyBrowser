const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { execFile } = require('child_process');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  Menu,
  nativeTheme,
  dialog
} = require('electron');
const PolyStore = require('./store');
const PolyAdBlocker = require('./adblocker');
const { PolyVPN } = require('./vpn');
const PolySafeBrowsing = require('./safebrowsing');
const { PolyPasswordStore, fillTabInputs } = require('./passwords');
const PolyBrowserImporter = require('./importer');
const PolyUpdater = require('./updater');

// App identity
app.setName('Poly');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.poly.browser');
}

// Performance & low-RAM optimization flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('process-per-site');
app.commandLine.appendSwitch('renderer-process-limit', '4');
app.commandLine.appendSwitch('disable-features', 'BackForwardCache');
app.commandLine.appendSwitch('disk-cache-size', String(48 * 1024 * 1024));
app.commandLine.appendSwitch('js-flags', '--expose-gc --optimize-for-size --max-old-space-size=256');

const NEWTAB_PATH = path.join(__dirname, '..', 'renderer', 'newtab.html');
const NEWTAB_URL = 'poly://newtab';
const PASSWORDS_PATH = path.join(__dirname, '..', 'renderer', 'passwords.html');
const PASSWORDS_URL = 'poly://passwords';
const PASSWORDS_PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'passwords-preload.js');
const WARNING_PATH = path.join(__dirname, '..', 'renderer', 'warning.html');

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  yandex: 'https://yandex.com/search/?text=',
  brave: 'https://search.brave.com/search?q='
};

let mainWindow = null;
let updater = null;
let overlayView = null;
let currentOverlayPanel = null;
let suggestionsView = null;
let suggestionsRect = null;
let isSuggestionsOpen = false;
let suggestionsSeq = 0;
let siteInfoView = null;
let siteInfoRect = null;
let isSiteInfoOpen = false;
let siteInfoSeq = 0;
let autofillView = null;
let autofillRect = null;
let isAutofillOpen = false;
let autofillSeq = 0;
let autofillTabId = null;
let store = null;
let adBlocker = null;
let vpn = null;
let safeBrowsing = null;
let passwordStore = null;
let importer = null;

// Browser state
const tabs = new Map(); // id -> tab object
let tabOrder = []; // ordered array of tab ids
let activeTabId = null;
let splitTabId = null;
let focusedPane = 'left'; // 'left' | 'right'
let viewportRect = { x: 56, y: 84, width: 1144, height: 716 };
let downloads = [];
const activeDownloadItems = new Map();
let metricsInterval = null;
let lastMetrics = { totalRamMB: 0, cpuPercent: 0, tabRamMB: {} };

function generateId(prefix = 'tab') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveUrl(rawInput) {
  const input = (rawInput || '').trim();
  if (!input || input === NEWTAB_URL || input.toLowerCase().includes('newtab.html')) return NEWTAB_URL;
  if (input === PASSWORDS_URL || input.toLowerCase().includes('passwords.html')) return PASSWORDS_URL;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(input)) {
    return `http://${input}`;
  }
  if (!/\s/.test(input) && /\.[a-z]{2,}(\/|$)/i.test(input)) {
    return `https://${input}`;
  }
  const engineKey = store.getSettings().searchEngine || 'google';
  const base = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.google;
  return base + encodeURIComponent(input);
}

function getTargetTabId() {
  if (splitTabId && focusedPane === 'right' && tabs.has(splitTabId)) {
    return splitTabId;
  }
  return activeTabId;
}

function serializeTabs() {
  return {
    tabs: tabOrder
      .map((id) => tabs.get(id))
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        isSleeping: t.isSleeping,
        isLoading: t.isLoading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        audioMuted: t.audioMuted,
        isPlayingAudio: t.isPlayingAudio,
        ramMB: lastMetrics.tabRamMB[t.id] || 0,
        blockedCount: t.webContentsId ? adBlocker.getTabBlockedCount(t.webContentsId) : 0
      })),
    activeTabId,
    splitTabId,
    focusedPane
  };
}

function broadcastTabs() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tabs:updated', serializeTabs());
  }
}

function showTabWarning(tab, info = {}) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
  const theme = (store && store.getSettings().theme) || 'dark';
  const targetUrl = info.url || tab.url || '';
  let host = info.host || '';
  if (!host && targetUrl) {
    try { host = new URL(targetUrl).hostname; } catch (_) { host = targetUrl; }
  }
  tab.url = targetUrl;
  tab.isLoading = false;
  tab.title = info.type === 'cert' ? 'Bağlantınız gizli değil' : 'Tehlikeli site';
  tab.view.webContents.loadFile(WARNING_PATH, {
    query: {
      type: info.type || 'danger',
      url: targetUrl,
      host,
      reason: info.reason || '',
      err: info.err || '',
      issuer: info.issuer || '',
      theme
    }
  });
  broadcastTabs();
}

function adjustTabZoom(wc, delta) {
  if (!wc || wc.isDestroyed()) return;
  const cur = wc.getZoomFactor();
  const next = Math.min(3.0, Math.max(0.25, Math.round((cur + delta) * 100) / 100));
  wc.setZoomFactor(next);
}

function handleBrowserShortcut(event, input, explicitTab = null) {
  if (!input || input.type !== 'keyDown') return;

  const ctrl = !!(input.control && !input.alt && !input.meta);
  const ctrlOnly = !!(ctrl && !input.shift);
  const ctrlShift = !!(ctrl && input.shift);
  const altOnly = !!(input.alt && !input.control && !input.shift && !input.meta);
  const plain = !!(!input.control && !input.shift && !input.alt && !input.meta);

  const key = (input.key || '').toLowerCase();
  const code = input.code || '';

  const targetTab = explicitTab || tabs.get(getTargetTabId());
  const wc = targetTab?.view?.webContents && !targetTab.view.webContents.isDestroyed()
    ? targetTab.view.webContents
    : null;

  const prevent = () => {
    try { event.preventDefault(); } catch (_) {}
  };

  // F5 / Ctrl+R: Reload, Ctrl+F5 / Ctrl+Shift+R: Hard reload
  if ((plain && key === 'f5') || (ctrlOnly && key === 'r')) {
    prevent();
    if (wc) {
      closeSiteInfoView({ restoreFocus: false });
      wc.reload();
    }
    return;
  }
  if ((ctrlOnly && key === 'f5') || (ctrlShift && key === 'r')) {
    prevent();
    if (wc) {
      closeSiteInfoView({ restoreFocus: false });
      wc.reloadIgnoringCache();
    }
    return;
  }

  // F12 / Ctrl+Shift+I / Ctrl+Shift+J: Developer Tools
  if ((plain && key === 'f12') || (ctrlShift && (key === 'i' || key === 'j'))) {
    prevent();
    if (wc) {
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    }
    return;
  }

  // F6 / Ctrl+L / Alt+D: Focus address bar
  if ((plain && key === 'f6') || (ctrlOnly && key === 'l') || (altOnly && key === 'd')) {
    prevent();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
      mainWindow.webContents.send('omnibox:focus');
    }
    return;
  }

  // F11: Fullscreen
  if (plain && key === 'f11') {
    prevent();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    return;
  }

  // Ctrl+T: New tab
  if (ctrlOnly && key === 't') {
    prevent();
    createTab(NEWTAB_URL, true);
    return;
  }

  // Ctrl+W / Ctrl+F4: Close tab
  if (ctrlOnly && (key === 'w' || key === 'f4')) {
    prevent();
    if (targetTab) closeTab(targetTab.id);
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageDown / Ctrl+PageUp: Switch tabs
  if ((ctrlOnly && (key === 'tab' || key === 'pagedown')) || (ctrlShift && key === 'tab') || (ctrlOnly && key === 'pageup')) {
    prevent();
    if (tabOrder.length > 1) {
      const curId = getTargetTabId();
      const idx = Math.max(0, tabOrder.indexOf(curId));
      const backward = ctrlShift || key === 'pageup';
      const nextIdx = backward
        ? (idx - 1 + tabOrder.length) % tabOrder.length
        : (idx + 1) % tabOrder.length;
      activateTab(tabOrder[nextIdx]);
    }
    return;
  }

  // Ctrl+1..9: Jump to tab
  if (ctrlOnly && /^[1-9]$/.test(key)) {
    prevent();
    if (tabOrder.length > 0) {
      const n = parseInt(key, 10);
      const targetIdx = n === 9 ? tabOrder.length - 1 : Math.min(n - 1, tabOrder.length - 1);
      if (tabOrder[targetIdx]) activateTab(tabOrder[targetIdx]);
    }
    return;
  }

  // Alt+Left / Alt+Right / BrowserBack / BrowserForward / Alt+Home: Navigation
  if ((altOnly && key === 'arrowleft') || (plain && key === 'browserback')) {
    prevent();
    if (wc && (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack())) {
      closeSiteInfoView({ restoreFocus: false });
      wc.goBack();
    }
    return;
  }
  if ((altOnly && key === 'arrowright') || (plain && key === 'browserforward')) {
    prevent();
    if (wc && (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward())) {
      closeSiteInfoView({ restoreFocus: false });
      wc.goForward();
    }
    return;
  }
  if (altOnly && key === 'home') {
    prevent();
    if (targetTab && wc) {
      closeSiteInfoView({ restoreFocus: false });
      targetTab.url = NEWTAB_URL;
      targetTab.title = 'Yeni Sekme';
      loadNewTab(wc);
      broadcastTabs();
    }
    return;
  }

  // Zoom: Ctrl + (+ / = / NumpadAdd), Ctrl + (- / NumpadSubtract), Ctrl + 0
  if (ctrl && (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd')) {
    prevent();
    if (wc) adjustTabZoom(wc, 0.1);
    return;
  }
  if (ctrl && (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract')) {
    prevent();
    if (wc) adjustTabZoom(wc, -0.1);
    return;
  }
  if (ctrlOnly && (key === '0' || code === 'Digit0' || code === 'Numpad0')) {
    prevent();
    if (wc) wc.setZoomFactor(1.0);
    return;
  }

  // Ctrl+H (History), Ctrl+J (Downloads), Ctrl+D (Bookmark), Ctrl+P (Print), Ctrl+U (View Source)
  if (ctrlOnly && key === 'h') {
    prevent();
    showOverlay('history');
    return;
  }
  if (ctrlOnly && key === 'j') {
    prevent();
    showOverlay('downloads');
    return;
  }
  if (ctrlOnly && key === 'p') {
    prevent();
    if (wc) wc.print();
    return;
  }
  if (ctrlOnly && key === 'u') {
    prevent();
    if (targetTab && targetTab.url && !targetTab.url.startsWith('poly://')) {
      createTab('view-source:' + targetTab.url, true);
    }
    return;
  }
  if (ctrlOnly && key === 'd') {
    prevent();
    if (targetTab && targetTab.url && !targetTab.url.startsWith('poly://') && store) {
      const existing = store.getAll().bookmarks.find((b) => b.url === targetTab.url);
      const updated = existing
        ? store.removeBookmark(targetTab.url)
        : store.addBookmark({ title: targetTab.title || targetTab.url, url: targetTab.url, favicon: targetTab.favicon || '' });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bookmarks:updated', updated);
      if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
        overlayView.webContents.send('bookmarks:updated', updated);
      }
    }
  }
}

function attachViewEvents(tab) {
  const wc = tab.view.webContents;
  tab.webContentsId = wc.id;
  if (vpn) vpn.applyWebRTCPolicy(wc);
  wc.on('before-input-event', (event, input) => handleBrowserShortcut(event, input, tab));

  const handleNav = (navUrl) => {
    const raw = navUrl || (wc && !wc.isDestroyed() ? wc.getURL() : '');
    if (!raw) return;
    if (raw.startsWith('poly-action://')) return;
    const isNewTabFile =
      raw === NEWTAB_URL ||
      (raw.startsWith('file://') && raw.toLowerCase().includes('newtab.html'));
    const isPasswordsFile =
      raw === PASSWORDS_URL ||
      (raw.startsWith('file://') && raw.toLowerCase().includes('passwords.html'));
    const isWarningFile = raw.startsWith('file://') && raw.toLowerCase().includes('warning.html');
    if (isWarningFile) {
      try {
        const u = new URL(raw);
        const orig = u.searchParams.get('url');
        if (orig) tab.url = orig;
      } catch (_) {}
      broadcastTabs();
      return;
    }
    tab.url = isNewTabFile ? NEWTAB_URL : isPasswordsFile ? PASSWORDS_URL : raw;
    if (tab.url === NEWTAB_URL) {
      tab.title = 'Yeni Sekme';
      tab.favicon = '';
    } else if (tab.url === PASSWORDS_URL) {
      tab.title = 'Poly Şifre Yöneticisi';
      tab.favicon = '';
    } else {
      store.addHistory({ title: tab.title, url: tab.url });
    }
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    broadcastTabs();
  };

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    handleNav();
    broadcastTabs();
  });

  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    handleNav();
    tab.canGoBack = wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
    tab.canGoForward = wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
    broadcastTabs();
  });

  wc.on('did-finish-load', () => {
    handleNav();
    const cur = wc && !wc.isDestroyed() ? wc.getURL() : '';
    if (
      cur &&
      (cur.startsWith('http://') || cur.startsWith('https://')) &&
      passwordStore &&
      store &&
      store.getSettings().autofillEnabled !== false
    ) {
      const isAuthChallenge = /two_step_verification|two-factor|2fa|challenge|checkpoint|otp|verify/i.test(cur);
      const creds = isAuthChallenge ? [] : passwordStore.getForUrl(cur);
      if (creds.length === 1) {
        fillTabInputs(wc, { credential: creds[0], profile: null }).catch(() => {});
      }
    }
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 is ERR_ABORTED
    if (errorCode <= -200 && errorCode >= -217 && validatedURL && validatedURL.startsWith('https://')) {
      showTabWarning(tab, {
        type: 'cert',
        url: validatedURL,
        err: `NET::${errorDescription || 'ERR_CERT_INVALID'}`
      });
    }
  });

  wc.on('page-title-updated', (_e, title) => {
    if (tab.url === NEWTAB_URL) {
      tab.title = 'Yeni Sekme';
    } else {
      tab.title = title || tab.url;
    }
    broadcastTabs();
  });

  wc.on('page-favicon-updated', (_e, favicons) => {
    if (favicons && favicons.length > 0 && tab.url !== NEWTAB_URL) {
      tab.favicon = favicons[0];
      broadcastTabs();
    }
  });

  wc.on('did-navigate', (_e, url) => handleNav(url));
  wc.on('did-navigate-in-page', (_e, url) => handleNav(url));
  wc.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && url) {
      if (tab.id === autofillTabId) closeAutofillView({ restoreFocus: false });
      handleNav(url);
    }
  });
  wc.on('will-navigate', (event, url) => {
    if (tab.viewIsPrivileged && url && !url.toLowerCase().includes('passwords.html') && !url.startsWith('poly-action://')) {
      event.preventDefault();
      tab.url = resolveUrl(url);
      recreateTabView(tab);
      return;
    }
    if (url && url.startsWith('poly-action://')) {
      const current = wc.getURL() || '';
      if (current.startsWith('file://') && current.toLowerCase().includes('warning.html')) {
        event.preventDefault();
        try {
          const actionUrl = new URL(url);
          const action = actionUrl.hostname;
          if (action === 'safe') {
            loadNewTab(wc);
          } else if (action === 'reload') {
            const target = actionUrl.searchParams.get('url');
            if (target) wc.loadURL(target);
          } else if (action === 'proceed') {
            const type = actionUrl.searchParams.get('type');
            const target = actionUrl.searchParams.get('url');
            if (target && safeBrowsing) {
              if (type === 'cert') safeBrowsing.bypassCert(target);
              else safeBrowsing.bypassSite(target);
              wc.loadURL(target);
            }
          }
        } catch (_) {}
        return;
      }
    }
    if (
      url &&
      safeBrowsing &&
      store &&
      store.getSettings().safeBrowsingEnabled !== false
    ) {
      const verdict = safeBrowsing.checkUrl(url);
      if (verdict.blocked) {
        event.preventDefault();
        showTabWarning(tab, {
          type: 'danger',
          url,
          host: verdict.host,
          reason: verdict.reason
        });
        return;
      }
    }
    handleNav(url);
  });
  wc.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (
      isMainFrame &&
      url &&
      safeBrowsing &&
      store &&
      store.getSettings().safeBrowsingEnabled !== false
    ) {
      const verdict = safeBrowsing.checkUrl(url);
      if (verdict.blocked) {
        event.preventDefault();
        showTabWarning(tab, {
          type: 'danger',
          url,
          host: verdict.host,
          reason: verdict.reason
        });
      }
    }
  });
  wc.on('did-redirect-navigation', (_e, url) => handleNav(url));

  wc.on('media-started-playing', () => {
    tab.isPlayingAudio = true;
    broadcastTabs();
  });

  wc.on('media-paused', () => {
    tab.isPlayingAudio = false;
    broadcastTabs();
  });

  // Open target="_blank" links in a new Poly tab, while allowing JS/OAuth popups
  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    const isPopupFeatures = Boolean(features && /width=|height=|popup/i.test(features));
    const isBlankOrOpener = !url || url === 'about:blank' || url.startsWith('javascript:');
    if (isBlankOrOpener || (disposition === 'new-window' && isPopupFeatures)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560,
          height: 680,
          autoHideMenuBar: true,
          backgroundColor: '#151824',
          title: 'Poly',
          icon: path.join(__dirname, '..', 'assets', 'icon.png')
        }
      };
    }
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      createTab(url, disposition !== 'background-tab');
    }
    return { action: 'deny' };
  });

  wc.on('focus', () => {
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    if (autofillTabId && autofillTabId !== tab.id) {
      closeAutofillView({ restoreFocus: false });
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omnibox:blur');
    }
    if (currentOverlayPanel) {
      closeOverlay();
    }
    if (tab.id === splitTabId) {
      focusedPane = 'right';
      broadcastTabs();
    } else if (tab.id === activeTabId) {
      focusedPane = 'left';
      broadcastTabs();
    }
  });

  // Native Web Page Context Menu (Right Click)
  wc.on('context-menu', (_e, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const template = [];

    if (params.linkURL) {
      template.push(
        {
          label: 'Bağlantıyı yeni sekmede aç',
          click: () => createTab(params.linkURL, true)
        },
        {
          label: 'Bağlantı adresini kopyala',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.linkURL);
          }
        },
        { type: 'separator' }
      );
    }

    if (params.hasImageContents && params.srcURL) {
      template.push(
        {
          label: 'Resmi yeni sekmede aç',
          click: () => createTab(params.srcURL, true)
        },
        {
          label: 'Resim adresini kopyala',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.srcURL);
          }
        },
        { type: 'separator' }
      );
    }

    if (params.selectionText && params.selectionText.trim().length > 0) {
      const q = params.selectionText.trim();
      const preview = q.length > 25 ? q.slice(0, 25) + '...' : q;
      template.push(
        {
          label: 'Kopyala',
          role: 'copy'
        },
        {
          label: `Google'da ara: "${preview}"`,
          click: () => {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
            createTab(searchUrl, true);
          }
        },
        { type: 'separator' }
      );
    }

    if (params.isEditable) {
      template.push(
        { label: 'Geri Al', role: 'undo' },
        { label: 'Yinele', role: 'redo' },
        { type: 'separator' },
        { label: 'Kes', role: 'cut' },
        { label: 'Kopyala', role: 'copy' },
        { label: 'Yapıştır', role: 'paste' },
        { label: 'Tümünü Seç', role: 'selectAll' },
        { type: 'separator' }
      );
    }

    template.push(
      {
        label: 'Geri',
        enabled: tab.canGoBack,
        click: () => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack())
      },
      {
        label: 'İleri',
        enabled: tab.canGoForward,
        click: () => (wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward())
      },
      {
        label: 'Yeniden Yükle',
        click: () => wc.reload()
      },
      { type: 'separator' },
      {
        label: 'İncele (DevTools)',
        click: () => wc.inspectElement(params.x, params.y)
      }
    );

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });
}

function loadNewTab(wc) {
  const s = store.getSettings();
  wc.loadFile(NEWTAB_PATH, {
    query: {
      theme: s.theme || 'dark',
      accent: s.accentColor || '#7c5cff',
      clock: s.showClock === false ? '0' : '1',
      dial: s.showSpeedDial === false ? '0' : '1',
      engine: s.searchEngine || 'google'
    }
  });
}

function loadPasswordsPage(wc) {
  const s = store.getSettings();
  wc.loadFile(PASSWORDS_PATH, {
    query: {
      theme: s.theme || 'dark',
      accent: s.accentColor || '#7c5cff'
    }
  });
}

function recreateTabView(tab) {
  if (tab.view && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(tab.view); } catch (_) {}
    try { tab.view.webContents.close(); } catch (_) {}
  }
  tab.view = null;
  createViewForTab(tab);
  layoutViews();
  broadcastTabs();
}

function createViewForTab(tab) {
  const theme = store.getSettings().theme || 'dark';
  const wantPrivileged = tab.url === PASSWORDS_URL;
  const webPreferences = wantPrivileged
    ? {
        preload: PASSWORDS_PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    : {
        preload: path.join(__dirname, '..', 'preload', 'web-autofill-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      };
  const view = new WebContentsView({ webPreferences });
  view.setBackgroundColor(theme === 'light' ? '#f0f3f8' : '#0b0c10');
  tab.view = view;
  tab.viewIsPrivileged = wantPrivileged;
  tab.isSleeping = false;
  tab.lastActiveAt = Date.now();
  attachViewEvents(tab);

  if (tab.url === NEWTAB_URL) {
    loadNewTab(view.webContents);
  } else if (tab.url === PASSWORDS_URL) {
    tab.title = 'Poly Şifre Yöneticisi';
    loadPasswordsPage(view.webContents);
  } else if (
    safeBrowsing &&
    store &&
    store.getSettings().safeBrowsingEnabled !== false
  ) {
    const verdict = safeBrowsing.checkUrl(tab.url);
    if (verdict.blocked) {
      showTabWarning(tab, {
        type: 'danger',
        url: tab.url,
        host: verdict.host,
        reason: verdict.reason
      });
      return;
    }
    view.webContents.loadURL(tab.url);
  } else {
    view.webContents.loadURL(tab.url);
  }
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const { x, y, width, height } = viewportRect;
  if (width <= 10 || height <= 10) return;

  const leftTab = tabs.get(activeTabId);
  const rightTab = splitTabId ? tabs.get(splitTabId) : null;
  const keepSet = new Set();
  if (leftTab) {
    if (leftTab.isSleeping || !leftTab.view) createViewForTab(leftTab);
    if (leftTab.view) keepSet.add(leftTab.view);
  }
  if (rightTab && (!leftTab || rightTab.id !== leftTab.id)) {
    if (rightTab.isSleeping || !rightTab.view) createViewForTab(rightTab);
    if (rightTab.view) keepSet.add(rightTab.view);
  }

  // Detach only inactive tab views so visible active views never lose OS/DOM input focus
  for (const tab of tabs.values()) {
    if (tab.view) {
      const isVisible = keepSet.has(tab.view);
      try {
        if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.setBackgroundThrottling(!isVisible);
        }
      } catch (_) {}
      if (!isVisible) {
        try {
          mainWindow.contentView.removeChildView(tab.view);
        } catch (_) {}
      }
    }
  }

  const attached = new Set(mainWindow.contentView.children || []);

  if (leftTab && leftTab.view) {
    if (!attached.has(leftTab.view)) {
      mainWindow.contentView.addChildView(leftTab.view);
    }

    if (rightTab && rightTab.id !== leftTab.id && rightTab.view) {
      const gap = 4;
      const halfW = Math.floor((width - gap) / 2);
      leftTab.view.setBounds({ x, y, width: halfW, height });
      if (!attached.has(rightTab.view)) {
        mainWindow.contentView.addChildView(rightTab.view);
      }
      rightTab.view.setBounds({ x: x + halfW + gap, y, width: width - halfW - gap, height });
    } else {
      leftTab.view.setBounds({ x, y, width, height });
    }
  }

  if (overlayView && currentOverlayPanel) {
    try {
      mainWindow.contentView.removeChildView(overlayView);
    } catch (_) {}
    mainWindow.contentView.addChildView(overlayView);
    positionOverlay();
  }
}

function focusActiveTabView() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;
  if (currentOverlayPanel || isSuggestionsOpen || isSiteInfoOpen || isAutofillOpen) return;
  const tab = tabs.get(getTargetTabId());
  if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
    try {
      tab.view.webContents.focus();
    } catch (_) {}
  }
}

function createTab(rawUrl = NEWTAB_URL, activate = true) {
  closeSuggestionsView({ restoreFocus: false });
  closeSiteInfoView({ restoreFocus: false });
  closeAutofillView({ restoreFocus: false });
  const id = generateId('tab');
  const url = resolveUrl(rawUrl);
  const tab = {
    id,
    title: url === NEWTAB_URL ? 'Yeni Sekme' : url,
    url,
    favicon: '',
    isSleeping: false,
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
    audioMuted: false,
    isPlayingAudio: false,
    lastActiveAt: Date.now(),
    webContentsId: null,
    view: null
  };

  tabs.set(id, tab);
  tabOrder.push(id);
  createViewForTab(tab);

  if (activate) {
    activeTabId = id;
    focusedPane = 'left';
  }
  layoutViews();
  broadcastTabs();
  if (activate && url === NEWTAB_URL && mainWindow && !mainWindow.isDestroyed()) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && activeTabId === id) {
        mainWindow.webContents.focus();
        mainWindow.webContents.send('omnibox:focus');
      }
    }, 35);
  }
  return id;
}

function hibernateTab(id) {
  const tab = tabs.get(id);
  if (!tab || tab.isSleeping) return false;
  // Never hibernate currently visible tabs
  if (id === activeTabId || id === splitTabId) return false;

  if (tab.view) {
    try {
      mainWindow.contentView.removeChildView(tab.view);
    } catch (_) {}
    try {
      tab.view.webContents.close();
    } catch (_) {}
  }
  if (tab.webContentsId) {
    adBlocker.clearTab(tab.webContentsId);
  }
  tab.view = null;
  tab.webContentsId = null;
  tab.isSleeping = true;
  tab.isLoading = false;
  tab.isPlayingAudio = false;
  store.incrementHibernations(1);
  broadcastTabs();
  return true;
}

function hibernateAllInactive() {
  let count = 0;
  for (const id of tabOrder) {
    if (hibernateTab(id)) count++;
  }
  return count;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  closeSuggestionsView({ restoreFocus: false });
  closeSiteInfoView({ restoreFocus: false });
  closeAutofillView({ restoreFocus: false });

  if (tab.view) {
    try {
      mainWindow.contentView.removeChildView(tab.view);
    } catch (_) {}
    try {
      tab.view.webContents.close();
    } catch (_) {}
  }
  if (tab.webContentsId) {
    adBlocker.clearTab(tab.webContentsId);
  }

  const idx = tabOrder.indexOf(id);
  tabs.delete(id);
  tabOrder = tabOrder.filter((tId) => tId !== id);

  // If the last tab is closed, close the browser directly (Chrome behavior)
  if (tabOrder.length === 0) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    } else {
      app.quit();
    }
    return;
  }

  if (splitTabId === id) {
    splitTabId = null;
    focusedPane = 'left';
  }

  if (activeTabId === id) {
    const nextIdx = Math.min(idx, tabOrder.length - 1);
    activeTabId = tabOrder[nextIdx];
  }

  layoutViews();
  broadcastTabs();
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  closeSuggestionsView({ restoreFocus: false });
  closeSiteInfoView({ restoreFocus: false });
  closeAutofillView({ restoreFocus: false });

  if (splitTabId === id) {
    focusedPane = 'right';
  } else {
    activeTabId = id;
    focusedPane = 'left';
  }
  tab.lastActiveAt = Date.now();
  layoutViews();
  broadcastTabs();
  focusActiveTabView();
}

function collectMetrics() {
  const appMetrics = app.getAppMetrics();
  let totalKB = 0;
  let totalCPU = 0;
  const pidRamMap = new Map();

  for (const proc of appMetrics) {
    const kb = proc.memory ? proc.memory.workingSetSize : 0;
    totalKB += kb;
    totalCPU += proc.cpu ? proc.cpu.percentCPUUsage : 0;
    pidRamMap.set(proc.pid, Math.round(kb / 1024));
  }

  const totalRamMB = Math.round(totalKB / 1024);
  const tabRamMB = {};
  for (const tab of tabs.values()) {
    if (tab.view && !tab.isSleeping) {
      try {
        const pid = tab.view.webContents.getOSProcessId();
        tabRamMB[tab.id] = pidRamMap.get(pid) || 0;
      } catch (_) {
        tabRamMB[tab.id] = 0;
      }
    } else {
      tabRamMB[tab.id] = 0;
    }
  }

  lastMetrics = {
    totalRamMB,
    cpuPercent: Math.round(totalCPU * 10) / 10,
    tabRamMB,
    sleepingCount: Array.from(tabs.values()).filter((t) => t.isSleeping).length,
    totalTabs: tabs.size
  };
  return lastMetrics;
}

function startMetricsAndHibernationLoop() {
  if (metricsInterval) clearInterval(metricsInterval);
  collectMetrics();
  metricsInterval = setInterval(() => {
    const metrics = collectMetrics();
    const totalRamMB = metrics.totalRamMB;

    // Auto-hibernation by idle time
    const settings = store.getSettings();
    const idleMs = (settings.hibernationMinutes || 0) * 60 * 1000;
    const now = Date.now();
    let hibernatedAny = false;

    if (idleMs > 0) {
      for (const tab of tabs.values()) {
        if (
          !tab.isSleeping &&
          tab.id !== activeTabId &&
          tab.id !== splitTabId &&
          !tab.isPlayingAudio &&
          now - tab.lastActiveAt > idleMs
        ) {
          if (hibernateTab(tab.id)) hibernatedAny = true;
        }
      }
    }

    // Auto-hibernation if total RAM exceeds soft limit
    if (settings.autoHibernateOnLimit && totalRamMB > (settings.ramLimitMB || 900)) {
      const candidates = Array.from(tabs.values())
        .filter(
          (t) =>
            !t.isSleeping &&
            t.id !== activeTabId &&
            t.id !== splitTabId &&
            !t.isPlayingAudio
        )
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt);

      if (candidates.length > 0) {
        if (hibernateTab(candidates[0].id)) hibernatedAny = true;
      }
      if (typeof global.gc === 'function') {
        try { global.gc(); } catch (_) {}
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('metrics:updated', lastMetrics);
      if (hibernatedAny) broadcastTabs();
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('metrics:updated', lastMetrics);
    }
  }, 3000);
}

function getUniqueDownloadPath(filename) {
  const dir = app.getPath('downloads');
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let idx = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${idx})${ext}`);
    idx++;
  }
  return candidate;
}

function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    // Auto-close temporary download tab (like Chrome)
    const itemUrl = item.getURL();
    const chain = (item.getURLChain && item.getURLChain()) || [];
    for (const [tId, tab] of tabs.entries()) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      const wcId = tab.view.webContents.id;
      const isMatchingWebContents = webContents && (wcId === webContents.id || tab.view.webContents === webContents);
      const isMatchingUrl = tab.url === itemUrl || chain.includes(tab.url) ||
        (tab.url && (tab.url.endsWith('.exe') || tab.url.endsWith('.zip') || tab.url.endsWith('.rar') || tab.url.endsWith('.tar.gz') || tab.url.endsWith('.msi')));

      if (isMatchingWebContents || isMatchingUrl) {
        setTimeout(() => {
          if (!tabs.has(tId)) return;
          if (tabOrder.length > 1) {
            closeTab(tId);
          } else {
            loadNewTab(tab.view.webContents);
            tab.url = NEWTAB_URL;
            tab.title = 'Yeni Sekme';
            broadcastTabs();
          }
        }, 200);
        break;
      }
    }

    const id = generateId('dl');
    const filename = item.getFilename() || 'download';
    const savePath = getUniqueDownloadPath(filename);
    item.setSavePath(savePath);
    activeDownloadItems.set(id, item);

    const dl = {
      id,
      filename: path.basename(savePath),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      savePath
    };
    downloads.unshift(dl);
    if (downloads.length > 30) downloads.length = 30;

    const sendUpdate = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('downloads:updated', downloads);
      }
      if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
        overlayView.webContents.send('downloads:updated', downloads);
      }
    };
    sendUpdate();

    item.on('updated', (_e, state) => {
      dl.receivedBytes = item.getReceivedBytes();
      dl.totalBytes = item.getTotalBytes();
      dl.state = state;
      dl.savePath = item.getSavePath() || savePath;
      sendUpdate();
    });

    item.once('done', (_e, state) => {
      activeDownloadItems.delete(id);
      dl.receivedBytes = item.getReceivedBytes();
      dl.totalBytes = item.getTotalBytes();
      dl.state = state;
      dl.savePath = item.getSavePath() || savePath;
      sendUpdate();
    });
  });
}

function positionOverlay() {
  if (!overlayView || !currentOverlayPanel || !mainWindow || mainWindow.isDestroyed()) return;
  const topY = viewportRect.y || 88;
  const overlayH = viewportRect.height || 600;
  const startX = viewportRect.x || 56;
  overlayView.setBounds({
    x: startX,
    y: topY,
    width: 320,
    height: overlayH
  });
}

function closeOverlay() {
  if (overlayView && mainWindow && !mainWindow.isDestroyed()) {
    try {
      overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      mainWindow.contentView.removeChildView(overlayView);
    } catch (_) {}
  }
  currentOverlayPanel = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('flyout:closed');
  }
  focusActiveTabView();
}

function showOverlay(panel) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  closeSiteInfoView({ restoreFocus: false });
  closeSuggestionsView({ restoreFocus: false });
  closeAutofillView({ restoreFocus: false });

  if (currentOverlayPanel === panel) {
    closeOverlay();
    return;
  }
  currentOverlayPanel = panel;

  const currentTheme = store ? (store.getSettings().theme || 'dark') : 'dark';
  const overlayBg = currentTheme === 'light' ? '#ffffff' : '#151824';

  if (!overlayView) {
    overlayView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    overlayView.setBackgroundColor(overlayBg);
    overlayView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'flyout.html'));
  } else {
    overlayView.setBackgroundColor(overlayBg);
  }

  try {
    mainWindow.contentView.removeChildView(overlayView);
  } catch (_) {}
  mainWindow.contentView.addChildView(overlayView);
  positionOverlay();

  const sendPayload = () => {
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.send('flyout:show', {
        panel,
        ...store.getAll(),
        tabsState: serializeTabs(),
        metrics: lastMetrics,
        downloads,
        passwords: passwordStore ? passwordStore.list() : [],
        autofillProfile: store.getAutofillProfile(),
        adBlock: {
          enabled: adBlocker.enabled,
          sessionBlocked: adBlocker.sessionBlocked,
          totalBlocked: store.getAll().stats.totalAdsBlocked,
          recentBlocked: adBlocker.recentBlocked
        },
        vpn: vpn ? vpn.getState() : null
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('flyout:opened', panel);
      }
    }
  };

  if (overlayView.webContents.isLoading()) {
    overlayView.webContents.once('did-finish-load', sendPayload);
  } else {
    sendPayload();
  }
}

function navigateTab(rawInput) {
  closeSuggestionsView({ restoreFocus: false });
  closeSiteInfoView({ restoreFocus: false });
  closeAutofillView({ restoreFocus: false });
  const targetId = getTargetTabId();
  const tab = tabs.get(targetId);
  if (!tab) return;
  if (tab.isSleeping || !tab.view) createViewForTab(tab);

  const resolved = resolveUrl(rawInput);
  tab.url = resolved;
  tab.lastActiveAt = Date.now();
  const wantPrivileged = resolved === PASSWORDS_URL;
  if (Boolean(tab.viewIsPrivileged) !== wantPrivileged) {
    recreateTabView(tab);
    focusActiveTabView();
    return;
  }
  if (resolved === NEWTAB_URL) {
    loadNewTab(tab.view.webContents);
  } else if (resolved === PASSWORDS_URL) {
    tab.title = 'Poly Şifre Yöneticisi';
    loadPasswordsPage(tab.view.webContents);
  } else if (
    safeBrowsing &&
    store &&
    store.getSettings().safeBrowsingEnabled !== false
  ) {
    const verdict = safeBrowsing.checkUrl(resolved);
    if (verdict.blocked) {
      showTabWarning(tab, {
        type: 'danger',
        url: resolved,
        host: verdict.host,
        reason: verdict.reason
      });
      focusActiveTabView();
      return;
    }
    tab.view.webContents.loadURL(resolved);
  } else {
    tab.view.webContents.loadURL(resolved);
  }
  broadcastTabs();
  focusActiveTabView();
}

let suggestionsIdleTimer = null;
let autofillIdleTimer = null;

function closeSuggestionsView({ restoreFocus = true } = {}) {
  suggestionsSeq += 1;
  isSuggestionsOpen = false;
  if (suggestionsView && !suggestionsView.isDestroyed()) {
    try {
      suggestionsView.hide();
    } catch (_) {}
    if (suggestionsIdleTimer) clearTimeout(suggestionsIdleTimer);
    suggestionsIdleTimer = setTimeout(() => {
      suggestionsIdleTimer = null;
      if (!isSuggestionsOpen && suggestionsView && !suggestionsView.isDestroyed()) {
        try { suggestionsView.destroy(); } catch (_) {}
        suggestionsView = null;
      }
    }, 12000);
  }
  if (restoreFocus) focusActiveTabView();
}

function closeSiteInfoView({ restoreFocus = true } = {}) {
  siteInfoSeq += 1;
  isSiteInfoOpen = false;
  if (siteInfoView && mainWindow && !mainWindow.isDestroyed()) {
    try {
      siteInfoView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      mainWindow.contentView.removeChildView(siteInfoView);
    } catch (_) {}
  }
  if (restoreFocus) focusActiveTabView();
}

let isVerifyingWindowsAuth = false;

function verifyWindowsUser(reason = 'Poly Tarayıcı: Şifreyi doldurmak için kimliğinizi doğrulayın') {
  if (process.platform !== 'win32') return Promise.resolve(true);
  if (isVerifyingWindowsAuth) return Promise.resolve(false);
  isVerifyingWindowsAuth = true;

  const safeMsg = String(reason || '').replace(/['"\r\n]/g, ' ').slice(0, 140);
  const ps = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
$avail = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($avail -eq [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) {
  $res = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${safeMsg}')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  if ($res -eq [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) {
    Write-Output 'VERIFIED'
  } else {
    Write-Output ('DENIED:' + $res)
  }
} else {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PolyCredUI {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDUI_INFO {
    public int cbSize;
    public IntPtr hwndParent;
    public string pszMessageText;
    public string pszCaptionText;
    public IntPtr hbmBanner;
  }
  [DllImport("credui.dll", CharSet = CharSet.Unicode)]
  public static extern int CredUIPromptForWindowsCredentials(
    ref CREDUI_INFO pUiInfo, int dwAuthError, ref uint pulAuthPackage,
    IntPtr pvInAuthBuffer, uint ulInAuthBufferSize,
    out IntPtr ppvOutAuthBuffer, out uint pulOutAuthBufferSize,
    ref bool pfSave, int dwFlags);
  [DllImport("ole32.dll")]
  public static extern void CoTaskMemFree(IntPtr pv);
  public static int Prompt(string msg) {
    var info = new CREDUI_INFO();
    info.cbSize = Marshal.SizeOf(info);
    info.pszCaptionText = "Windows Güvenliği";
    info.pszMessageText = msg;
    uint pkg = 0;
    IntPtr outBuf = IntPtr.Zero;
    uint outSize = 0;
    bool save = false;
    int rc = CredUIPromptForWindowsCredentials(ref info, 0, ref pkg, IntPtr.Zero, 0, out outBuf, out outSize, ref save, 1);
    if (outBuf != IntPtr.Zero) CoTaskMemFree(outBuf);
    return rc;
  }
}
"@
  $rc = [PolyCredUI]::Prompt('${safeMsg}')
  if ($rc -eq 0) { Write-Output 'VERIFIED' } else { Write-Output ('DENIED:' + $rc) }
}
`;
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { timeout: 90000, windowsHide: true },
      (err, stdout) => {
        isVerifyingWindowsAuth = false;
        if (err) {
          resolve(false);
          return;
        }
        resolve(String(stdout || '').includes('VERIFIED'));
      }
    );
  });
}

function closeAutofillView({ restoreFocus = false } = {}) {
  autofillSeq += 1;
  isAutofillOpen = false;
  autofillTabId = null;
  if (autofillView && !autofillView.isDestroyed()) {
    try {
      autofillView.hide();
    } catch (_) {}
    if (autofillIdleTimer) clearTimeout(autofillIdleTimer);
    autofillIdleTimer = setTimeout(() => {
      autofillIdleTimer = null;
      if (!isAutofillOpen && autofillView && !autofillView.isDestroyed()) {
        try { autofillView.destroy(); } catch (_) {}
        autofillView = null;
      }
    }, 12000);
  }
  if (restoreFocus) focusActiveTabView();
}

function ensureAutofillView() {
  if (autofillIdleTimer) {
    clearTimeout(autofillIdleTimer);
    autofillIdleTimer = null;
  }
  const isLight = store && store.getSettings().theme === 'light';
  const bg = isLight ? '#ffffff' : '#1b1e29';
  if (!autofillView || autofillView.isDestroyed()) {
    autofillView = new BrowserWindow({
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      width: 320,
      height: 150,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: bg,
      roundedCorners: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    autofillView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'autofill.html'));
  } else {
    try { autofillView.setBackgroundColor(bg); } catch (_) {}
  }
  return autofillView;
}

function ensureSiteInfoView() {
  if (!siteInfoView) {
    siteInfoView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    siteInfoView.setBackgroundColor('#00000000');
    if (typeof siteInfoView.setBorderRadius === 'function') {
      siteInfoView.setBorderRadius(14);
    }
    siteInfoView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'siteinfo.html'));
  }
  return siteInfoView;
}

function getCertInfo(hostname) {
  return new Promise((resolve) => {
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
      return resolve(null);
    }
    const socket = tls.connect(443, hostname, { servername: hostname, rejectUnauthorized: false, timeout: 3500 }, () => {
      try {
        const cert = socket.getPeerCertificate(true);
        socket.destroy();
        if (!cert || !cert.subject) {
          return resolve(null);
        }
        resolve({
          subject: cert.subject ? (cert.subject.CN || cert.subject.O || hostname) : hostname,
          issuer: cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Bilinmiyor') : 'Bilinmiyor',
          validFrom: cert.valid_from ? new Date(cert.valid_from).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
          validTo: cert.valid_to ? new Date(cert.valid_to).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
          fingerprint256: cert.fingerprint256 || cert.fingerprint || '',
          serialNumber: cert.serialNumber || '',
          dnsNames: (cert.subjectaltname || '').replace(/DNS:/g, '').split(', ').filter(Boolean)
        });
      } catch (_) {
        socket.destroy();
        resolve(null);
      }
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

function ensureSuggestionsView() {
  if (suggestionsIdleTimer) {
    clearTimeout(suggestionsIdleTimer);
    suggestionsIdleTimer = null;
  }
  const isLight = store && store.getSettings().theme === 'light';
  const bg = isLight ? '#ffffff' : '#181b26';
  if (!suggestionsView || suggestionsView.isDestroyed()) {
    suggestionsView = new BrowserWindow({
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      width: 600,
      height: 220,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: bg,
      roundedCorners: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    suggestionsView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'suggestions.html'));
  } else {
    try { suggestionsView.setBackgroundColor(bg); } catch (_) {}
  }
  return suggestionsView;
}

async function fetchSuggestionsData(rawQuery) {
  const q = (rawQuery || '').trim();
  const history = store ? (store.getAll().history || []) : [];
  const bookmarks = store ? (store.getAll().bookmarks || []) : [];
  const theme = store ? (store.getSettings().theme || 'dark') : 'dark';

  if (!q) {
    const uniqueRecent = [];
    const seenUrls = new Set();
    for (const h of history) {
      if (!h.url || seenUrls.has(h.url)) continue;
      seenUrls.add(h.url);
      let host = '';
      try { host = new URL(h.url).hostname; } catch (_) {}
      uniqueRecent.push({
        type: 'history',
        title: h.title || host || h.url,
        sub: host || 'Geçmiş',
        url: h.url,
        query: null,
        favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : null
      });
      if (uniqueRecent.length >= 8) break;
    }
    if (uniqueRecent.length < 6) {
      for (const b of bookmarks) {
        if (!b.url || seenUrls.has(b.url)) continue;
        seenUrls.add(b.url);
        let host = '';
        try { host = new URL(b.url).hostname; } catch (_) {}
        uniqueRecent.push({
          type: 'bookmark',
          title: b.title || host || b.url,
          sub: host || 'Yer İşareti',
          url: b.url,
          query: null,
          favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : null
        });
        if (uniqueRecent.length >= 8) break;
      }
    }
    return { query: '', suggestions: uniqueRecent, theme };
  }

  const qLower = q.toLowerCase();
  const matchedLocal = [];
  const seenUrls = new Set();

  for (const b of bookmarks) {
    if (!b.url || seenUrls.has(b.url)) continue;
    const titleMatch = (b.title || '').toLowerCase().includes(qLower);
    const urlMatch = b.url.toLowerCase().includes(qLower);
    if (titleMatch || urlMatch) {
      seenUrls.add(b.url);
      let host = '';
      try { host = new URL(b.url).hostname; } catch (_) {}
      matchedLocal.push({
        type: 'bookmark',
        title: b.title || host || b.url,
        sub: host || 'Yer İşareti',
        url: b.url,
        query: null,
        favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : null
      });
      if (matchedLocal.length >= 2) break;
    }
  }

  for (const h of history) {
    if (!h.url || seenUrls.has(h.url)) continue;
    const titleMatch = (h.title || '').toLowerCase().includes(qLower);
    const urlMatch = h.url.toLowerCase().includes(qLower);
    if (titleMatch || urlMatch) {
      seenUrls.add(h.url);
      let host = '';
      try { host = new URL(h.url).hostname; } catch (_) {}
      matchedLocal.push({
        type: 'history',
        title: h.title || host || h.url,
        sub: host || 'Geçmiş',
        url: h.url,
        query: null,
        favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : null
      });
      if (matchedLocal.length >= 4) break;
    }
  }

  let googleSuggests = [];
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(2500)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        const seenQueries = new Set([qLower]);
        for (const text of data[1]) {
          const tLower = (text || '').trim().toLowerCase();
          if (!tLower || seenQueries.has(tLower)) continue;
          seenQueries.add(tLower);
          googleSuggests.push({
            type: 'search',
            title: text,
            sub: 'Google Arama',
            url: null,
            query: text,
            favicon: null
          });
          if (googleSuggests.length >= 5) break;
        }
      }
    }
  } catch (_) {}

  const combined = [...matchedLocal, ...googleSuggests];
  if (combined.length === 0) {
    combined.push({
      type: 'search',
      title: q,
      sub: 'Google Arama',
      url: null,
      query: q,
      favicon: null
    });
  }

  let inlineCompletion = '';
  if (q.length >= 2 && !q.includes(' ') && !/^https?:\/\//i.test(q)) {
    const findHostMatch = (list) => {
      for (const item of list) {
        if (!item || !item.url) continue;
        try {
          const u = new URL(item.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          const cleanHost = u.hostname.toLowerCase().replace(/^www\./, '');
          if (cleanHost.startsWith(qLower) && cleanHost.length > qLower.length) {
            return cleanHost;
          }
        } catch (_) {}
      }
      return '';
    };
    inlineCompletion = findHostMatch(bookmarks) || findHostMatch(history) || findHostMatch(matchedLocal);
  }

  return {
    query: q,
    inlineCompletion,
    suggestions: combined,
    theme
  };
}

function createWindow() {
  const theme = store.getSettings().theme || 'dark';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: theme === 'light' ? '#f0f3f8' : '#0b0c10',
    title: 'Poly',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:state', { isMaximized: true });
    positionOverlay();
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:state', { isMaximized: false });
    positionOverlay();
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('resize', () => {
    positionOverlay();
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('move', () => {
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('minimize', () => {
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('blur', () => {
    closeSuggestionsView({ restoreFocus: false });
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
  });
  mainWindow.on('close', () => {
    if (store) store.saveNow();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => handleBrowserShortcut(event, input, null));

  mainWindow.webContents.once('did-finish-load', () => {
    createTab(NEWTAB_URL, true);
    startMetricsAndHibernationLoop();
  });
}

function openPasswordsTab() {
  const targetId = getTargetTabId();
  const cur = targetId ? tabs.get(targetId) : null;
  if (cur && cur.url === NEWTAB_URL) {
    navigateTab(PASSWORDS_URL);
  } else {
    createTab(PASSWORDS_URL, true);
  }
}

function registerIpc() {
  ipcMain.on('flyout:toggle', (_e, panel) => {
    if (panel === 'autofill') {
      closeOverlay();
      openPasswordsTab();
      return;
    }
    showOverlay(panel);
  });
  ipcMain.on('flyout:close', () => {
    closeOverlay();
  });

  // Suggestions dropdown (non-focusable floating child window so omnibox typing never blurs)
  ipcMain.on('suggestions:open', async (_e, { rect, query }) => {
    if (!mainWindow || mainWindow.isDestroyed() || !rect) return;
    closeSiteInfoView({ restoreFocus: false });
    closeAutofillView({ restoreFocus: false });
    const seq = ++suggestionsSeq;
    isSuggestionsOpen = true;
    suggestionsRect = rect;
    const view = ensureSuggestionsView();

    const data = await fetchSuggestionsData(query);
    if (!isSuggestionsOpen || seq !== suggestionsSeq || view.isDestroyed() || view.webContents.isDestroyed()) return;
    if (mainWindow && !mainWindow.isDestroyed() && data.inlineCompletion) {
      mainWindow.webContents.send('omnibox:inline-complete', {
        query: data.query,
        completion: data.inlineCompletion
      });
    }
    if (!data.suggestions || data.suggestions.length === 0) {
      closeSuggestionsView({ restoreFocus: false });
      return;
    }

    const cb = mainWindow.getContentBounds();
    const estHeight = Math.min(380, Math.max(56, data.suggestions.length * 44 + 12));
    view.setBounds({
      x: Math.round(cb.x + suggestionsRect.x),
      y: Math.round(cb.y + suggestionsRect.y + suggestionsRect.height + 4),
      width: Math.max(240, Math.round(suggestionsRect.width)),
      height: estHeight
    });
    if (!view.isVisible()) {
      view.showInactive();
    }

    const sendData = () => {
      if (!isSuggestionsOpen || seq !== suggestionsSeq || view.isDestroyed() || view.webContents.isDestroyed()) return;
      view.webContents.send('suggestions:data', data);
    };
    if (view.webContents.isLoading()) {
      view.webContents.once('did-finish-load', sendData);
    } else {
      sendData();
    }
  });

  ipcMain.on('suggestions:query', async (_e, query) => {
    if (!mainWindow || mainWindow.isDestroyed() || !suggestionsRect) return;
    if (!isSuggestionsOpen) isSuggestionsOpen = true;
    const view = ensureSuggestionsView();
    const seq = ++suggestionsSeq;
    const data = await fetchSuggestionsData(query);
    if (!isSuggestionsOpen || seq !== suggestionsSeq || view.isDestroyed() || view.webContents.isDestroyed()) return;
    if (mainWindow && !mainWindow.isDestroyed() && data.inlineCompletion) {
      mainWindow.webContents.send('omnibox:inline-complete', {
        query: data.query,
        completion: data.inlineCompletion
      });
    }
    if (!data.suggestions || data.suggestions.length === 0) {
      closeSuggestionsView({ restoreFocus: false });
      return;
    }
    const cb = mainWindow.getContentBounds();
    const estHeight = Math.min(380, Math.max(56, data.suggestions.length * 44 + 12));
    view.setBounds({
      x: Math.round(cb.x + suggestionsRect.x),
      y: Math.round(cb.y + suggestionsRect.y + suggestionsRect.height + 4),
      width: Math.max(240, Math.round(suggestionsRect.width)),
      height: estHeight
    });
    if (!view.isVisible()) {
      view.showInactive();
    }
    if (view.webContents.isLoading()) {
      view.webContents.once('did-finish-load', () => {
        if (!isSuggestionsOpen || seq !== suggestionsSeq || view.isDestroyed() || view.webContents.isDestroyed()) return;
        view.webContents.send('suggestions:data', data);
      });
    } else {
      view.webContents.send('suggestions:data', data);
    }
  });

  ipcMain.on('suggestions:resize', (_e, height) => {
    if (!isSuggestionsOpen || !suggestionsView || suggestionsView.isDestroyed() || !suggestionsRect || !mainWindow || mainWindow.isDestroyed()) return;
    if (height <= 0) {
      closeSuggestionsView({ restoreFocus: false });
      return;
    }
    const cb = mainWindow.getContentBounds();
    suggestionsView.setBounds({
      x: Math.round(cb.x + suggestionsRect.x),
      y: Math.round(cb.y + suggestionsRect.y + suggestionsRect.height + 4),
      width: Math.max(240, Math.round(suggestionsRect.width)),
      height: Math.min(420, Math.round(height))
    });
    if (!suggestionsView.isVisible()) {
      suggestionsView.showInactive();
    }
  });

  ipcMain.on('suggestions:select', (_e, item) => {
    closeSuggestionsView();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omnibox:blur');
    }
    if (!item) return;
    const target = item.url || item.query;
    if (target) {
      navigateTab(target);
    }
  });

  ipcMain.on('suggestions:close', () => {
    closeSuggestionsView();
  });

  ipcMain.on('siteinfo:open', async (_e, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    closeSuggestionsView({ restoreFocus: false });
    if (isSiteInfoOpen) {
      closeSiteInfoView();
      return;
    }
    closeSiteInfoView({ restoreFocus: false });

    const rect = payload?.rect;
    if (!rect) return;
    const seq = ++siteInfoSeq;
    isSiteInfoOpen = true;
    siteInfoRect = rect;

    const targetId = getTargetTabId();
    const tab = tabs.get(targetId);
    if (!tab) {
      isSiteInfoOpen = false;
      return;
    }

    const view = ensureSiteInfoView();
    try {
      mainWindow.contentView.removeChildView(view);
    } catch (_) {}
    mainWindow.contentView.addChildView(view);

    const winBounds = mainWindow.getContentBounds();
    const width = 360;
    const initialHeight = 320;
    let x = rect.x;
    if (x + width > winBounds.width - 10) {
      x = winBounds.width - width - 10;
    }
    if (x < 10) x = 10;

    view.setBounds({
      x,
      y: rect.y + rect.height + 4,
      width,
      height: initialHeight
    });

    let hostname = '';
    let isHttps = false;
    let isInternal = false;
    const url = tab.url || '';

    if (url === NEWTAB_URL || url.startsWith('poly://') || url.startsWith('file://')) {
      isInternal = true;
      hostname = 'poly';
      isHttps = true;
    } else {
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
        isHttps = parsed.protocol === 'https:';
      } catch (_) {
        hostname = url;
      }
    }

    let cookiesCount = 0;
    if (!isInternal && hostname) {
      try {
        const cookies = await session.defaultSession.cookies.get({ domain: hostname });
        cookiesCount = cookies.length;
      } catch (_) {}
    }

    let certInfo = null;
    if (isHttps && !isInternal && hostname) {
      certInfo = await getCertInfo(hostname);
    }

    if (!isSiteInfoOpen || seq !== siteInfoSeq || view.webContents.isDestroyed()) return;

    const theme = store ? (store.getSettings().theme || 'dark') : 'dark';
    const sendSiteInfo = () => {
      if (!isSiteInfoOpen || seq !== siteInfoSeq || view.webContents.isDestroyed()) return;
      view.webContents.send('siteinfo:data', {
        hostname,
        url,
        isHttps,
        isInternal,
        cert: certInfo,
        cookiesCount,
        theme
      });
    };
    if (view.webContents.isLoading()) {
      view.webContents.once('did-finish-load', sendSiteInfo);
    } else {
      sendSiteInfo();
    }
  });

  ipcMain.on('siteinfo:resize', (_e, height) => {
    if (!isSiteInfoOpen || !siteInfoView || !siteInfoRect || !mainWindow || mainWindow.isDestroyed()) return;
    if (height <= 0) {
      closeSiteInfoView();
      return;
    }
    const winBounds = mainWindow.getContentBounds();
    const width = 360;
    let x = siteInfoRect.x;
    if (x + width > winBounds.width - 10) {
      x = winBounds.width - width - 10;
    }
    if (x < 10) x = 10;

    siteInfoView.setBounds({
      x,
      y: siteInfoRect.y + siteInfoRect.height + 4,
      width,
      height: Math.min(520, height)
    });
  });

  ipcMain.on('siteinfo:close', () => {
    closeSiteInfoView();
  });

  ipcMain.handle('siteinfo:clear-cookies', async (_e, domain) => {
    if (!domain) return false;
    try {
      const cookies = await session.defaultSession.cookies.get({});
      for (const c of cookies) {
        if (c.domain.includes(domain) || domain.includes(c.domain.replace(/^\./, ''))) {
          const scheme = c.secure ? 'https://' : 'http://';
          const url = `${scheme}${c.domain.replace(/^\./, '')}${c.path}`;
          await session.defaultSession.cookies.remove(url, c.name).catch(() => {});
        }
      }
      await session.defaultSession.clearStorageData({
        origin: `https://${domain}`,
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      }).catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Layout
  ipcMain.on('layout:set-viewport', (_e, rect) => {
    if (rect && typeof rect.width === 'number' && typeof rect.height === 'number') {
      viewportRect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height))
      };
      layoutViews();
    }
  });

  // Tabs
  ipcMain.handle('tabs:create', (_e, url) => createTab(url || NEWTAB_URL, true));
  ipcMain.handle('tabs:close', (_e, id) => closeTab(id));
  ipcMain.handle('tabs:activate', (_e, id) => activateTab(id));
  ipcMain.handle('tabs:hibernate', (_e, id) => {
    const ok = hibernateTab(id);
    if (ok) {
      collectMetrics();
      mainWindow?.webContents.send('metrics:updated', lastMetrics);
    }
    return ok;
  });
  ipcMain.handle('tabs:hibernate-all-inactive', async () => {
    const beforeRamMB = collectMetrics().totalRamMB;
    const hibernatedCount = hibernateAllInactive();
    try {
      await session.defaultSession.clearCodeCaches({});
    } catch (_) {}
    if (typeof global.gc === 'function') {
      try {
        global.gc();
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 250));
    const afterRamMB = collectMetrics().totalRamMB;
    mainWindow?.webContents.send('metrics:updated', lastMetrics);
    return {
      hibernatedCount,
      beforeRamMB,
      afterRamMB,
      freedMB: Math.max(0, beforeRamMB - afterRamMB)
    };
  });
  ipcMain.handle('tabs:toggle-mute', (_e, id) => {
    const tab = tabs.get(id);
    if (!tab || !tab.view) return false;
    tab.audioMuted = !tab.audioMuted;
    tab.view.webContents.setAudioMuted(tab.audioMuted);
    broadcastTabs();
    return tab.audioMuted;
  });

  ipcMain.on('tabs:context-menu', (_e, id) => {
    const tab = tabs.get(id);
    if (!tab || !mainWindow) return;
    const isVisible = id === activeTabId || id === splitTabId;
    const menu = Menu.buildFromTemplate([
      {
        label: 'Yeni Sekme Ekle',
        click: () => createTab(NEWTAB_URL, true)
      },
      {
        label: 'Sekmeyi Yenile',
        click: () => {
          if (tab.view) tab.view.webContents.reload();
        }
      },
      {
        label: 'Sekmeyi Çoğalt (Yinele)',
        click: () => {
          createTab(tab.url, true);
        }
      },
      { type: 'separator' },
      {
        label: splitTabId ? 'Bölünmüş Ekranı Kapat' : 'Bölünmüş Ekranda Aç (Yan Yana)',
        click: () => {
          if (splitTabId) {
            splitTabId = null;
            focusedPane = 'left';
          } else if (id !== activeTabId) {
            splitTabId = id;
            focusedPane = 'right';
          } else {
            const other = tabOrder.find((tId) => tId !== activeTabId);
            splitTabId = other || createTab(NEWTAB_URL, false);
            focusedPane = 'right';
          }
          layoutViews();
          broadcastTabs();
        }
      },
      {
        label: 'Sekmeyi Uyut (RAM Tasarrufu)',
        enabled: !tab.isSleeping && !isVisible,
        click: () => {
          if (hibernateTab(id)) {
            collectMetrics();
            mainWindow?.webContents.send('metrics:updated', lastMetrics);
          }
        }
      },
      {
        label: tab.audioMuted ? 'Sesi Aç' : 'Sesi Kapat',
        enabled: Boolean(tab.view),
        click: () => {
          if (!tab.view) return;
          tab.audioMuted = !tab.audioMuted;
          tab.view.webContents.setAudioMuted(tab.audioMuted);
          broadcastTabs();
        }
      },
      { type: 'separator' },
      {
        label: 'Sekmeyi Kapat',
        click: () => closeTab(id)
      },
      {
        label: 'Diğer Sekmeleri Kapat',
        enabled: tabOrder.length > 1,
        click: () => {
          const others = tabOrder.filter((tId) => tId !== id);
          for (const otherId of others) {
            closeTab(otherId);
          }
        }
      }
    ]);
    menu.popup({ window: mainWindow });
  });

  // Split view
  ipcMain.handle('split:toggle', (_e, targetTabId) => {
    if (splitTabId) {
      splitTabId = null;
      focusedPane = 'left';
    } else {
      if (targetTabId && targetTabId !== activeTabId && tabs.has(targetTabId)) {
        splitTabId = targetTabId;
      } else {
        const other = tabOrder.find((id) => id !== activeTabId);
        if (other) {
          splitTabId = other;
        } else {
          // Create a new tab for the right pane
          const newId = createTab(NEWTAB_URL, false);
          splitTabId = newId;
        }
      }
      focusedPane = 'right';
    }
    layoutViews();
    broadcastTabs();
    return { splitTabId, focusedPane };
  });

  ipcMain.on('split:focus-pane', (_e, pane) => {
    focusedPane = pane === 'right' ? 'right' : 'left';
    broadcastTabs();
  });

  // Navigation
  ipcMain.handle('nav:go', (_e, rawInput) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omnibox:blur');
    }
    navigateTab(rawInput);
  });

  ipcMain.on('nav:back', () => {
    closeSiteInfoView({ restoreFocus: false });
    const tab = tabs.get(getTargetTabId());
    if (tab?.view?.webContents.canGoBack()) tab.view.webContents.goBack();
  });

  ipcMain.on('nav:forward', () => {
    closeSiteInfoView({ restoreFocus: false });
    const tab = tabs.get(getTargetTabId());
    if (tab?.view?.webContents.canGoForward()) tab.view.webContents.goForward();
  });

  ipcMain.on('nav:reload', () => {
    closeSiteInfoView({ restoreFocus: false });
    const tab = tabs.get(getTargetTabId());
    if (tab?.view) tab.view.webContents.reload();
  });

  ipcMain.on('tab:zoom-wheel', (event, deltaY) => {
    const wc = event.sender;
    if (!wc || wc.isDestroyed()) return;
    adjustTabZoom(wc, deltaY < 0 ? 0.1 : -0.1);
  });

  ipcMain.on('nav:stop', () => {
    const tab = tabs.get(getTargetTabId());
    if (tab?.view) tab.view.webContents.stop();
  });

  ipcMain.on('nav:home', () => {
    closeSiteInfoView({ restoreFocus: false });
    const tab = tabs.get(getTargetTabId());
    if (!tab) return;
    if (tab.isSleeping || !tab.view) createViewForTab(tab);
    tab.url = NEWTAB_URL;
    tab.title = 'Yeni Sekme';
    loadNewTab(tab.view.webContents);
    broadcastTabs();
    focusActiveTabView();
  });

  // App state & features
  ipcMain.handle('app:get-state', () => ({
    ...store.getAll(),
    tabsState: serializeTabs(),
    metrics: lastMetrics,
    downloads,
    passwords: passwordStore ? passwordStore.list() : [],
    autofillProfile: store.getAutofillProfile(),
    adBlock: {
      enabled: adBlocker.enabled,
      sessionBlocked: adBlocker.sessionBlocked,
      totalBlocked: store.getAll().stats.totalAdsBlocked,
      recentBlocked: adBlocker.recentBlocked
    },
    vpn: vpn ? vpn.getState() : null,
    updater: updater ? updater.getState() : null
  }));

  ipcMain.handle('updater:get-state', () => (updater ? updater.getState() : null));
  ipcMain.handle('updater:check', () => (updater ? updater.checkForUpdates({ autoDownload: true }) : null));
  ipcMain.handle('updater:install', () => (updater ? updater.installUpdate({ relaunch: true }) : false));

  ipcMain.handle('bookmarks:toggle', (_e, item) => {
    const existing = store.getAll().bookmarks.find((b) => b.url === item.url);
    const updated = existing ? store.removeBookmark(item.url) : store.addBookmark(item);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bookmarks:updated', updated);
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('bookmarks:updated', updated);
    }
    return updated;
  });

  ipcMain.handle('bookmarks:remove', (_e, url) => {
    const updated = store.removeBookmark(url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bookmarks:updated', updated);
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('bookmarks:updated', updated);
    }
    return updated;
  });

  ipcMain.on('bookmarks:context-menu', (_e, bm) => {
    if (!bm || !mainWindow || mainWindow.isDestroyed()) return;
    const template = [
      {
        label: 'Yeni sekmede aç',
        click: () => createTab(bm.url, true)
      },
      {
        label: 'Adresi kopyala',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(bm.url);
        }
      },
      { type: 'separator' },
      {
        label: 'Yer işaretini sil',
        click: () => {
          const updated = store.removeBookmark(bm.url);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('bookmarks:updated', updated);
          }
          if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
            overlayView.webContents.send('bookmarks:updated', updated);
          }
        }
      }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });

  ipcMain.handle('history:clear', () => store.clearHistory());
  ipcMain.handle('history:clear-advanced', async (_e, options = {}) => {
    const { timeRange = 'all', clearHistory = true, clearCookies = false, clearCache = false } = options;
    let remainingHistory = [];
    if (clearHistory && store) {
      remainingHistory = store.clearHistoryRange(timeRange);
    } else if (store) {
      remainingHistory = store.getAll().history || [];
    }

    if (clearCookies) {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage']
      }).catch(() => {});
    }

    if (clearCache) {
      await session.defaultSession.clearCache().catch(() => {});
      await session.defaultSession.clearStorageData({
        storages: ['cachestorage', 'shadercache']
      }).catch(() => {});
    }

    return remainingHistory;
  });
  ipcMain.handle('settings:update', (_e, partial) => {
    const updated = store.updateSettings(partial);
    if (partial && partial.theme) {
      nativeTheme.themeSource = updated.theme;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theme:changed', updated.theme);
      }
      if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
        const bg = updated.theme === 'light' ? '#ffffff' : '#151824';
        overlayView.setBackgroundColor(bg);
        overlayView.webContents.send('theme:changed', updated.theme);
      }
      if (suggestionsView && !suggestionsView.isDestroyed() && !suggestionsView.webContents.isDestroyed()) {
        suggestionsView.webContents.send('theme:changed', updated.theme);
      }
      if (siteInfoView && !siteInfoView.webContents.isDestroyed()) {
        siteInfoView.webContents.send('theme:changed', updated.theme);
      }
      if (autofillView && !autofillView.isDestroyed() && !autofillView.webContents.isDestroyed()) {
        autofillView.webContents.send('theme:changed', updated.theme);
      }
    }
    if (partial && partial.accentColor) {
      const safeAccent = String(updated.accentColor || '#7c5cff');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('accent:changed', safeAccent);
      }
      if (overlayView && !overlayView.webContents.isDestroyed()) {
        overlayView.webContents.send('accent:changed', safeAccent);
      }
      if (suggestionsView && !suggestionsView.isDestroyed() && !suggestionsView.webContents.isDestroyed()) {
        suggestionsView.webContents.send('accent:changed', safeAccent);
      }
      if (siteInfoView && !siteInfoView.webContents.isDestroyed()) {
        siteInfoView.webContents.send('accent:changed', safeAccent);
      }
      if (autofillView && !autofillView.isDestroyed() && !autofillView.webContents.isDestroyed()) {
        autofillView.webContents.send('accent:changed', safeAccent);
      }
      for (const tab of tabs.values()) {
        if (tab.view && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents
            .executeJavaScript(`if (typeof window.applyAccentLive === 'function') window.applyAccentLive(${JSON.stringify(safeAccent)});`)
            .catch(() => {});
        }
      }
    }
    const affectsNewTab =
      partial &&
      ('theme' in partial ||
        'showClock' in partial ||
        'showSpeedDial' in partial ||
        'searchEngine' in partial);
    if (affectsNewTab) {
      const bg = updated.theme === 'light' ? '#f0f3f8' : '#0b0c10';
      mainWindow?.setBackgroundColor(bg);
      for (const tab of tabs.values()) {
        if (tab.view) {
          tab.view.setBackgroundColor(bg);
          // Apply live theme change to current tab webContents immediately
          tab.view.webContents
            .executeJavaScript(`
              (function() {
                if (typeof window.applyThemeLive === 'function') {
                  window.applyThemeLive('${updated.theme}');
                } else {
                  document.documentElement.classList.toggle('light', '${updated.theme}' === 'light');
                  document.documentElement.setAttribute('data-theme', '${updated.theme}');
                  if (document.body) {
                    document.body.classList.toggle('light', '${updated.theme}' === 'light');
                  }
                }
              })();
            `)
            .catch(() => {});
        }
      }
    }
    return updated;
  });

  ipcMain.handle('adblock:toggle', (_e, enabled) => {
    adBlocker.setEnabled(enabled);
    return {
      enabled: adBlocker.enabled,
      sessionBlocked: adBlocker.sessionBlocked,
      totalBlocked: store.getAll().stats.totalAdsBlocked,
      recentBlocked: adBlocker.recentBlocked
    };
  });

  ipcMain.on('adblock:is-enabled', (event) => {
    event.returnValue = Boolean(adBlocker && adBlocker.enabled);
  });

  ipcMain.on('adblock:yt-blocked', (event, hostLabel) => {
    try {
      const url = event.sender && !event.sender.isDestroyed() ? event.sender.getURL() : '';
      if (!/^https?:\/\/([^/]+\.)?youtube(-nocookie)?\.com\//i.test(url)) return;
      if (adBlocker) adBlocker.recordExternalBlock(event.sender.id, String(hostLabel || 'youtube-ads').slice(0, 60));
    } catch (_) {}
  });

  // Poly VPN
  ipcMain.handle('vpn:connect', async (_e, country, forceRefresh) => {
    if (!vpn) return null;
    return vpn.connect(country, forceRefresh);
  });
  ipcMain.handle('vpn:disconnect', async () => {
    if (!vpn) return null;
    return vpn.disconnect();
  });
  ipcMain.handle('vpn:get-state', () => (vpn ? vpn.getState() : null));

  ipcMain.on('downloads:open', (_e, filePath) => {
    if (filePath) shell.openPath(filePath);
  });

  ipcMain.on('downloads:show-in-folder', (_e, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
  });

  ipcMain.on('downloads:cancel', (_e, id) => {
    const item = activeDownloadItems.get(id);
    if (item) {
      try {
        item.cancel();
      } catch (_) {}
    }
  });

  ipcMain.handle('downloads:clear', () => {
    downloads = downloads.filter((d) => d.state === 'progressing');
    return downloads;
  });

  // Passwords, Autofill & Browser Data Import
  const isTrustedInternal = (event) => {
    const sender = event && event.sender;
    if (!sender) return false;
    if (mainWindow && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id) return true;
    if (overlayView && !overlayView.webContents.isDestroyed() && sender.id === overlayView.webContents.id) return true;
    if (autofillView && !autofillView.isDestroyed() && !autofillView.webContents.isDestroyed() && sender.id === autofillView.webContents.id) return true;
    for (const tab of tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === sender.id && tab.viewIsPrivileged) {
        const u = (sender.getURL() || '').toLowerCase();
        return u.startsWith('file://') && u.includes('passwords.html');
      }
    }
    return false;
  };

  ipcMain.handle('passwords:page-initial', (e) => {
    if (!isTrustedInternal(e)) return null;
    return {
      passwords: passwordStore ? passwordStore.list() : [],
      profile: store.getAutofillProfile(),
      settings: store.getSettings(),
      checkup: passwordStore ? passwordStore.getSecurityCheckup() : { total: 0, weak: [], reused: [] }
    };
  });
  ipcMain.handle('passwords:list', (e) => (isTrustedInternal(e) && passwordStore ? passwordStore.list() : []));
  ipcMain.handle('passwords:reveal', (e, id) => (isTrustedInternal(e) && passwordStore ? passwordStore.reveal(id) : ''));
  ipcMain.handle('passwords:save', (e, entry) => (isTrustedInternal(e) && passwordStore ? passwordStore.addOrUpdate(entry) : []));
  ipcMain.handle('passwords:delete', (e, id) => (isTrustedInternal(e) && passwordStore ? passwordStore.remove(id) : []));
  ipcMain.handle('passwords:clear-all', (e) => (isTrustedInternal(e) && passwordStore ? passwordStore.clearAll() : []));
  ipcMain.handle('passwords:checkup', (e) => (isTrustedInternal(e) && passwordStore ? passwordStore.getSecurityCheckup() : { total: 0, weak: [], reused: [] }));

  ipcMain.handle('autofill:get-profile', (e) => (isTrustedInternal(e) ? store.getAutofillProfile() : {}));
  ipcMain.handle('autofill:save-profile', (e, profile) => (isTrustedInternal(e) ? store.updateAutofillProfile(profile) : {}));
  ipcMain.handle('autofill:fill-active', async (_e, credId) => {
    const targetId = getTargetTabId();
    const tab = tabs.get(targetId);
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
      return { ok: false, filledFields: 0 };
    }
    const wc = tab.view.webContents;
    const curUrl = wc.getURL();
    let credential = null;
    if (credId && passwordStore) {
      const rawItem = passwordStore.items.find((i) => i.id === credId);
      if (rawItem) {
        credential = { username: rawItem.username, password: passwordStore.reveal(rawItem.id) };
      }
    } else if (passwordStore && curUrl) {
      const matches = passwordStore.getForUrl(curUrl);
      if (matches.length > 0) credential = matches[0];
    }
    return fillTabInputs(wc, { credential, profile: store.getAutofillProfile() });
  });

  // Inline Chrome-style Autofill Dropdown for Web Page Inputs
  ipcMain.on('page-autofill:focus', (event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || !payload || !payload.rect) return;
    if (store && store.getSettings().autofillEnabled === false) {
      closeAutofillView({ restoreFocus: false });
      return;
    }
    if (currentOverlayPanel || isSuggestionsOpen || isSiteInfoOpen) return;

    // Verify sender belongs to a currently visible tab view
    let matchedTab = null;
    for (const tab of tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === event.sender.id) {
        if (tab.id === activeTabId || tab.id === splitTabId) matchedTab = tab;
        break;
      }
    }
    if (!matchedTab || !matchedTab.view) return;

    const curUrl = matchedTab.view.webContents.getURL() || '';
    if (!curUrl.startsWith('http://') && !curUrl.startsWith('https://')) return;

    const fieldKind = String(payload.fieldKind || '');
    const items = [];
    const seenCred = new Set();

    const wantCreds =
      fieldKind === 'password' ||
      fieldKind === 'username' ||
      fieldKind === 'email' ||
      Boolean(payload.hasPasswordInForm);

    if (wantCreds && passwordStore) {
      const creds = passwordStore.getForUrl(curUrl);
      for (const c of creds) {
        const key = `${c.username || ''}`;
        if (seenCred.has(key)) continue;
        seenCred.add(key);
        items.push({
          kind: 'credential',
          credId: c.id,
          primary: c.username || '(Kullanıcı adı yok)',
          secondary: 'Poly Şifre Yöneticisi • ••••••••'
        });
      }
    }

    const prof = store ? store.getAutofillProfile() : {};
    const profileMap = {
      email: { val: prof.email, label: 'E-posta' },
      tel: { val: prof.phone, label: 'Telefon' },
      name: { val: prof.fullName, label: 'Ad Soyad' },
      address: { val: prof.address, label: 'Adres' },
      city: { val: prof.city, label: 'Şehir' },
      zip: { val: prof.zip, label: 'Posta Kodu' }
    };
    const pEntry = profileMap[fieldKind];
    if (pEntry && pEntry.val && !seenCred.has(pEntry.val)) {
      items.push({
        kind: 'profile',
        fieldKind,
        value: pEntry.val,
        primary: pEntry.val,
        secondary: `Kişisel Bilgi • ${pEntry.label}`
      });
    }

    if (items.length === 0) {
      closeAutofillView({ restoreFocus: false });
      return;
    }

    const seq = ++autofillSeq;
    isAutofillOpen = true;
    autofillTabId = matchedTab.id;

    const viewBounds = matchedTab.view.getBounds();
    const cb = mainWindow.getContentBounds();
    const popupW = Math.max(290, Math.min(360, Number(payload.rect.width) || 320));
    let localX = viewBounds.x + Number(payload.rect.x || 0);
    let localY = viewBounds.y + Number(payload.rect.y || 0) + Number(payload.rect.height || 36) + 4;
    if (localX + popupW > cb.width - 8) localX = Math.max(8, cb.width - popupW - 8);
    if (localX < 8) localX = 8;
    if (localY + 260 > cb.height - 8) {
      const aboveY = viewBounds.y + Number(payload.rect.y || 0) - 180;
      if (aboveY > viewportRect.y) localY = aboveY;
    }
    autofillRect = {
      x: Math.round(cb.x + localX),
      y: Math.round(cb.y + localY),
      width: Math.round(popupW)
    };

    const view = ensureAutofillView();
    const estHeight = Math.min(310, Math.max(98, items.length * 48 + 48));
    view.setBounds({
      x: autofillRect.x,
      y: autofillRect.y,
      width: autofillRect.width,
      height: estHeight
    });
    if (!view.isVisible()) {
      view.showInactive();
    }
    const s = store ? store.getSettings() : {};
    const dataPayload = {
      items,
      theme: s.theme || 'dark',
      accentColor: s.accentColor || '#7c5cff'
    };
    const sendAf = () => {
      if (!isAutofillOpen || seq !== autofillSeq || view.isDestroyed() || view.webContents.isDestroyed()) return;
      view.webContents.send('autofill-popup:data', dataPayload);
    };
    if (view.webContents.isLoading()) {
      view.webContents.once('did-finish-load', sendAf);
    } else {
      sendAf();
    }
  });

  ipcMain.on('page-autofill:blur', (event) => {
    const targetTab = autofillTabId ? tabs.get(autofillTabId) : null;
    if (targetTab && targetTab.view && !targetTab.view.webContents.isDestroyed()) {
      if (event.sender.id !== targetTab.view.webContents.id) return;
    }
    closeAutofillView({ restoreFocus: false });
  });

  ipcMain.on('autofill-popup:resize', (event, height) => {
    if (!isTrustedInternal(event) || !isAutofillOpen || !autofillView || autofillView.isDestroyed() || !autofillRect) return;
    if (height <= 0) {
      closeAutofillView({ restoreFocus: false });
      return;
    }
    autofillView.setBounds({
      x: autofillRect.x,
      y: autofillRect.y,
      width: autofillRect.width,
      height: Math.min(310, Math.round(height))
    });
    if (!autofillView.isVisible()) {
      autofillView.showInactive();
    }
  });

  ipcMain.on('autofill-popup:pick', async (event, item) => {
    if (!isTrustedInternal(event) || !item) return;
    const targetId = autofillTabId || getTargetTabId();
    const tab = tabs.get(targetId);
    closeAutofillView({ restoreFocus: false });
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
    const wc = tab.view.webContents;

    if (item.kind === 'credential' && item.credId && passwordStore) {
      const rawItem = passwordStore.items.find((i) => i.id === item.credId);
      if (rawItem) {
        const verified = await verifyWindowsUser(
          `Poly Tarayıcı: "${rawItem.username || rawItem.origin}" şifresini doldurmak için doğrulayın`
        );
        if (!verified) {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
            wc.focus();
          } catch (_) {}
          return;
        }
        const cred = { username: rawItem.username, password: passwordStore.reveal(rawItem.id) };
        await fillTabInputs(wc, { credential: cred, profile: null, useActiveElement: true });
      }
    } else if (item.kind === 'profile' && item.value) {
      await fillTabInputs(wc, { singleValue: item.value, useActiveElement: true });
    }
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
      wc.focus();
    } catch (_) {}
  });

  ipcMain.on('autofill-popup:manage', (event) => {
    if (!isTrustedInternal(event)) return;
    closeAutofillView({ restoreFocus: false });
    openPasswordsTab();
  });

  ipcMain.on('autofill-popup:close', (event) => {
    if (!isTrustedInternal(event)) return;
    closeAutofillView({ restoreFocus: true });
  });

  const isNewTabSender = (event) => {
    try {
      const url = event.sender && !event.sender.isDestroyed() ? event.sender.getURL() : '';
      return url.startsWith('file://') && url.toLowerCase().includes('newtab.html');
    } catch (_) {
      return false;
    }
  };

  const broadcastSpeedDial = (items) => {
    for (const tab of tabs.values()) {
      if (tab.url === NEWTAB_URL && tab.view && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.send('newtab:speed-dial-updated', items);
        } catch (_) {}
      }
    }
  };

  ipcMain.handle('newtab:get-speed-dial', (event) => {
    if (!isNewTabSender(event)) return [];
    return store.getSpeedDial();
  });

  ipcMain.handle('newtab:save-speed-dial', (event, items) => {
    if (!isNewTabSender(event)) return [];
    const updated = store.setSpeedDial(items);
    broadcastSpeedDial(updated);
    return updated;
  });

  ipcMain.handle('newtab:reset-speed-dial', (event) => {
    if (!isNewTabSender(event)) return [];
    const updated = store.resetSpeedDial();
    broadcastSpeedDial(updated);
    return updated;
  });

  const emitBookmarksUpdated = () => {
    const updated = store.getAll().bookmarks;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bookmarks:updated', updated);
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('bookmarks:updated', updated);
    }
  };

  ipcMain.handle('import:detect-browsers', () => (importer ? importer.detectBrowsers() : []));
  ipcMain.handle('import:run-browser', async (_e, browserId, options) => {
    if (!importer) return { ok: false, error: 'İçe aktarıcı hazır değil.' };
    const res = await importer.importFromBrowser(browserId, options, { store, passwordStore });
    if (res && res.bookmarksAdded > 0) emitBookmarksUpdated();
    return res;
  });
  ipcMain.handle('import:pick-csv', async () => {
    if (!importer || !passwordStore) return { ok: false, error: 'Hazır değil.' };
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Şifre CSV Dosyası Seç',
      filters: [{ name: 'CSV Dosyaları', extensions: ['csv'] }],
      properties: ['openFile']
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { canceled: true };
    return importer.importPasswordsCsv(pick.filePaths[0], passwordStore);
  });
  ipcMain.handle('import:pick-html', async () => {
    if (!importer) return { ok: false, error: 'Hazır değil.' };
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Yer İmleri HTML Dosyası Seç',
      filters: [{ name: 'HTML Dosyaları', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    });
    if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { canceled: true };
    const res = importer.importBookmarksHtml(pick.filePaths[0], store);
    if (res && res.added > 0) emitBookmarksUpdated();
    return res;
  });
  ipcMain.handle('import:export-passwords-csv', async (e) => {
    if (!isTrustedInternal(e) || !importer || !passwordStore) return { ok: false };
    const save = await dialog.showSaveDialog(mainWindow, {
      title: 'Poly Şifrelerini Dışa Aktar',
      defaultPath: 'Poly_Sifreler.csv',
      filters: [{ name: 'CSV Dosyaları', extensions: ['csv'] }]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    return importer.exportPasswordsCsv(save.filePath, passwordStore);
  });
  ipcMain.handle('import:export-bookmarks-html', async (e) => {
    if (!isTrustedInternal(e) || !importer) return { ok: false };
    const save = await dialog.showSaveDialog(mainWindow, {
      title: 'Poly Yer İmlerini Dışa Aktar',
      defaultPath: 'Poly_Yer_Imleri.html',
      filters: [{ name: 'HTML Dosyaları', extensions: ['html'] }]
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    return importer.exportBookmarksHtml(save.filePath, store);
  });
}

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (safeBrowsing && safeBrowsing.isCertBypassed(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  event.preventDefault();
  callback(false);
  if (store && store.getSettings().safeBrowsingEnabled === false) return;
  for (const tab of tabs.values()) {
    if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContents.id) {
      showTabWarning(tab, {
        type: 'cert',
        url,
        err: `NET::${error || 'ERR_CERT_AUTHORITY_INVALID'}`,
        issuer: certificate?.issuerName || ''
      });
      break;
    }
  }
});

app.whenReady().then(() => {
  // Strip Electron/Poly tokens and align Sec-CH-UA with standard Chromium desktop
  try {
    const cleanUa = session.defaultSession
      .getUserAgent()
      .replace(/\s*Electron\/[^\s]+/gi, '')
      .replace(/\s*Poly\/[^\s]+/gi, '');
    session.defaultSession.setUserAgent(cleanUa);
    app.userAgentFallback = cleanUa;

    const chromeVer = (process.versions.chrome || '134.0.0.0').split('.')[0];
    const stdBrands = `"Chromium";v="${chromeVer}", "Google Chrome";v="${chromeVer}", "Not:A-Brand";v="24"`;
    const stdFullList = `"Chromium";v="${process.versions.chrome || '134.0.0.0'}", "Google Chrome";v="${process.versions.chrome || '134.0.0.0'}", "Not:A-Brand";v="24.0.0.0"`;
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = details.requestHeaders || {};
      if (headers['sec-ch-ua'] || headers['Sec-CH-UA']) {
        delete headers['Sec-CH-UA'];
        headers['sec-ch-ua'] = stdBrands;
      }
      if (headers['sec-ch-ua-full-version-list'] || headers['Sec-CH-UA-Full-Version-List']) {
        delete headers['Sec-CH-UA-Full-Version-List'];
        headers['sec-ch-ua-full-version-list'] = stdFullList;
      }
      callback({ requestHeaders: headers });
    });
  } catch (_) {}

  store = new PolyStore();
  safeBrowsing = new PolySafeBrowsing();
  passwordStore = new PolyPasswordStore();
  importer = new PolyBrowserImporter();
  updater = new PolyUpdater({
    onState: (updState) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:updated', updState);
      }
      if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
        overlayView.webContents.send('updater:updated', updState);
      }
    }
  });
  setTimeout(() => {
    if (safeBrowsing) safeBrowsing.refreshFeedsIfStale().catch(() => {});
  }, 3500);
  setTimeout(() => {
    if (updater && updater.isConfigured()) {
      updater.checkForUpdates({ autoDownload: true }).catch(() => {});
    }
  }, 6000);
  setInterval(() => {
    if (updater && updater.isConfigured()) {
      updater.checkForUpdates({ autoDownload: true }).catch(() => {});
    }
  }, 4 * 60 * 60 * 1000);
  nativeTheme.themeSource = store.getSettings().theme || 'dark';
  adBlocker = new PolyAdBlocker(store, (_wcId, sessionBlocked, recentBlocked) => {
    const payload = {
      enabled: adBlocker.enabled,
      sessionBlocked,
      totalBlocked: store.getAll().stats.totalAdsBlocked,
      recentBlocked
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('adblock:updated', payload);
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('adblock:updated', payload);
    }
  });
  adBlocker.attach(session.defaultSession);
  vpn = new PolyVPN(session.defaultSession, (vpnState) => {
    for (const tab of tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        vpn.applyWebRTCPolicy(tab.view.webContents);
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:updated', vpnState);
    }
    if (overlayView && !overlayView.webContents.isDestroyed() && currentOverlayPanel) {
      overlayView.webContents.send('vpn:updated', vpnState);
    }
  });
  setupDownloads();
  registerIpc();
  createWindow();
});

app.on('before-quit', () => {
  if (metricsInterval) clearInterval(metricsInterval);
  if (vpn) vpn.destroy();
  if (updater && updater.getState().status === 'downloaded') {
    updater.installUpdate({ relaunch: false });
  }
  if (store) {
    if (store.getSettings().clearHistoryOnExit) {
      store.clearHistory();
    }
    store.saveNow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

