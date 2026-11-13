const ICONS = {
  globe: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  volumeOn: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  volumeOff: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
};

const state = {
  tabs: [],
  activeTabId: null,
  splitTabId: null,
  focusedPane: 'left',
  settings: {},
  bookmarks: [],
  history: [],
  downloads: [],
  metrics: { totalRamMB: 0, cpuPercent: 0, tabRamMB: {}, sleepingCount: 0 },
  adBlock: { enabled: true, sessionBlocked: 0, totalBlocked: 0, recentBlocked: [] },
  vpn: { enabled: false, status: 'disconnected', country: 'DE', latencyMs: 0, externalIp: '' },
  activePanel: null,
  contextTabId: null,
  lastCleanReport: '',
  historyFilter: ''
};

const els = {
  tabsContainer: document.getElementById('tabs-container'),
  btnNewTab: document.getElementById('btn-new-tab'),
  btnBack: document.getElementById('btn-back'),
  btnForward: document.getElementById('btn-forward'),
  btnReload: document.getElementById('btn-reload'),
  btnHome: document.getElementById('btn-home'),
  omniboxForm: document.getElementById('omnibox-form'),
  omniboxInput: document.getElementById('omnibox-input'),
  omniboxSecurity: document.getElementById('omnibox-security'),
  btnBookmark: document.getElementById('btn-bookmark'),
  bookmarksBar: document.getElementById('bookmarks-bar'),
  sideBtnVpn: document.getElementById('side-btn-vpn'),
  drawer: document.getElementById('drawer'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerBody: document.getElementById('drawer-body'),
  drawerClose: document.getElementById('drawer-close'),
  viewport: document.getElementById('viewport-placeholder'),
  contextMenu: document.getElementById('tab-context-menu')
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  const brandDark = document.querySelector('.logo-dark-theme');
  const brandLight = document.querySelector('.logo-light-theme');
  if (brandDark && brandLight) {
    brandDark.style.display = theme === 'light' ? 'none' : 'block';
    brandLight.style.display = theme === 'light' ? 'block' : 'none';
  }
  renderTabs();
  renderBookmarksBar();
}

function applyAnimations(enabled) {
  document.documentElement.setAttribute('data-animations', enabled === false ? 'off' : 'on');
}

function createPolyDropdown(options, currentValue, onSelect) {
  const wrap = document.createElement('div');
  wrap.className = 'poly-select';

  const activeOpt = options.find((o) => String(o.value) === String(currentValue)) || options[0];

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'poly-select-trigger';
  trigger.innerHTML = `
    <span>${escapeHtml(activeOpt.label)}</span>
    <svg class="poly-select-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  `;
  trigger.onclick = () => wrap.classList.toggle('open');

  const menu = document.createElement('div');
  menu.className = 'poly-select-menu';
  for (const opt of options) {
    const item = document.createElement('button');
    item.type = 'button';
    const isSel = String(opt.value) === String(currentValue);
    item.className = 'poly-select-option' + (isSel ? ' active' : '');
    item.innerHTML = `<span>${escapeHtml(opt.label)}</span>${isSel ? ICONS.check : ''}`;
    item.onclick = () => {
      wrap.classList.remove('open');
      onSelect(opt.value);
    };
    menu.appendChild(item);
  }

  wrap.append(trigger, menu);
  return wrap;
}

function applyAccentColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--accent', color);
  // Compute soft rgba
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`);
  }
}

function syncViewport() {
  const rect = els.viewport.getBoundingClientRect();
  window.polyAPI.setViewport({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });
}

function getFocusedTab() {
  const id =
    state.splitTabId && state.focusedPane === 'right' ? state.splitTabId : state.activeTabId;
  return state.tabs.find((t) => t.id === id) || null;
}

function renderTabs() {
  els.tabsContainer.innerHTML = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab-item';
    if (tab.id === state.activeTabId) el.classList.add('active');
    if (tab.id === state.splitTabId) el.classList.add('split-active');
    if (tab.isSleeping) el.classList.add('sleeping');

    // Icon / Spinner
    if (tab.isLoading) {
      const sp = document.createElement('div');
      sp.className = 'tab-spinner';
      el.appendChild(sp);
    } else {
      const fav = document.createElement('div');
      fav.className = 'tab-favicon';
      const isNewTab = !tab.url || tab.url === 'poly://newtab' || tab.url.includes('newtab.html');
      if (isNewTab) {
        const imgDark = document.createElement('img');
        imgDark.className = 'poly-tab-logo tab-logo-dark';
        imgDark.src = '../assets/icon.png';
        const imgLight = document.createElement('img');
        imgLight.className = 'poly-tab-logo tab-logo-light';
        imgLight.src = '../assets/icon-dark.png';
        fav.append(imgDark, imgLight);
      } else if (tab.favicon) {
        const img = document.createElement('img');
        img.src = tab.favicon;
        img.onerror = () => {
          fav.innerHTML = ICONS.globe;
        };
        fav.appendChild(img);
      } else {
        fav.innerHTML = ICONS.globe;
      }
      el.appendChild(fav);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'Yeni Sekme';
    el.appendChild(title);

    if (tab.isSleeping) {
      const zzz = document.createElement('span');
      zzz.className = 'tab-badge-sleep';
      zzz.title = 'Uyku Modunda (RAM Tasarrufu)';
      zzz.innerHTML = ICONS.moon;
      el.appendChild(zzz);
    }

    if (tab.isPlayingAudio || tab.audioMuted) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'tab-close';
      audioBtn.title = tab.audioMuted ? 'Sesi Aç' : 'Sesi Kapat';
      audioBtn.innerHTML = tab.audioMuted ? ICONS.volumeOff : ICONS.volumeOn;
      audioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.polyAPI.toggleMuteTab(tab.id);
      });
      el.appendChild(audioBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.title = 'Sekmeyi Kapat';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.polyAPI.closeTab(tab.id);
    });
    el.appendChild(closeBtn);

    el.addEventListener('click', () => window.polyAPI.activateTab(tab.id));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) window.polyAPI.closeTab(tab.id);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.polyAPI.showTabContextMenu(tab.id);
    });

    els.tabsContainer.appendChild(el);
  }

  const activeEl = els.tabsContainer.querySelector('.tab-item.active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

els.tabsContainer?.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    els.tabsContainer.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

let isEditingOmnibox = false;

function formatDisplayUrl(rawUrl) {
  if (!rawUrl || rawUrl === 'poly://newtab') return '';
  if (rawUrl.startsWith('poly://')) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return rawUrl;
    const host = u.hostname.replace(/^www\./i, '');
    const cleanParams = new URLSearchParams(u.search);
    for (const k of Array.from(cleanParams.keys())) {
      if (/^(__cf_chl_|utm_|fbclid|gclid)/i.test(k)) cleanParams.delete(k);
    }
    const cleanQuery = cleanParams.toString();
    const pathPart = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return host + pathPart + (cleanQuery ? `?${cleanQuery}` : '');
  } catch (_) {
    return rawUrl;
  }
}

function blurOmnibox() {
  isEditingOmnibox = false;
  if (els.omniboxInput) {
    els.omniboxInput.blur();
  }
  const tab = getFocusedTab();
  if (tab && els.omniboxInput) {
    els.omniboxInput.value = formatDisplayUrl(tab.url);
  }
}

if (window.polyAPI.onOmniboxBlur) {
  window.polyAPI.onOmniboxBlur(() => {
    blurOmnibox();
  });
}

if (window.polyAPI.onOmniboxFocus) {
  window.polyAPI.onOmniboxFocus(() => {
    if (els.omniboxInput) {
      els.omniboxInput.focus();
      els.omniboxInput.select();
    }
  });
}

function renderNavBar() {
  const tab = getFocusedTab();
  if (!tab) return;

  els.btnBack.disabled = !tab.canGoBack;
  els.btnForward.disabled = !tab.canGoForward;

  if (document.activeElement !== els.omniboxInput) {
    isEditingOmnibox = false;
  }

  if (!isEditingOmnibox) {
    els.omniboxInput.value = formatDisplayUrl(tab.url);
  }

  const isHttps = tab.url && tab.url.startsWith('https://');
  els.omniboxSecurity.classList.toggle('secure', isHttps);
  els.omniboxSecurity.innerHTML = isHttps
    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  const isBookmarked = state.bookmarks.some((b) => b.url === tab.url);
  els.btnBookmark.classList.toggle('bookmarked', isBookmarked);
  const keyBtn = document.getElementById('side-btn-autofill');
  if (keyBtn && !state.activePanel) {
    keyBtn.classList.toggle('active', tab.url === 'poly://passwords');
  }
  renderBookmarksBar();
}

function renderBookmarksBar() {
  if (!els.bookmarksBar) return;
  els.bookmarksBar.innerHTML = '';
  // Show bookmarks bar only if there is at least one bookmark added, otherwise hide it completely
  if (!state.bookmarks || state.bookmarks.length === 0) {
    els.bookmarksBar.classList.add('hidden');
    els.bookmarksBar.style.display = 'none';
    syncViewport();
    return;
  }
  els.bookmarksBar.classList.remove('hidden');
  els.bookmarksBar.style.display = 'flex';

  for (const bm of state.bookmarks) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bookmark-chip';
    chip.title = `${bm.title} (${bm.url})`;

    let host = '';
    try {
      host = new URL(bm.url).hostname;
    } catch (_) {}

    const img = document.createElement('img');
    img.src = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : '';
    img.onerror = () => {
      img.style.display = 'none';
    };
    chip.appendChild(img);

    const txt = document.createElement('span');
    txt.textContent = bm.title || host || bm.url;
    chip.appendChild(txt);

    chip.onclick = () => window.polyAPI.navigate(bm.url);
    chip.onauxclick = (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.polyAPI.createTab(bm.url);
      }
    };
    chip.oncontextmenu = (e) => {
      e.preventDefault();
      window.polyAPI.showBookmarkContextMenu(bm);
    };

    els.bookmarksBar.appendChild(chip);
  }

  // Chrome-style "Tüm Yer İşaretleri" button
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'bookmark-chip-all';
  allBtn.title = 'Tüm Yer İşaretlerini Göster';
  allBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
    <span>Tüm Yer İşaretleri</span>
  `;
  allBtn.onclick = () => openPanel('bookmarks');
  els.bookmarksBar.appendChild(allBtn);

  syncViewport();
}

function renderPills() {
  if (els.sideBtnVpn) {
    const v = state.vpn || {};
    els.sideBtnVpn.classList.remove('vpn-connected', 'vpn-connecting');
    if (v.status === 'connected') {
      els.sideBtnVpn.classList.add('vpn-connected');
    } else if (v.status === 'connecting') {
      els.sideBtnVpn.classList.add('vpn-connecting');
    }
  }
}

function openPanel(panelName) {
  if (panelName === 'downloads') {
    document.getElementById('side-btn-downloads')?.classList.remove('has-activity');
  }
  window.polyAPI.toggleFlyout(panelName);
}

function closePanel() {
  window.polyAPI.closeFlyout();
}

function renderDrawerContent() {
  if (!state.activePanel || !els.drawerBody) return;
  const body = els.drawerBody;
  body.innerHTML = '';

  if (state.activePanel === 'ram') {
    els.drawerTitle.textContent = 'Poly Control — RAM & Uyku';
    const limit = state.settings.ramLimitMB || 1500;
    const ram = state.metrics.totalRamMB || 0;
    const pct = Math.min(100, Math.round((ram / limit) * 100));

    const summaryCard = document.createElement('div');
    summaryCard.className = 'card';
    summaryCard.innerHTML = `
      <div class="card-title">Toplam Bellek Kullanımı</div>
      <div class="stat-big"><span id="lbl-ram-current">${ram} MB</span> <span class="stat-sub" id="lbl-ram-target">/ ${limit} MB limit</span></div>
      <div class="progress-track"><div class="progress-fill" id="ram-progress-fill" style="width:${pct}%"></div></div>
      <div class="stat-sub">CPU: %${state.metrics.cpuPercent || 0} • Uyuyan Sekme: ${state.metrics.sleepingCount || 0}</div>
    `;
    const cleanBtn = document.createElement('button');
    cleanBtn.className = 'btn-primary';
    cleanBtn.innerHTML = `${ICONS.moon} <span>Pasif Sekmeleri Uyut (RAM Temizle)</span>`;
    cleanBtn.onclick = async () => {
      cleanBtn.disabled = true;
      cleanBtn.textContent = 'Temizleniyor...';
      const res = await window.polyAPI.hibernateAllInactive();
      state.lastCleanReport = `${res.hibernatedCount} sekme uyutuldu • ${res.freedMB} MB RAM serbest bırakıldı`;
      renderDrawerContent();
    };
    summaryCard.appendChild(cleanBtn);
    if (state.lastCleanReport) {
      const report = document.createElement('div');
      report.className = 'stat-sub';
      report.style.color = 'var(--success)';
      report.style.display = 'flex';
      report.style.alignItems = 'center';
      report.style.gap = '6px';
      report.innerHTML = `${ICONS.check} <span>${escapeHtml(state.lastCleanReport)}</span>`;
      summaryCard.appendChild(report);
    }
    body.appendChild(summaryCard);

    // Interactive RAM Limiter Card (Custom Poly Switch & Slider)
    const rangePct = Math.round(((limit - 500) / (4000 - 500)) * 100);
    const limiterCard = document.createElement('div');
    limiterCard.className = 'card';
    limiterCard.innerHTML = `
      <div class="toggle-row">
        <span class="card-title">RAM Limitleyici</span>
        <label class="poly-switch">
          <input type="checkbox" id="ram-limiter-toggle" ${state.settings.autoHibernateOnLimit !== false ? 'checked' : ''} />
          <span class="poly-slider"></span>
        </label>
      </div>
      <div class="form-row">
        <label>Yumuşak Limit: <strong id="ram-ctrl-lbl">${limit} MB</strong></label>
        <input type="range" id="ram-ctrl-range" class="poly-range" style="--pct:${rangePct}%" min="500" max="4000" step="100" value="${limit}" />
      </div>
    `;
    body.appendChild(limiterCard);

    limiterCard.querySelector('#ram-limiter-toggle').onchange = async (e) => {
      state.settings = await window.polyAPI.updateSettings({ autoHibernateOnLimit: e.target.checked });
    };
    const ramCtrlRange = limiterCard.querySelector('#ram-ctrl-range');
    let saveLimitTimer = null;
    ramCtrlRange.oninput = () => {
      const val = Number(ramCtrlRange.value);
      const p = Math.round(((val - 500) / (4000 - 500)) * 100);
      ramCtrlRange.style.setProperty('--pct', `${p}%`);
      limiterCard.querySelector('#ram-ctrl-lbl').textContent = `${val} MB`;

      // Canlı: Üst karttaki limit yazısını ve ilerleme çubuğu yüzdesini anında güncelle
      const curRam = state.metrics.totalRamMB || 0;
      const curPct = Math.min(100, Math.round((curRam / val) * 100));
      const targetLbl = summaryCard.querySelector('#lbl-ram-target');
      if (targetLbl) targetLbl.textContent = `/ ${val} MB limit`;
      const fillEl = summaryCard.querySelector('#ram-progress-fill');
      if (fillEl) fillEl.style.width = `${curPct}%`;

      // Canlı: Üst nav bar RAM butonunun rengini güncelle
      state.settings.ramLimitMB = val;
      renderPills();

      // Arka plana anlık debounced kaydet
      clearTimeout(saveLimitTimer);
      saveLimitTimer = setTimeout(() => {
        window.polyAPI.updateSettings({ ramLimitMB: val });
      }, 150);
    };
    ramCtrlRange.onchange = () => {
      clearTimeout(saveLimitTimer);
      window.polyAPI.updateSettings({ ramLimitMB: Number(ramCtrlRange.value) });
    };

    const tabsTitle = document.createElement('div');
    tabsTitle.className = 'card-title';
    tabsTitle.textContent = 'Sekme Bazlı Bellek';
    body.appendChild(tabsTitle);

    for (const tab of state.tabs) {
      const item = document.createElement('div');
      item.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'list-item-info';
      info.innerHTML = `
        <div class="list-item-title">${escapeHtml(tab.title)}</div>
        <div class="list-item-sub">${tab.isSleeping ? 'Uyku Modunda (0 MB)' : `${tab.ramMB || 0} MB`}</div>
      `;
      item.appendChild(info);

      if (!tab.isSleeping && tab.id !== state.activeTabId && tab.id !== state.splitTabId) {
        const sleepBtn = document.createElement('button');
        sleepBtn.className = 'btn-secondary';
        sleepBtn.textContent = 'Uyut';
        sleepBtn.onclick = (e) => {
          e.stopPropagation();
          window.polyAPI.hibernateTab(tab.id);
        };
        item.appendChild(sleepBtn);
      }
      item.onclick = () => window.polyAPI.activateTab(tab.id);
      body.appendChild(item);
    }
  } else if (state.activePanel === 'adblock') {
    els.drawerTitle.textContent = 'Reklam & İzleyici Kalkanı';
    const tab = getFocusedTab();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="toggle-row">
        <span class="card-title">Koruma Durumu</span>
        <label class="poly-switch">
          <input type="checkbox" id="adblock-toggle-sw" ${state.adBlock.enabled ? 'checked' : ''} />
          <span class="poly-slider"></span>
        </label>
      </div>
      <div class="stat-big">${state.adBlock.sessionBlocked} <span class="stat-sub">bu oturumda engellendi</span></div>
      <div class="stat-sub">Toplam Engellenen: ${state.adBlock.totalBlocked}</div>
      <div class="stat-sub">Aktif Sekme: ${tab ? tab.blockedCount : 0} engelleme</div>
    `;
    card.querySelector('#adblock-toggle-sw').onchange = async (e) => {
      state.adBlock = await window.polyAPI.toggleAdBlock(e.target.checked);
      renderPills();
      renderDrawerContent();
    };
    body.appendChild(card);

    if (state.adBlock.recentBlocked && state.adBlock.recentBlocked.length > 0) {
      const recTitle = document.createElement('div');
      recTitle.className = 'card-title';
      recTitle.textContent = 'Son Engellenen Alan Adları';
      body.appendChild(recTitle);
      for (const host of state.adBlock.recentBlocked) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `<div class="list-item-sub" style="display:flex;align-items:center;gap:6px">${ICONS.shield} <span>${escapeHtml(host)}</span></div>`;
        body.appendChild(row);
      }
    }
  } else if (state.activePanel === 'bookmarks') {
    els.drawerTitle.textContent = 'Yer İmleri';
    if (state.bookmarks.length === 0) {
      body.innerHTML = '<div class="stat-sub">Henüz yer imi eklenmemiş.</div>';
    } else {
      for (const bm of state.bookmarks) {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(bm.title)}</div>
            <div class="list-item-sub">${escapeHtml(bm.url)}</div>
          </div>
        `;
        const del = document.createElement('button');
        del.className = 'btn-secondary';
        del.textContent = '✕';
        del.onclick = async (e) => {
          e.stopPropagation();
          state.bookmarks = await window.polyAPI.removeBookmark(bm.url);
          renderNavBar();
          renderDrawerContent();
        };
        item.appendChild(del);
        item.onclick = () => window.polyAPI.navigate(bm.url);
        body.appendChild(item);
      }
    }
  } else if (state.activePanel === 'history') {
    els.drawerTitle.textContent = 'Gezinti Geçmişi';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'poly-input';
    searchInput.placeholder = 'Geçmişte ara...';
    searchInput.value = state.historyFilter || '';
    body.appendChild(searchInput);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-secondary';
    clearBtn.innerHTML = `${ICONS.trash} <span>Geçmişi Temizle</span>`;
    clearBtn.onclick = async () => {
      state.history = await window.polyAPI.clearHistory();
      renderDrawerContent();
    };
    body.appendChild(clearBtn);

    const listWrap = document.createElement('div');
    listWrap.style.display = 'flex';
    listWrap.style.flexDirection = 'column';
    listWrap.style.gap = '8px';
    body.appendChild(listWrap);

    const renderHistoryItems = () => {
      listWrap.innerHTML = '';
      const q = (state.historyFilter || '').toLowerCase();
      const filtered = q
        ? state.history.filter(
            (h) =>
              (h.title || '').toLowerCase().includes(q) ||
              (h.url || '').toLowerCase().includes(q)
          )
        : state.history;

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'stat-sub';
        empty.textContent = q ? 'Eşleşen kayıt bulunamadı.' : 'Geçmiş boş.';
        listWrap.appendChild(empty);
        return;
      }

      for (const h of filtered.slice(0, 80)) {
        const item = document.createElement('div');
        item.className = 'list-item';
        const time = new Date(h.visitedAt).toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit'
        });
        item.innerHTML = `
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(h.title)}</div>
            <div class="list-item-sub">${time} • ${escapeHtml(h.url)}</div>
          </div>
        `;
        item.onclick = () => window.polyAPI.navigate(h.url);
        listWrap.appendChild(item);
      }
    };

    searchInput.oninput = () => {
      state.historyFilter = searchInput.value;
      renderHistoryItems();
    };
    renderHistoryItems();
  } else if (state.activePanel === 'downloads') {
    els.drawerTitle.textContent = 'İndirmeler';
    if (state.downloads.length > 0) {
      const clearDlBtn = document.createElement('button');
      clearDlBtn.className = 'btn-secondary';
      clearDlBtn.innerHTML = `${ICONS.trash} <span>Tamamlananları Temizle</span>`;
      clearDlBtn.onclick = async () => {
        state.downloads = await window.polyAPI.clearDownloads();
        renderDrawerContent();
      };
      body.appendChild(clearDlBtn);
    }

    if (state.downloads.length === 0) {
      body.innerHTML = '<div class="stat-sub">Henüz indirilen dosya yok.</div>';
    } else {
      for (const dl of state.downloads) {
        const card = document.createElement('div');
        card.className = 'card';
        const pct = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
        const rxMB = (dl.receivedBytes / (1024 * 1024)).toFixed(1);
        const totMB = dl.totalBytes > 0 ? ` / ${(dl.totalBytes / (1024 * 1024)).toFixed(1)} MB` : ' MB';
        const statusLabel =
          dl.state === 'completed'
            ? 'Tamamlandı'
            : dl.state === 'cancelled'
              ? 'İptal edildi'
              : dl.state === 'interrupted'
                ? 'Kesildi'
                : `%${pct}`;

        card.innerHTML = `
          <div class="list-item-title">${escapeHtml(dl.filename)}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${dl.state === 'completed' ? 100 : pct}%"></div></div>
          <div class="stat-sub">${statusLabel} • ${rxMB}${totMB}</div>
        `;
        if (dl.state === 'progressing') {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'btn-secondary';
          cancelBtn.textContent = 'İptal Et';
          cancelBtn.onclick = () => window.polyAPI.cancelDownload(dl.id);
          card.appendChild(cancelBtn);
        } else if (dl.state === 'completed' && dl.savePath) {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.gap = '6px';
          const openBtn = document.createElement('button');
          openBtn.className = 'btn-secondary';
          openBtn.textContent = 'Aç';
          openBtn.onclick = () => window.polyAPI.openDownload(dl.savePath);
          const folderBtn = document.createElement('button');
          folderBtn.className = 'btn-secondary';
          folderBtn.textContent = 'Klasörde Göster';
          folderBtn.onclick = () => window.polyAPI.showDownloadInFolder(dl.savePath);
          row.append(openBtn, folderBtn);
          card.appendChild(row);
        }
        body.appendChild(card);
      }
    }
  } else if (state.activePanel === 'settings') {
    els.drawerTitle.textContent = 'Tarayıcı Ayarları';

    // 1. Appearance & Personalization Card
    const lookCard = document.createElement('div');
    lookCard.className = 'card';
    lookCard.innerHTML = '<div class="card-title">Görünüm & Kişiselleştirme</div>';

    // Theme mode with circular Black & White dots on the left
    const themeRow = document.createElement('div');
    themeRow.className = 'form-row';
    themeRow.innerHTML = '<label>Görünüm Teması</label>';
    const themeGroup = document.createElement('div');
    themeGroup.className = 'poly-chip-group';
    [
      { val: 'dark', label: 'Koyu Mod', dot: 'theme-dot-dark' },
      { val: 'light', label: 'Açık Mod', dot: 'theme-dot-light' }
    ].forEach((t) => {
      const chip = document.createElement('button');
      chip.className =
        'poly-chip theme-chip' + ((state.settings.theme || 'dark') === t.val ? ' active' : '');
      chip.innerHTML = `<span class="theme-dot ${t.dot}"></span><span>${t.label}</span>`;
      chip.onclick = async () => {
        applyTheme(t.val);
        state.settings = await window.polyAPI.updateSettings({ theme: t.val });
        renderDrawerContent();
      };
      themeGroup.appendChild(chip);
    });
    themeRow.appendChild(themeGroup);
    lookCard.appendChild(themeRow);

    // Accent color
    const colorRow = document.createElement('div');
    colorRow.className = 'form-row';
    colorRow.innerHTML = '<label>Tema Vurgu Rengi</label>';
    const swatches = document.createElement('div');
    swatches.className = 'color-swatches';
    ['#7c5cff', '#ff2e54', '#00d2ff', '#10b981', '#f59e0b', '#ec4899'].forEach((hex) => {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = hex;
      if (state.settings.accentColor === hex) sw.classList.add('active');
      sw.onclick = async () => {
        applyAccentColor(hex);
        state.settings = await window.polyAPI.updateSettings({ accentColor: hex });
        renderDrawerContent();
      };
      swatches.appendChild(sw);
    });
    colorRow.appendChild(swatches);
    lookCard.appendChild(colorRow);

    // New Tab & UI toggles
    const addSwitchRow = (parent, label, checked, onChange) => {
      const row = document.createElement('div');
      row.className = 'toggle-row';
      row.innerHTML = `<span class="stat-sub" style="color:var(--text-primary)">${label}</span>`;
      const sw = document.createElement('label');
      sw.className = 'poly-switch';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = Boolean(checked);
      inp.onchange = () => onChange(inp.checked);
      const sl = document.createElement('span');
      sl.className = 'poly-slider';
      sw.append(inp, sl);
      row.appendChild(sw);
      parent.appendChild(row);
    };

    addSwitchRow(lookCard, 'Yeni Sekme Saati', state.settings.showClock !== false, async (v) => {
      state.settings = await window.polyAPI.updateSettings({ showClock: v });
    });
    addSwitchRow(lookCard, 'Hızlı Erişim Kartları', state.settings.showSpeedDial !== false, async (v) => {
      state.settings = await window.polyAPI.updateSettings({ showSpeedDial: v });
    });
    addSwitchRow(lookCard, 'Arayüz Animasyonları', state.settings.animationsEnabled !== false, async (v) => {
      applyAnimations(v);
      state.settings = await window.polyAPI.updateSettings({ animationsEnabled: v });
    });

    body.appendChild(lookCard);

    // 2. Search & Performance Card (Category Dropdowns)
    const perfCard = document.createElement('div');
    perfCard.className = 'card';
    perfCard.innerHTML = '<div class="card-title">Arama & Performans</div>';

    const seRow = document.createElement('div');
    seRow.className = 'form-row';
    seRow.innerHTML = '<label>Arama Motoru</label>';
    seRow.appendChild(
      createPolyDropdown(
        [
          { value: 'google', label: 'Google' },
          { value: 'duckduckgo', label: 'DuckDuckGo (Gizlilik)' },
          { value: 'bing', label: 'Microsoft Bing' },
          { value: 'yandex', label: 'Yandex' },
          { value: 'brave', label: 'Brave Search' }
        ],
        state.settings.searchEngine || 'google',
        async (val) => {
          state.settings = await window.polyAPI.updateSettings({ searchEngine: val });
          renderDrawerContent();
        }
      )
    );
    perfCard.appendChild(seRow);

    const hibRow = document.createElement('div');
    hibRow.className = 'form-row';
    hibRow.innerHTML = '<label>Sekme Uyku Süresi (RAM Tasarrufu)</label>';
    hibRow.appendChild(
      createPolyDropdown(
        [
          { value: 1, label: '1 Dakika (Agresif Tasarruf)' },
          { value: 3, label: '3 Dakika' },
          { value: 5, label: '5 Dakika (Önerilen)' },
          { value: 15, label: '15 Dakika' },
          { value: 0, label: 'Kapalı' }
        ],
        state.settings.hibernationMinutes ?? 5,
        async (val) => {
          state.settings = await window.polyAPI.updateSettings({ hibernationMinutes: Number(val) });
          renderDrawerContent();
        }
      )
    );
    perfCard.appendChild(hibRow);

    const curRam = state.settings.ramLimitMB || 1500;
    const ramPct = Math.round(((curRam - 500) / (4000 - 500)) * 100);
    const ramRow = document.createElement('div');
    ramRow.className = 'form-row';
    ramRow.innerHTML = `<label>RAM Limiti (Otomatik Uyutma): <strong id="lbl-ram">${curRam} MB</strong></label>`;
    const ramRange = document.createElement('input');
    ramRange.type = 'range';
    ramRange.className = 'poly-range';
    ramRange.style.setProperty('--pct', `${ramPct}%`);
    ramRange.min = 500;
    ramRange.max = 4000;
    ramRange.step = 100;
    ramRange.value = curRam;
    ramRange.oninput = () => {
      const v = Number(ramRange.value);
      const p = Math.round(((v - 500) / (4000 - 500)) * 100);
      ramRange.style.setProperty('--pct', `${p}%`);
      document.getElementById('lbl-ram').textContent = `${v} MB`;
    };
    ramRange.onchange = async () => {
      state.settings = await window.polyAPI.updateSettings({ ramLimitMB: Number(ramRange.value) });
      renderPills();
    };
    ramRow.appendChild(ramRange);
    perfCard.appendChild(ramRow);

    body.appendChild(perfCard);

    // 3. Privacy Card
    const privCard = document.createElement('div');
    privCard.className = 'card';
    privCard.innerHTML = '<div class="card-title">Gizlilik & Güvenlik</div>';

    addSwitchRow(privCard, 'Reklam & İzleyici Kalkanı', state.adBlock.enabled, async (v) => {
      state.adBlock = await window.polyAPI.toggleAdBlock(v);
      renderPills();
    });
    addSwitchRow(privCard, 'Çıkışta Geçmişi Temizle', Boolean(state.settings.clearHistoryOnExit), async (v) => {
      state.settings = await window.polyAPI.updateSettings({ clearHistoryOnExit: v });
    });

    body.appendChild(privCard);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Event Listeners
document.getElementById('win-min').onclick = () => window.polyAPI.minimizeWindow();
document.getElementById('win-max').onclick = () => window.polyAPI.maximizeWindow();
document.getElementById('win-close').onclick = () => window.polyAPI.closeWindow();

els.btnNewTab.onclick = () => window.polyAPI.createTab();
els.btnBack.onclick = () => window.polyAPI.goBack();
els.btnForward.onclick = () => window.polyAPI.goForward();
els.btnReload.onclick = () => {
  const tab = getFocusedTab();
  if (tab?.isLoading) window.polyAPI.stop();
  else window.polyAPI.reload();
};
els.btnHome.onclick = () => window.polyAPI.goHome();
if (els.drawerClose) els.drawerClose.onclick = closePanel;

function getOmniboxRect() {
  if (!els.omniboxForm) return { x: 180, y: 40, width: 600, height: 32 };
  const r = els.omniboxForm.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height)
  };
}

els.omniboxForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (suggestDebounce) {
    clearTimeout(suggestDebounce);
    suggestDebounce = null;
  }
  const val = els.omniboxInput.value;
  isEditingOmnibox = false;
  window.polyAPI.closeSuggestions();
  window.polyAPI.navigate(val);
  els.omniboxInput.blur();
});

let lastSuggestOpenAt = 0;
function openOmniboxSuggestions(force = false) {
  const now = Date.now();
  if (!force && now - lastSuggestOpenAt < 120) return;
  lastSuggestOpenAt = now;
  const rawVal = els.omniboxInput.value || '';
  const tab = getFocusedTab();
  const isShowingCurrentShort = Boolean(!isEditingOmnibox && tab && rawVal === formatDisplayUrl(tab.url));
  const initialQuery = (isShowingCurrentShort || (!isEditingOmnibox && /^https?:\/\//i.test(rawVal))) ? '' : rawVal;
  window.polyAPI.openSuggestions({
    rect: getOmniboxRect(),
    query: initialQuery
  });
}

els.omniboxInput.addEventListener('focus', () => {
  els.omniboxInput.select();
  openOmniboxSuggestions(true);
});

els.omniboxInput.addEventListener('click', () => {
  openOmniboxSuggestions(false);
});

els.omniboxInput.addEventListener('dblclick', () => {
  const tab = getFocusedTab();
  if (tab && tab.url && tab.url !== 'poly://newtab') {
    els.omniboxInput.value = tab.url;
    els.omniboxInput.select();
  }
});

let suggestDebounce = null;
let omniboxSkipInline = false;
els.omniboxInput.addEventListener('input', (e) => {
  isEditingOmnibox = true;
  const it = e && e.inputType ? e.inputType : '';
  omniboxSkipInline = it.startsWith('delete');
  if (suggestDebounce) clearTimeout(suggestDebounce);
  suggestDebounce = setTimeout(() => {
    suggestDebounce = null;
    if (!isEditingOmnibox || document.activeElement !== els.omniboxInput) return;
    window.polyAPI.querySuggestions(els.omniboxInput.value);
  }, 90);
});

if (window.polyAPI.onOmniboxInlineComplete) {
  window.polyAPI.onOmniboxInlineComplete((payload) => {
    if (!payload || !payload.completion || !payload.query) return;
    if (omniboxSkipInline || !isEditingOmnibox || document.activeElement !== els.omniboxInput) return;
    const cur = els.omniboxInput.value || '';
    if (cur.toLowerCase() !== String(payload.query).toLowerCase()) return;
    if (els.omniboxInput.selectionStart !== cur.length || els.omniboxInput.selectionEnd !== cur.length) return;
    const completed = cur + String(payload.completion).slice(cur.length);
    if (completed.length > cur.length) {
      els.omniboxInput.value = completed;
      els.omniboxInput.setSelectionRange(cur.length, completed.length);
    }
  });
}

els.omniboxInput.addEventListener('blur', () => {
  isEditingOmnibox = false;
  if (suggestDebounce) {
    clearTimeout(suggestDebounce);
    suggestDebounce = null;
  }
  setTimeout(() => {
    if (document.activeElement !== els.omniboxInput) {
      window.polyAPI.closeSuggestions();
      const tab = getFocusedTab();
      if (tab) {
        els.omniboxInput.value = formatDisplayUrl(tab.url);
      }
    }
  }, 220);
});

els.omniboxInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (suggestDebounce) {
      clearTimeout(suggestDebounce);
      suggestDebounce = null;
    }
    window.polyAPI.closeSuggestions();
    blurOmnibox();
  }
});

els.btnBookmark.onclick = async () => {
  const tab = getFocusedTab();
  if (!tab || tab.url === 'poly://newtab') return;
  state.bookmarks = await window.polyAPI.toggleBookmark({ title: tab.title, url: tab.url });
  renderNavBar();
  if (state.activePanel === 'bookmarks') renderDrawerContent();
};

if (els.omniboxSecurity) {
  els.omniboxSecurity.addEventListener('click', (e) => {
    e.stopPropagation();
    const tab = getFocusedTab();
    if (!tab) return;
    const rect = els.omniboxSecurity.getBoundingClientRect();
    window.polyAPI.openSiteInfo({
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      tab: {
        url: tab.url,
        title: tab.title
      }
    });
  });
}

function triggerSideBtnAnim(btn) {
  if (!btn) return;
  if (btn._animTimer) {
    clearTimeout(btn._animTimer);
    btn._animTimer = null;
  }
  btn.classList.remove('animating');
  void btn.offsetWidth; // restart CSS animation cleanly
  btn.classList.add('animating');
  btn._animTimer = setTimeout(() => {
    btn.classList.remove('animating');
    btn._animTimer = null;
  }, 600);
}

document.querySelectorAll('.side-btn').forEach((btn) => {
  btn.addEventListener('mouseenter', () => {
    triggerSideBtnAnim(btn);
  });
  btn.addEventListener('click', () => {
    triggerSideBtnAnim(btn);
    openPanel(btn.dataset.panel);
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 't') {
    e.preventDefault();
    window.polyAPI.createTab();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    const tab = getFocusedTab();
    if (tab) window.polyAPI.closeTab(tab.id);
  } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    els.omniboxInput.focus();
  } else if ((e.ctrlKey && e.key.toLowerCase() === 'r') || e.key === 'F5') {
    e.preventDefault();
    window.polyAPI.reload();
  }
});

// IPC Listeners
window.polyAPI.onTabsUpdated((data) => {
  const prevTab = getFocusedTab();
  state.tabs = data.tabs;
  state.activeTabId = data.activeTabId;
  state.splitTabId = data.splitTabId;
  state.focusedPane = data.focusedPane;
  const currentTab = getFocusedTab();
  if (currentTab && (!prevTab || prevTab.id !== currentTab.id || prevTab.url !== currentTab.url)) {
    isEditingOmnibox = false;
  }
  renderTabs();
  renderNavBar();
  if (state.activePanel === 'ram' || state.activePanel === 'adblock') {
    renderDrawerContent();
  }
});

window.polyAPI.onMetricsUpdated((metrics) => {
  state.metrics = metrics;
  renderPills();
  if (state.activePanel === 'ram') {
    const active = document.activeElement;
    if (!active || active.id !== 'ram-ctrl-range') {
      renderDrawerContent();
    }
  }
});

window.polyAPI.onAdBlockUpdated((adBlock) => {
  state.adBlock = adBlock;
  renderPills();
  if (state.activePanel === 'adblock') renderDrawerContent();
});

const knownDownloadIds = new Set();
let downloadsInitialized = false;

function playDownloadFlyAnimation(dlBtn) {
  if (!dlBtn) return;
  const targetRect = dlBtn.getBoundingClientRect();
  const omniRect = els.omniboxForm ? els.omniboxForm.getBoundingClientRect() : { left: window.innerWidth * 0.45, top: 44, width: 120, height: 32 };
  const startX = omniRect.left + omniRect.width * 0.5;
  const startY = omniRect.top + omniRect.height * 0.5;
  const endX = targetRect.left + targetRect.width * 0.5;
  const endY = targetRect.top + targetRect.height * 0.5;

  const bubble = document.createElement('div');
  bubble.className = 'dl-fly-bubble';
  bubble.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  bubble.style.left = `${startX}px`;
  bubble.style.top = `${startY}px`;
  document.body.appendChild(bubble);

  bubble.animate([
    { transform: 'translate(-50%, -50%) scale(1.35)', opacity: 0.95 },
    { transform: `translate(${(endX - startX) * 0.45 - 50}px, ${Math.min(endY - startY, 40) - 20}px) scale(1.15)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${endX - startX}px, ${endY - startY}px) translate(-50%, -50%) scale(0.75)`, opacity: 0.25 }
  ], {
    duration: 520,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards'
  }).onfinish = () => {
    bubble.remove();
    dlBtn.classList.remove('dl-burst');
    void dlBtn.offsetWidth;
    dlBtn.classList.add('dl-burst');
    triggerSideBtnAnim(dlBtn);
    setTimeout(() => dlBtn.classList.remove('dl-burst'), 700);
  };
}

window.polyAPI.onDownloadsUpdated((downloads) => {
  const prevMap = new Map((state.downloads || []).map((d) => [d.id, d.state]));
  state.downloads = downloads;

  const dlBtn = document.getElementById('side-btn-downloads');
  const hasProgressing = downloads.some((d) => d.state === 'progressing');
  let startedNew = false;
  let justCompleted = false;

  for (const dl of downloads) {
    if (!knownDownloadIds.has(dl.id)) {
      knownDownloadIds.add(dl.id);
      if (downloadsInitialized && dl.state === 'progressing') {
        startedNew = true;
      }
    } else if (prevMap.get(dl.id) === 'progressing' && dl.state === 'completed') {
      justCompleted = true;
    }
  }
  downloadsInitialized = true;

  if (dlBtn) {
    dlBtn.classList.toggle('downloading', hasProgressing);
    if (startedNew) {
      dlBtn.classList.add('has-activity');
      playDownloadFlyAnimation(dlBtn);
    } else if (justCompleted) {
      dlBtn.classList.add('has-activity', 'dl-complete');
      setTimeout(() => dlBtn.classList.remove('dl-complete'), 900);
    } else if (downloads.length > 0 && state.activePanel !== 'downloads' && hasProgressing) {
      dlBtn.classList.add('has-activity');
    }
  }

  if (state.activePanel === 'downloads') {
    renderDrawerContent();
  }
});

// Viewport resize observer
const ro = new ResizeObserver(() => syncViewport());
ro.observe(els.viewport);

window.polyAPI.onFlyoutOpened((panel) => {
  state.activePanel = panel;
  document.querySelectorAll('.side-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
});

window.polyAPI.onFlyoutClosed(() => {
  state.activePanel = null;
  document.querySelectorAll('.side-btn').forEach((btn) => btn.classList.remove('active'));
});

window.polyAPI.onThemeChanged((theme) => {
  state.settings.theme = theme;
  applyTheme(theme);
  if (state.activePanel === 'settings') {
    renderDrawerContent();
  }
});

if (window.polyAPI.onAccentChanged) {
  window.polyAPI.onAccentChanged((color) => {
    state.settings.accentColor = color;
    applyAccentColor(color);
  });
}

window.polyAPI.onBookmarksUpdated((bms) => {
  state.bookmarks = bms;
  renderBookmarksBar();
  renderNavBar();
});

if (window.polyAPI.onVpnUpdated) {
  window.polyAPI.onVpnUpdated((vpnState) => {
    if (vpnState) {
      state.vpn = vpnState;
      renderPills();
    }
  });
}

// Initial load
(async function init() {
  const initial = await window.polyAPI.getInitialState();
  state.settings = initial.settings || {};
  state.bookmarks = initial.bookmarks || [];
  state.history = initial.history || [];
  state.downloads = initial.downloads || [];
  for (const dl of state.downloads) knownDownloadIds.add(dl.id);
  downloadsInitialized = true;
  state.adBlock = initial.adBlock || state.adBlock;
  state.vpn = initial.vpn || state.vpn;
  state.metrics = initial.metrics || state.metrics;

  if (initial.tabsState) {
    state.tabs = initial.tabsState.tabs;
    state.activeTabId = initial.tabsState.activeTabId;
    state.splitTabId = initial.tabsState.splitTabId;
    state.focusedPane = initial.tabsState.focusedPane;
  }

  applyTheme(state.settings.theme);
  applyAnimations(state.settings.animationsEnabled);
  applyAccentColor(state.settings.accentColor);
  renderTabs();
  renderNavBar();
  renderBookmarksBar();
  renderPills();
  syncViewport();
})();

