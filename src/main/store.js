const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_DATA = {
  settings: {
    searchEngine: 'google',
    hibernationMinutes: 3,
    ramLimitMB: 900,
    adBlockEnabled: true,
    theme: 'dark',
    accentColor: '#7c5cff',
    autoHibernateOnLimit: true,
    showClock: true,
    showSpeedDial: true,
    animationsEnabled: true,
    clearHistoryOnExit: false,
    autofillEnabled: true,
    safeBrowsingEnabled: true
  },
  autofillProfile: {
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    zip: ''
  },
  bookmarks: [
    { id: 'bm-1', title: 'Google', url: 'https://www.google.com', createdAt: Date.now() },
    { id: 'bm-2', title: 'YouTube', url: 'https://www.youtube.com', createdAt: Date.now() },
    { id: 'bm-3', title: 'GitHub', url: 'https://github.com', createdAt: Date.now() }
  ],
  history: [],
  notes: '',
  speedDial: [
    { title: 'Google', url: 'https://www.google.com', color: '#4285F4' },
    { title: 'YouTube', url: 'https://www.youtube.com', color: '#FF0000' },
    { title: 'GitHub', url: 'https://github.com', color: '#8b5cf6' },
    { title: 'Wikipedia', url: 'https://tr.wikipedia.org', color: '#64748b' },
    { title: 'Reddit', url: 'https://www.reddit.com', color: '#FF4500' },
    { title: 'Twitch', url: 'https://www.twitch.tv', color: '#9146FF' }
  ],
  stats: {
    totalAdsBlocked: 0,
    totalHibernations: 0
  }
};

class PolyStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'poly-data.json');
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_DATA,
          ...parsed,
          bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : DEFAULT_DATA.bookmarks,
          speedDial: Array.isArray(parsed.speedDial)
            ? parsed.speedDial.slice(0, 6)
            : JSON.parse(JSON.stringify(DEFAULT_DATA.speedDial)),
          settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
          autofillProfile: { ...DEFAULT_DATA.autofillProfile, ...(parsed.autofillProfile || {}) },
          stats: { ...DEFAULT_DATA.stats, ...(parsed.stats || {}) }
        };
      }
    } catch (err) {
      console.error('[PolyStore] Load error, using defaults:', err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  _scheduleSave() {
    this.saveNow();
  }

  saveNow() {
    try {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PolyStore] Save error:', err);
    }
  }

  getAll() {
    return this.data;
  }

  getSettings() {
    return this.data.settings;
  }

  getSpeedDial() {
    if (!Array.isArray(this.data.speedDial)) {
      this.data.speedDial = JSON.parse(JSON.stringify(DEFAULT_DATA.speedDial));
    }
    return this.data.speedDial.slice(0, 6);
  }

  setSpeedDial(items) {
    const clean = [];
    const list = Array.isArray(items) ? items : [];
    for (const raw of list) {
      if (clean.length >= 6) break;
      if (!raw || typeof raw !== 'object') continue;
      let url = String(raw.url || '').trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        const fallbackTitle = parsed.hostname.replace(/^www\./i, '');
        const title = String(raw.title || '').trim().slice(0, 32) || fallbackTitle;
        const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? raw.color : '#7c5cff';
        clean.push({ title, url: parsed.toString(), color });
      } catch (_) {}
    }
    this.data.speedDial = clean;
    this.saveNow();
    return this.data.speedDial;
  }

  resetSpeedDial() {
    this.data.speedDial = JSON.parse(JSON.stringify(DEFAULT_DATA.speedDial));
    this.saveNow();
    return this.data.speedDial;
  }

  updateSettings(partial) {
    this.data.settings = { ...this.data.settings, ...partial };
    this.saveNow();
    return this.data.settings;
  }

  addHistory(entry) {
    if (!entry.url || entry.url.startsWith('file://') || entry.url.startsWith('poly://')) return;
    const recent = this.data.history[0];
    if (recent && recent.url === entry.url && Date.now() - recent.visitedAt < 5000) {
      recent.title = entry.title || recent.title;
      this.saveNow();
      return;
    }
    this.data.history.unshift({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: entry.title || entry.url,
      url: entry.url,
      visitedAt: Date.now()
    });
    if (this.data.history.length > 500) {
      this.data.history.length = 500;
    }
    this.saveNow();
  }

  clearHistory() {
    this.data.history = [];
    this.saveNow();
    return [];
  }

  clearHistoryRange(range = 'all') {
    if (range === 'all') {
      this.data.history = [];
    } else {
      let cutoff = 0;
      const now = Date.now();
      if (range === '15m') cutoff = now - 15 * 60 * 1000;
      else if (range === '1h') cutoff = now - 60 * 60 * 1000;
      else if (range === '24h') cutoff = now - 24 * 60 * 60 * 1000;
      else if (range === '7d') cutoff = now - 7 * 24 * 60 * 60 * 1000;
      else if (range === '4w') cutoff = now - 28 * 24 * 60 * 60 * 1000;
      if (cutoff > 0) {
        this.data.history = this.data.history.filter((h) => (h.visitedAt || 0) < cutoff);
      }
    }
    this.saveNow();
    return this.data.history;
  }

  addBookmark(item) {
    const exists = this.data.bookmarks.find((b) => b.url === item.url);
    if (exists) return this.data.bookmarks;
    this.data.bookmarks.unshift({
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: item.title || item.url,
      url: item.url,
      createdAt: Date.now()
    });
    this.saveNow();
    return this.data.bookmarks;
  }

  removeBookmark(url) {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.url !== url);
    this.saveNow();
    return this.data.bookmarks;
  }

  setNotes(text) {
    this.data.notes = String(text || '');
    this._scheduleSave();
    return this.data.notes;
  }

  getAutofillProfile() {
    return { ...DEFAULT_DATA.autofillProfile, ...(this.data.autofillProfile || {}) };
  }

  updateAutofillProfile(partial) {
    this.data.autofillProfile = {
      ...DEFAULT_DATA.autofillProfile,
      ...(this.data.autofillProfile || {}),
      ...(partial || {})
    };
    this.saveNow();
    return this.getAutofillProfile();
  }

  incrementAdsBlocked(count = 1) {
    this.data.stats.totalAdsBlocked += count;
    this._scheduleSave();
  }

  incrementHibernations(count = 1) {
    this.data.stats.totalHibernations += count;
    this._scheduleSave();
  }
}

module.exports = PolyStore;

