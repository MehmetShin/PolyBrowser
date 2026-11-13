const { ipcRenderer, webFrame, contextBridge } = require('electron');

(() => {
  try {
    if (location.protocol === 'file:' && location.pathname.toLowerCase().endsWith('/newtab.html')) {
      contextBridge.exposeInMainWorld('polyNewTabAPI', {
        getSpeedDial: () => ipcRenderer.invoke('newtab:get-speed-dial'),
        saveSpeedDial: (items) => ipcRenderer.invoke('newtab:save-speed-dial', items),
        resetSpeedDial: () => ipcRenderer.invoke('newtab:reset-speed-dial'),
        onSpeedDialUpdated: (cb) => ipcRenderer.on('newtab:speed-dial-updated', (_e, items) => cb(items))
      });
    }
  } catch (_) {}
  const ELIGIBLE_TYPES = new Set(['', 'text', 'email', 'password', 'tel', 'search', 'url']);
  let lastFocusedEl = null;
  let blurTimer = null;

  function isWebPage() {
    try {
      return location.protocol === 'http:' || location.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  // YouTube Ad Blocker (only when AdBlock is enabled and on YouTube)
  try {
    if (
      isWebPage() &&
      /(^|\.)youtube(-nocookie)?\.com$/i.test(location.hostname) &&
      webFrame &&
      typeof webFrame.executeJavaScript === 'function' &&
      ipcRenderer.sendSync('adblock:is-enabled')
    ) {
      window.addEventListener('message', (ev) => {
        if (ev.source === window && ev.data && ev.data.__polyYtAdBlocked) {
          ipcRenderer.send('adblock:yt-blocked', ev.data.label || 'youtube-ads');
        }
      });

      webFrame.executeJavaScript(`(() => {
        if (window.__polyYtAdBlockerInstalled) return;
        window.__polyYtAdBlockerInstalled = true;

        const notifyBlocked = (label) => {
          try { window.postMessage({ __polyYtAdBlocked: true, label }, '*'); } catch (_) {}
        };

        const AD_KEYS = new Set(['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']);
        const AD_RENDERERS = new Set([
          'adSlotRenderer',
          'promotedSparklesWebRenderer',
          'promotedSparklesTextSearchRenderer',
          'displayAdRenderer',
          'bannerPromoRenderer',
          'statementBannerRenderer',
          'mealbarPromoRenderer',
          'videoMastheadAdV3Renderer',
          'inFeedAdLayoutRenderer'
        ]);

        function cleanYtObject(obj, depth = 0) {
          if (!obj || typeof obj !== 'object' || depth > 14) return obj;
          if (Array.isArray(obj)) {
            for (let i = obj.length - 1; i >= 0; i--) {
              const item = obj[i];
              if (item && typeof item === 'object') {
                let isAd = false;
                for (const k of AD_RENDERERS) {
                  if (k in item) { isAd = true; break; }
                }
                if (isAd) {
                  obj.splice(i, 1);
                  notifyBlocked('youtube-feed-ad');
                  continue;
                }
                cleanYtObject(item, depth + 1);
              }
            }
            return obj;
          }
          for (const key of Object.keys(obj)) {
            if (AD_KEYS.has(key)) {
              delete obj[key];
              notifyBlocked('youtube-player-ad');
            } else if (AD_RENDERERS.has(key)) {
              delete obj[key];
              notifyBlocked('youtube-feed-ad');
            } else if (obj[key] && typeof obj[key] === 'object') {
              cleanYtObject(obj[key], depth + 1);
            }
          }
          return obj;
        }

        // 1. Intercept ytInitialPlayerResponse & ytInitialData before YouTube reads them
        const trapGlobal = (prop) => {
          let internalVal = window[prop];
          if (internalVal && typeof internalVal === 'object') cleanYtObject(internalVal);
          try {
            Object.defineProperty(window, prop, {
              configurable: true,
              enumerable: true,
              get() { return internalVal; },
              set(v) {
                internalVal = (v && typeof v === 'object') ? cleanYtObject(v) : v;
              }
            });
          } catch (_) {}
        };
        trapGlobal('ytInitialPlayerResponse');
        trapGlobal('ytInitialData');

        // 2. Intercept fetch() for /youtubei/v1/player, /next, /browse, /search, /get_watch
        const origFetch = window.fetch;
        if (typeof origFetch === 'function') {
          window.fetch = async function(...args) {
            const res = await origFetch.apply(this, args);
            try {
              const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
              if (/\\/youtubei\\/v1\\/(player|next|browse|search|get_watch)/i.test(reqUrl)) {
                const clone = res.clone();
                const text = await clone.text();
                if (text && (text.includes('adPlacements') || text.includes('playerAds') || text.includes('adSlots') || text.includes('adSlotRenderer'))) {
                  const json = JSON.parse(text);
                  cleanYtObject(json);
                  return new Response(JSON.stringify(json), {
                    status: res.status,
                    statusText: res.statusText,
                    headers: res.headers
                  });
                }
              }
            } catch (_) {}
            return res;
          };
        }

        // 3. Cosmetic CSS for YouTube ad containers & banners
        const injectCss = () => {
          if (document.getElementById('poly-yt-adblock-css')) return;
          const style = document.createElement('style');
          style.id = 'poly-yt-adblock-css';
          style.textContent = [
            'ytd-ad-slot-renderer,',
            'ytd-in-feed-ad-layout-renderer,',
            'ytd-banner-promo-renderer,',
            'ytd-video-masthead-ad-v3-renderer,',
            'ytd-primetime-promo-renderer,',
            'ytd-companion-slot-renderer,',
            'ytd-promoted-sparkles-web-renderer,',
            'ytd-display-ad-renderer,',
            'ytd-merch-shelf-renderer,',
            'ytd-enforcement-message-view-model,',
            '#masthead-ad,',
            '#player-ads,',
            '.ytp-ad-module,',
            '.ytp-ad-overlay-container,',
            '.ytp-ad-message-container { display: none !important; }'
          ].join(' ');
          (document.head || document.documentElement).appendChild(style);
        };
        if (document.head || document.documentElement) injectCss();
        else window.addEventListener('DOMContentLoaded', injectCss, { once: true });

        // 4. In-player fallback: instantly skip/fast-forward any residual ad
        let lastSkipAt = 0;
        const sweepAds = () => {
          const player = document.getElementById('movie_player');
          if (!player) return;
          if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
            const video = player.querySelector('video');
            if (video) {
              if (!video.muted) video.muted = true;
              if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
                video.currentTime = video.duration;
              }
            }
            const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button');
            if (skipBtn) skipBtn.click();
            if (Date.now() - lastSkipAt > 1500) {
              lastSkipAt = Date.now();
              notifyBlocked('youtube-video-ad');
            }
          }
          const enf = document.querySelector('ytd-enforcement-message-view-model');
          if (enf) {
            enf.remove();
            const v = document.querySelector('#movie_player video');
            if (v && v.paused) v.play().catch(() => {});
          }
        };
        setInterval(sweepAds, 250);
      })();`, true).catch(() => {});
    }
  } catch (_) {}
  // Windows Security "Passkey / Insert USB security key" modal on page load or input focus.
  if (isWebPage() && webFrame && typeof webFrame.executeJavaScript === 'function') {
    try {
      webFrame.executeJavaScript(`(() => {
        try {
          if (window.PublicKeyCredential && typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function') {
            window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
          }
          if (!window.chrome) {
            Object.defineProperty(window, 'chrome', {
              value: { runtime: {}, app: { isInstalled: false } },
              writable: true,
              configurable: true
            });
          }
          if (navigator.credentials && typeof navigator.credentials.get === 'function') {
            const origGet = navigator.credentials.get.bind(navigator.credentials);
            navigator.credentials.get = function(options) {
              if (options && options.publicKey) {
                const isConditional = options.mediation === 'conditional';
                const hasUserActivation = Boolean(navigator.userActivation && navigator.userActivation.isActive);
                if (isConditional || !hasUserActivation) {
                  return Promise.reject(new DOMException('Automatic WebAuthn prompt suppressed', 'NotAllowedError'));
                }
              }
              return origGet(options);
            };
          }
        } catch (_) {}
      })();`, true).catch(() => {});
    } catch (_) {}
  }

  function isEligibleInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.disabled || el.readOnly) return false;
    const t = (el.type || 'text').toLowerCase();
    if (!ELIGIBLE_TYPES.has(t)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 18) return false;
    return true;
  }

  function getHintText(el) {
    const parts = [
      el.autocomplete || '',
      el.name || '',
      el.id || '',
      el.placeholder || '',
      el.getAttribute('aria-label') || ''
    ];
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.textContent) parts.push(lbl.textContent);
      } catch (_) {}
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) parts.push(parentLabel.textContent);
    return parts.join(' ').toLowerCase();
  }

  function hasPasswordInputNearby(el) {
    if (el.form && el.form.querySelector('input[type="password"]')) return true;
    const container = el.closest('form, [role="dialog"], main, section') || document.body;
    if (!container) return false;
    const pw = container.querySelector('input[type="password"]');
    if (!pw) return false;
    const r = pw.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function classifyField(el) {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'password') return 'password';
    const ac = (el.autocomplete || '').toLowerCase();
    if (ac === 'one-time-code') return null;
    const hint = getHintText(el);
    if (/\b(code|otp|pin|kod|2fa|two.?factor|verif\w*|dogrula\w*|doğrula\w*|captcha|token)\b/i.test(hint)) {
      return null;
    }
    const hasPw = hasPasswordInputNearby(el);

    if (t === 'email' || /e-?mail|e-?posta|eposta/.test(hint)) return 'email';
    if (t === 'tel' || /phone|telefon|mobile|gsm/.test(hint)) return 'tel';
    if (/user|login|hesap|kullan|identifier|nick|account|signin|sign-in/.test(hint)) return 'username';
    if (/full.?name|ad.?soyad|isim|first.?name|last.?name/.test(hint) && !/search|ara/.test(hint)) return 'name';
    if (/address|adres|street|sokak|mahalle/.test(hint)) return 'address';
    if (/city|sehir|şehir/.test(hint)) return 'city';
    if (/zip|postal|posta.?kod/.test(hint)) return 'zip';
    if (hasPw && (t === 'text' || t === '')) return 'username';
    return null;
  }

  function requestPopupFor(el) {
    if (!isWebPage() || !isEligibleInput(el)) return;
    const fieldKind = classifyField(el);
    if (!fieldKind) return;

    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    lastFocusedEl = el;
    requestAnimationFrame(() => {
      if (document.activeElement !== el || !isEligibleInput(el)) return;
      const r = el.getBoundingClientRect();
      ipcRenderer.send('page-autofill:focus', {
        rect: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        },
        fieldKind,
        hasPasswordInForm: hasPasswordInputNearby(el),
        value: (el.value || '').trim().slice(0, 80)
      });
    });
  }

  function scheduleBlur() {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      const active = document.activeElement;
      if (!active || !isEligibleInput(active) || !classifyField(active)) {
        ipcRenderer.send('page-autofill:blur');
      }
    }, 180);
  }

  function attachListeners() {
    if (!isWebPage()) return;

    document.addEventListener('focusin', (e) => {
      if (isEligibleInput(e.target)) {
        requestPopupFor(e.target);
      }
    }, true);

    document.addEventListener('click', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('input') : e.target;
      if (isEligibleInput(target) && document.activeElement === target) {
        requestPopupFor(target);
      }
    }, true);

    document.addEventListener('input', (e) => {
      if (e.target === lastFocusedEl && isEligibleInput(e.target)) {
        const val = (e.target.value || '').trim();
        if (val.length >= 24) {
          ipcRenderer.send('page-autofill:blur');
        }
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ipcRenderer.send('page-autofill:blur');
      }
    }, true);

    document.addEventListener('focusout', () => {
      scheduleBlur();
    }, true);

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.deltaY !== 0) {
        e.preventDefault();
        ipcRenderer.send('tab:zoom-wheel', e.deltaY);
      }
    }, { passive: false, capture: true });

    window.addEventListener('scroll', (e) => {
      if (e.target === document || e.target === document.documentElement || e.target === document.body) {
        ipcRenderer.send('page-autofill:blur');
      }
    }, { capture: true, passive: true });
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', attachListeners, { once: true });
  } else {
    attachListeners();
  }
})();

