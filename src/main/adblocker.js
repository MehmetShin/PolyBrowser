const { URL } = require('url');

// Curated high-impact ad, tracker, and telemetry domains (O(1) Set lookup)
const BLOCKED_DOMAINS = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'adnxs.com',
  'adsrvr.org',
  'advertising.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'amazon-adsystem.com',
  'ads-twitter.com',
  'adroll.com',
  'bidswitch.net',
  'casalemedia.com',
  'demdex.net',
  'krxd.net',
  'mathtag.com',
  'rlcdn.com',
  'sharethrough.com',
  'smartadserver.com',
  'spotxchange.com',
  'tapad.com',
  'teads.tv',
  'triplelift.com',
  'yieldmo.com',
  'zedo.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'branch.io',
  'appsflyer.com',
  'adjust.com',
  'chartbeat.com',
  'newrelic.com',
  'nr-data.net',
  'sentry.io',
  'bugsnag.com',
  'clarity.ms',
  'omtrdc.net',
  '2mdn.net',
  'flashtalking.com',
  'serving-sys.com',
  'mgid.com',
  'revcontent.com',
  'propellerads.com',
  'popads.net',
  'popcash.net',
  'adsterra.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.net'
]);

const BLOCKED_PATH_PATTERNS = [
  /\/pagead\//i,
  /\/ads\/ga-audiences/i,
  /\/gtag\/js\?/i,
  /google-analytics\.com\/analytics\.js/i,
  /google-analytics\.com\/g\/collect/i,
  /facebook\.com\/tr\/?\?/i,
  /connect\.facebook\.net\/.*\/fbevents\.js/i,
  /\/adserver\//i,
  /\/doubleclick\//i,
  /youtube\.com\/api\/stats\/ads/i,
  /youtube\.com\/ptracking/i,
  /youtube\.com\/get_midroll_info/i,
  /youtube\.com\/pagead\//i,
  /youtube\.com\/error_204\?.*ad/i,
  /googlevideo\.com\/videoplayback\?.*(&oad=|&ctier=L|adformat=)/i,
  /play\.google\.com\/log/i
];

function isBlockedHost(hostname) {
  if (!hostname) return false;
  let host = hostname.toLowerCase();
  if (BLOCKED_DOMAINS.has(host)) return true;
  // Walk up parent domains (e.g., tpc.googlesyndication.com -> googlesyndication.com)
  let dotIdx = host.indexOf('.');
  while (dotIdx !== -1) {
    host = host.slice(dotIdx + 1);
    if (BLOCKED_DOMAINS.has(host)) return true;
    dotIdx = host.indexOf('.');
  }
  return false;
}

class PolyAdBlocker {
  constructor(store, onBlockedCallback) {
    this.store = store;
    this.onBlockedCallback = onBlockedCallback;
    this.enabled = store.getSettings().adBlockEnabled !== false;
    this.sessionBlocked = 0;
    this.perWebContentsBlocked = new Map();
    this.recentBlocked = [];
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.store.updateSettings({ adBlockEnabled: this.enabled });
  }

  attach(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      if (!this.enabled) {
        return callback({ cancel: false });
      }

      // Never block main frame user navigation to a domain directly
      if (details.resourceType === 'mainFrame') {
        return callback({ cancel: false });
      }

      try {
        const parsed = new URL(details.url);
        let shouldBlock = isBlockedHost(parsed.hostname);
        if (!shouldBlock) {
          for (const pattern of BLOCKED_PATH_PATTERNS) {
            if (pattern.test(details.url)) {
              shouldBlock = true;
              break;
            }
          }
        }

        if (shouldBlock) {
          this.sessionBlocked += 1;
          this.store.incrementAdsBlocked(1);
          this.recentBlocked.unshift(parsed.hostname);
          if (this.recentBlocked.length > 15) this.recentBlocked.length = 15;
          if (details.webContentsId) {
            const prev = this.perWebContentsBlocked.get(details.webContentsId) || 0;
            this.perWebContentsBlocked.set(details.webContentsId, prev + 1);
          }
          if (this.onBlockedCallback) {
            this.onBlockedCallback(details.webContentsId, this.sessionBlocked, this.recentBlocked);
          }
          return callback({ cancel: true });
        }
      } catch (_) {
        // Ignore malformed URLs
      }

      return callback({ cancel: false });
    });
  }

  recordExternalBlock(webContentsId, hostLabel = 'youtube-ad') {
    if (!this.enabled) return;
    this.sessionBlocked += 1;
    this.store.incrementAdsBlocked(1);
    if (hostLabel) {
      this.recentBlocked.unshift(hostLabel);
      if (this.recentBlocked.length > 15) this.recentBlocked.length = 15;
    }
    if (webContentsId) {
      const prev = this.perWebContentsBlocked.get(webContentsId) || 0;
      this.perWebContentsBlocked.set(webContentsId, prev + 1);
    }
    if (this.onBlockedCallback) {
      this.onBlockedCallback(webContentsId, this.sessionBlocked, this.recentBlocked);
    }
  }

  getTabBlockedCount(webContentsId) {
    return this.perWebContentsBlocked.get(webContentsId) || 0;
  }

  clearTab(webContentsId) {
    this.perWebContentsBlocked.delete(webContentsId);
  }
}

module.exports = PolyAdBlocker;

