const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('polyAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Layout viewport sync (keeps WebContentsView aligned with UI)
  setViewport: (rect) => ipcRenderer.send('layout:set-viewport', rect),

  // Tabs
  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  activateTab: (id) => ipcRenderer.invoke('tabs:activate', id),
  hibernateTab: (id) => ipcRenderer.invoke('tabs:hibernate', id),
  hibernateAllInactive: () => ipcRenderer.invoke('tabs:hibernate-all-inactive'),
  toggleMuteTab: (id) => ipcRenderer.invoke('tabs:toggle-mute', id),
  showTabContextMenu: (id) => ipcRenderer.send('tabs:context-menu', id),

  // Split View
  toggleSplitView: (tabId) => ipcRenderer.invoke('split:toggle', tabId),
  setFocusedPane: (pane) => ipcRenderer.send('split:focus-pane', pane),

  // Navigation (operates on focused pane)
  navigate: (input) => ipcRenderer.invoke('nav:go', input),
  goBack: () => ipcRenderer.send('nav:back'),
  goForward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  goHome: () => ipcRenderer.send('nav:home'),

  // Data & Features
  getInitialState: () => ipcRenderer.invoke('app:get-state'),
  toggleBookmark: (item) => ipcRenderer.invoke('bookmarks:toggle', item),
  removeBookmark: (url) => ipcRenderer.invoke('bookmarks:remove', url),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  clearBrowsingData: (options) => ipcRenderer.invoke('history:clear-advanced', options),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  toggleAdBlock: (enabled) => ipcRenderer.invoke('adblock:toggle', enabled),
  vpnConnect: (country, forceRefresh) => ipcRenderer.invoke('vpn:connect', country, forceRefresh),
  vpnDisconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  vpnGetState: () => ipcRenderer.invoke('vpn:get-state'),
  onVpnUpdated: (cb) => ipcRenderer.on('vpn:updated', (_e, data) => cb(data)),

  // Passwords, Autofill & Browser Data Import
  passwordsList: () => ipcRenderer.invoke('passwords:list'),
  passwordsReveal: (id) => ipcRenderer.invoke('passwords:reveal', id),
  passwordsSave: (entry) => ipcRenderer.invoke('passwords:save', entry),
  passwordsDelete: (id) => ipcRenderer.invoke('passwords:delete', id),
  autofillGetProfile: () => ipcRenderer.invoke('autofill:get-profile'),
  autofillSaveProfile: (profile) => ipcRenderer.invoke('autofill:save-profile'),
  autofillFillActive: (credId) => ipcRenderer.invoke('autofill:fill-active', credId),
  autofillPopupPick: (item) => ipcRenderer.send('autofill-popup:pick', item),
  autofillPopupManage: () => ipcRenderer.send('autofill-popup:manage'),
  resizeAutofillPopup: (height) => ipcRenderer.send('autofill-popup:resize', height),
  autofillPopupClose: () => ipcRenderer.send('autofill-popup:close'),
  onAutofillPopupData: (cb) => ipcRenderer.on('autofill-popup:data', (_e, data) => cb(data)),
  importDetectBrowsers: () => ipcRenderer.invoke('import:detect-browsers'),
  importRunBrowser: (browserId, options) => ipcRenderer.invoke('import:run-browser', browserId, options),
  importPickCsv: () => ipcRenderer.invoke('import:pick-csv'),
  importPickHtml: () => ipcRenderer.invoke('import:pick-html'),
  importExportPasswordsCsv: () => ipcRenderer.invoke('import:export-passwords-csv'),
  importExportBookmarksHtml: () => ipcRenderer.invoke('import:export-bookmarks-html'),
  openDownload: (filePath) => ipcRenderer.send('downloads:open', filePath),
  onOmniboxInlineComplete: (cb) => ipcRenderer.on('omnibox:inline-complete', (_e, data) => cb(data)),
  showDownloadInFolder: (filePath) => ipcRenderer.send('downloads:show-in-folder', filePath),
  cancelDownload: (id) => ipcRenderer.send('downloads:cancel', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

  // Flyout management (Windows 11 overlay window)
  toggleFlyout: (panel) => ipcRenderer.send('flyout:toggle', panel),
  closeFlyout: () => ipcRenderer.send('flyout:close'),
  onFlyoutShow: (cb) => ipcRenderer.on('flyout:show', (_e, data) => cb(data)),
  onFlyoutOpened: (cb) => ipcRenderer.on('flyout:opened', (_e, panel) => cb(panel)),
  onFlyoutClosed: (cb) => ipcRenderer.on('flyout:closed', () => cb()),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (_e, theme) => cb(theme)),
  onAccentChanged: (cb) => ipcRenderer.on('accent:changed', (_e, color) => cb(color)),
  onBookmarksUpdated: (cb) => ipcRenderer.on('bookmarks:updated', (_e, bms) => cb(bms)),
  showBookmarkContextMenu: (bm) => ipcRenderer.send('bookmarks:context-menu', bm),

  // Suggestions dropdown
  openSuggestions: (payload) => ipcRenderer.send('suggestions:open', payload),
  querySuggestions: (query) => ipcRenderer.send('suggestions:query', query),
  closeSuggestions: () => ipcRenderer.send('suggestions:close'),
  onSuggestionsData: (cb) => ipcRenderer.on('suggestions:data', (_e, data) => cb(data)),
  resizeSuggestions: (height) => ipcRenderer.send('suggestions:resize', height),
  selectSuggestion: (item) => ipcRenderer.send('suggestions:select', item),
  onOmniboxBlur: (cb) => ipcRenderer.on('omnibox:blur', () => cb()),
  onOmniboxFocus: (cb) => ipcRenderer.on('omnibox:focus', () => cb()),

  // Site Info popup (Security, Certificates, Cookies)
  openSiteInfo: (payload) => ipcRenderer.send('siteinfo:open', payload),
  closeSiteInfo: () => ipcRenderer.send('siteinfo:close'),
  onSiteInfoData: (cb) => ipcRenderer.on('siteinfo:data', (_e, data) => cb(data)),
  resizeSiteInfo: (height) => ipcRenderer.send('siteinfo:resize', height),
  clearSiteCookies: (domain) => ipcRenderer.invoke('siteinfo:clear-cookies', domain),

  // Events from main process
  onTabsUpdated: (cb) => ipcRenderer.on('tabs:updated', (_e, data) => cb(data)),
  onMetricsUpdated: (cb) => ipcRenderer.on('metrics:updated', (_e, data) => cb(data)),
  onDownloadsUpdated: (cb) => ipcRenderer.on('downloads:updated', (_e, data) => cb(data)),
  onAdBlockUpdated: (cb) => ipcRenderer.on('adblock:updated', (_e, data) => cb(data)),
  onWindowState: (cb) => ipcRenderer.on('window:state', (_e, data) => cb(data)),

  // Auto-updater
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  checkUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdaterUpdated: (cb) => ipcRenderer.on('updater:updated', (_e, data) => cb(data))
});

