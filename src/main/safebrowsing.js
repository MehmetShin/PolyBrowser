const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Shared multi-tenant hosting suffixes where only the exact malicious URL should be blocked, not the whole domain.
const SHARED_HOSTS = new Set([
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'herokuapp.com',
  'blogspot.com',
  'wordpress.com',
  'sites.google.com',
  'drive.google.com',
  'docs.google.com',
  'dropbox.com',
  '1drv.ms',
  'bit.ly',
  'tinyurl.com',
  't.co'
]);

const BUILTIN_TEST_THREATS = new Map([
  ['testsafebrowsing.appspot.com/s/malware.html', 'malware'],
  ['testsafebrowsing.appspot.com/s/phishing.html', 'phishing'],
  ['testsafebrowsing.appspot.com/s/unwanted.html', 'malware'],
  ['malware.testing.google.test', 'malware'],
  ['phishing.testing.google.test', 'phishing']
]);

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

function isSharedHost(hostname) {
  for (const suffix of SHARED_HOSTS) {
    if (hostname === suffix || hostname.endsWith('.' + suffix)) return true;
  }
  return false;
}

class PolySafeBrowsing {
  constructor() {
    this.cachePath = path.join(app.getPath('userData'), 'poly-safebrowsing-cache.json');
    this.threatUrls = new Set();
    this.threatHosts = new Set();
    this.lastUpdatedAt = 0;
    this.bypassedHosts = new Set();
    this.bypassedCertHosts = new Set();
    this._refreshing = false;
    this._loadCache();
  }

  _loadCache() {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      if (Array.isArray(parsed.urls)) {
        for (const u of parsed.urls) this.threatUrls.add(u);
      }
      if (Array.isArray(parsed.hosts)) {
        for (const h of parsed.hosts) this.threatHosts.add(h);
      }
      this.lastUpdatedAt = Number(parsed.updatedAt) || 0;
    } catch (_) {}
  }

  _saveCache() {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = {
        updatedAt: this.lastUpdatedAt,
        urls: Array.from(this.threatUrls).slice(0, 8000),
        hosts: Array.from(this.threatHosts).slice(0, 8000)
      };
      fs.writeFileSync(this.cachePath, JSON.stringify(payload), 'utf-8');
    } catch (_) {}
  }

  async refreshFeedsIfStale(force = false) {
    if (this._refreshing) return;
    if (!force && this.lastUpdatedAt && Date.now() - this.lastUpdatedAt < CACHE_TTL_MS && this.threatHosts.size > 0) {
      return;
    }
    this._refreshing = true;
    try {
      const fetchFeed = async (url) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) return '';
          return await res.text();
        } catch (_) {
          return '';
        } finally {
          clearTimeout(timer);
        }
      };

      const [urlhausText, openphishText] = await Promise.all([
        fetchFeed('https://urlhaus.abuse.ch/downloads/text_online/'),
        fetchFeed('https://openphish.com/feed.txt')
      ]);

      const nextUrls = new Set();
      const nextHosts = new Set();

      const ingest = (rawText, limit) => {
        if (!rawText) return;
        let count = 0;
        const lines = rawText.split(/\r?\n/);
        for (const line of lines) {
          if (count >= limit) break;
          const s = line.trim();
          if (!s || s.startsWith('#')) continue;
          try {
            const parsed = new URL(s);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
            const host = normalizeHost(parsed.hostname);
            if (!host || host === 'localhost' || host === '127.0.0.1') continue;
            const cleanUrl = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
            nextUrls.add(cleanUrl);
            if (!isSharedHost(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) === false || (!isSharedHost(host) && parsed.pathname.length <= 2)) {
              nextHosts.add(host);
            } else if (!isSharedHost(host)) {
              nextHosts.add(host);
            }
            count++;
          } catch (_) {}
        }
      };

      ingest(urlhausText, 4000);
      ingest(openphishText, 4000);

      if (nextUrls.size > 0 || nextHosts.size > 0) {
        this.threatUrls = nextUrls;
        this.threatHosts = nextHosts;
        this.lastUpdatedAt = Date.now();
        this._saveCache();
      }
    } finally {
      this._refreshing = false;
    }
  }

  bypassSite(hostOrUrl) {
    try {
      const host = hostOrUrl.includes('://') ? normalizeHost(new URL(hostOrUrl).hostname) : normalizeHost(hostOrUrl);
      if (host) this.bypassedHosts.add(host);
    } catch (_) {}
  }

  bypassCert(hostOrUrl) {
    try {
      const host = hostOrUrl.includes('://') ? normalizeHost(new URL(hostOrUrl).hostname) : normalizeHost(hostOrUrl);
      if (host) this.bypassedCertHosts.add(host);
    } catch (_) {}
  }

  isCertBypassed(hostOrUrl) {
    try {
      const host = hostOrUrl.includes('://') ? normalizeHost(new URL(hostOrUrl).hostname) : normalizeHost(hostOrUrl);
      return Boolean(host && this.bypassedCertHosts.has(host));
    } catch (_) {
      return false;
    }
  }

  checkUrl(rawUrl) {
    if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
      return { blocked: false };
    }
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (_) {
      return { blocked: false };
    }
    const host = normalizeHost(parsed.hostname);
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return { blocked: false };
    }
    if (this.bypassedHosts.has(host)) {
      return { blocked: false };
    }

    const cleanUrl = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
    const hostPlusPath = `${host}${parsed.pathname}`.toLowerCase();

    for (const [pattern, category] of BUILTIN_TEST_THREATS.entries()) {
      if (hostPlusPath === pattern || host === pattern || host.endsWith('.' + pattern)) {
        return {
          blocked: true,
          category,
          host,
          url: rawUrl,
          reason: category === 'phishing'
            ? 'Kimlik avı (Phishing) / sahte giriş sayfası tespit edildi.'
            : 'Zararlı yazılım dağıtımı veya tehlikeli bağlantı tespit edildi.'
        };
      }
    }

    if (this.threatUrls.has(cleanUrl) || this.threatUrls.has(hostPlusPath)) {
      return {
        blocked: true,
        category: 'phishing',
        host,
        url: rawUrl,
        reason: 'Bilinen zararlı yazılım veya kimlik avı veritabanıyla eşleşti.'
      };
    }

    if (!isSharedHost(host) && this.threatHosts.has(host)) {
      return {
        blocked: true,
        category: 'malware',
        host,
        url: rawUrl,
        reason: 'Bu alan adı aktif tehdit listelerinde yer alıyor.'
      };
    }

    return { blocked: false };
  }
}

module.exports = PolySafeBrowsing;

