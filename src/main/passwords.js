const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function normalizeOrigin(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch (_) {
    return s.toLowerCase();
  }
}

function normalizeHost(rawUrl) {
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function getBaseDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const ccSlds = new Set(['com', 'net', 'org', 'edu', 'gov', 'co', 'ac']);
  if (tld.length === 2 && ccSlds.has(sld) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function encryptSecret(plain) {
  const str = String(plain || '');
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return 'safe:' + safeStorage.encryptString(str).toString('base64');
    }
  } catch (_) {}
  return 'raw:' + Buffer.from(str, 'utf8').toString('base64');
}

function decryptSecret(encoded) {
  const s = String(encoded || '');
  if (!s) return '';
  try {
    if (s.startsWith('safe:') && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(s.slice(5), 'base64'));
    }
    if (s.startsWith('raw:')) {
      return Buffer.from(s.slice(4), 'base64').toString('utf8');
    }
  } catch (_) {}
  return '';
}

class PolyPasswordStore {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'poly-passwords.json');
    this.items = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (_) {
      return [];
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PolyPasswords] Save error:', err);
    }
  }

  list() {
    return this.items.map((it) => ({
      id: it.id,
      origin: it.origin,
      url: it.url,
      username: it.username,
      hasPassword: Boolean(it.passwordEnc),
      updatedAt: it.updatedAt
    }));
  }

  reveal(id) {
    const item = this.items.find((it) => it.id === id);
    if (!item) return '';
    return decryptSecret(item.passwordEnc);
  }

  getForUrl(rawUrl) {
    const targetOrigin = normalizeOrigin(rawUrl);
    const targetHost = normalizeHost(rawUrl);
    const targetBase = getBaseDomain(targetHost);
    if (!targetOrigin && !targetHost) return [];

    const matched = this.items.filter((it) => {
      if (it.origin === targetOrigin) return true;
      const h = normalizeHost(it.origin || it.url);
      if (!h || !targetHost) return false;
      if (h === targetHost) return true;
      const b = getBaseDomain(h);
      return Boolean(b && targetBase && b === targetBase);
    });

    matched.sort((a, b) => {
      const ha = normalizeHost(a.origin || a.url);
      const hb = normalizeHost(b.origin || b.url);
      const aExact = ha === targetHost ? 1 : 0;
      const bExact = hb === targetHost ? 1 : 0;
      return bExact - aExact;
    });

    return matched.map((it) => ({
        id: it.id,
        origin: it.origin,
        url: it.url,
        username: it.username,
        password: decryptSecret(it.passwordEnc)
      }))
      .filter((it) => it.password || it.username);
  }

  addOrUpdate({ url, username, password }) {
    const origin = normalizeOrigin(url);
    const cleanUser = String(username || '').trim();
    const cleanPass = String(password || '');
    if (!origin || (!cleanUser && !cleanPass)) return this.list();

    const fullUrl = /^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : origin;
    const existing = this.items.find((it) => it.origin === origin && it.username === cleanUser);
    const now = Date.now();
    if (existing) {
      existing.url = fullUrl;
      if (cleanPass) existing.passwordEnc = encryptSecret(cleanPass);
      existing.updatedAt = now;
    } else {
      this.items.unshift({
        id: `pw-${now}-${Math.random().toString(36).slice(2, 7)}`,
        origin,
        url: fullUrl,
        username: cleanUser,
        passwordEnc: encryptSecret(cleanPass),
        createdAt: now,
        updatedAt: now
      });
    }
    this._save();
    return this.list();
  }

  importMany(entries = []) {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const now = Date.now();

    for (const entry of entries) {
      const origin = normalizeOrigin(entry.url || entry.origin);
      const cleanUser = String(entry.username || '').trim();
      const cleanPass = String(entry.password || '');
      if (!origin || !cleanPass) {
        skipped++;
        continue;
      }
      const existing = this.items.find((it) => it.origin === origin && it.username === cleanUser);
      if (existing) {
        if (decryptSecret(existing.passwordEnc) !== cleanPass) {
          existing.passwordEnc = encryptSecret(cleanPass);
          existing.updatedAt = now;
          updated++;
        } else {
          skipped++;
        }
      } else {
        const fullUrl = /^https?:\/\//i.test(String(entry.url || '').trim()) ? String(entry.url).trim() : origin;
        this.items.unshift({
          id: `pw-${now}-${Math.random().toString(36).slice(2, 8)}`,
          origin,
          url: fullUrl,
          username: cleanUser,
          passwordEnc: encryptSecret(cleanPass),
          createdAt: now,
          updatedAt: now
        });
        added++;
      }
    }

    if (added > 0 || updated > 0) {
      this._save();
    }
    return { added, updated, skipped };
  }

  remove(id) {
    this.items = this.items.filter((it) => it.id !== id);
    this._save();
    return this.list();
  }

  clearAll() {
    this.items = [];
    this._save();
    return [];
  }

  exportDecryptedEntries() {
    return this.items.map((it) => ({
      name: (it.origin || '').replace(/^https?:\/\//i, ''),
      url: it.url || it.origin || '',
      username: it.username || '',
      password: decryptSecret(it.passwordEnc)
    }));
  }

  getSecurityCheckup() {
    const decrypted = this.items.map((it) => ({
      id: it.id,
      origin: it.origin,
      url: it.url,
      username: it.username,
      password: decryptSecret(it.passwordEnc)
    }));

    const weak = [];
    const passCount = new Map();
    for (const item of decrypted) {
      if (!item.password) continue;
      if (item.password.length < 8) {
        weak.push({ id: item.id, origin: item.origin, username: item.username, reason: '8 karakterden kısa' });
      }
      passCount.set(item.password, (passCount.get(item.password) || 0) + 1);
    }

    const reused = [];
    for (const item of decrypted) {
      if (item.password && (passCount.get(item.password) || 0) > 1) {
        reused.push({ id: item.id, origin: item.origin, username: item.username });
      }
    }

    return {
      total: decrypted.length,
      weak,
      reused
    };
  }
}

async function fillTabInputs(wc, { credential = null, profile = null, singleValue = '', useActiveElement = false } = {}) {
  if (!wc || wc.isDestroyed()) return { ok: false, filledFields: 0 };
  const payload = JSON.stringify({
    username: credential?.username || '',
    password: credential?.password || '',
    profile: profile || {},
    singleValue: singleValue || '',
    useActiveElement: Boolean(useActiveElement)
  });

  const script = `(() => {
    const data = ${payload};
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const setVal = (el, val) => {
      if (!el || !val) return false;
      try {
        const lastVal = el.value;
        nativeSetter.call(el, val);
        const tracker = el._valueTracker;
        if (tracker) tracker.setValue(lastVal === val ? '' : lastVal);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (_) {
        return false;
      }
    };
    const isVisible = (el) => {
      if (!el || el.disabled || el.readOnly) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    let filled = 0;
    const active = document.activeElement && document.activeElement.tagName === 'INPUT' && isVisible(document.activeElement)
      ? document.activeElement
      : null;

    if (data.singleValue && active) {
      if (setVal(active, data.singleValue)) filled++;
      return filled;
    }

    const allInputs = Array.from(document.querySelectorAll('input')).filter(isVisible);

    // 1) Credentials (password + matching username/email input)
    if (data.password || data.username) {
      const pwInputs = allInputs.filter((i) => (i.type || '').toLowerCase() === 'password');
      const activeIsPw = active && (active.type || '').toLowerCase() === 'password';
      const targetPw = activeIsPw ? active : (pwInputs[0] || null);

      if (targetPw && data.password) {
        if (setVal(targetPw, data.password)) filled++;
        if (data.username) {
          let userEl = (data.useActiveElement && active && !activeIsPw) ? active : null;
          if (!userEl) {
            const scope = targetPw.form ? Array.from(targetPw.form.querySelectorAll('input')).filter(isVisible) : allInputs;
            const idx = scope.indexOf(targetPw);
            const candidatePool = idx > 0 ? scope.slice(0, idx).reverse() : scope;
            userEl = candidatePool.find((i) => {
              const t = (i.type || 'text').toLowerCase();
              return t === 'text' || t === 'email' || t === 'tel';
            });
          }
          if (userEl && setVal(userEl, data.username)) filled++;
        }
      } else if (data.username) {
        let userEl = (data.useActiveElement && active && (active.type || '').toLowerCase() !== 'password') ? active : null;
        if (!userEl) {
          userEl = allInputs.find((i) => {
            const t = (i.type || 'text').toLowerCase();
            const hint = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.autocomplete || '') + ' ' + (i.placeholder || '')).toLowerCase();
            if (/\b(code|otp|pin|kod|2fa|two.?factor|verif\w*|dogrula\w*|doğrula\w*|captcha|search|ara)\b/i.test(hint)) return false;
            return (t === 'email' || t === 'text') && /user|mail|login|hesap|kullan|identifier|eposta|e-posta/.test(hint);
          });
        }
        if (userEl && setVal(userEl, data.username)) filled++;
      }
    }

    // 2) Personal Profile fields (if present & empty)
    const p = data.profile || {};
    for (const el of allInputs) {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'password' || t === 'hidden' || t === 'submit' || t === 'button' || t === 'checkbox' || t === 'radio') continue;
      if (el.value && el.value.trim().length > 0) continue;
      const hint = ((el.autocomplete || '') + ' ' + (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
      if (p.email && (t === 'email' || /email|e-mail|eposta|e-posta/.test(hint))) {
        if (setVal(el, p.email)) filled++;
      } else if (p.phone && (t === 'tel' || /phone|tel|mobile|gsm|telefon/.test(hint))) {
        if (setVal(el, p.phone)) filled++;
      } else if (p.fullName && /name|fullname|adsoyad|ad soyad|isim/.test(hint) && !/user|kullan/.test(hint)) {
        if (setVal(el, p.fullName)) filled++;
      } else if (p.address && /address|street|adres|sokak|mahalle/.test(hint)) {
        if (setVal(el, p.address)) filled++;
      } else if (p.city && /city|sehir|şehir|il\b/.test(hint)) {
        if (setVal(el, p.city)) filled++;
      } else if (p.zip && /zip|postal|posta/.test(hint)) {
        if (setVal(el, p.zip)) filled++;
      }
    }
    return filled;
  })();`;

  try {
    const filledFields = await wc.executeJavaScript(script, true);
    return { ok: true, filledFields: Number(filledFields) || 0 };
  } catch (_) {
    return { ok: false, filledFields: 0 };
  }
}

module.exports = { PolyPasswordStore, fillTabInputs };

