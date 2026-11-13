const ICONS = {
  globe: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
};

let state = {
  activePanel: null,
  settings: {},
  bookmarks: [],
  history: [],
  downloads: [],
  metrics: { totalRamMB: 0, cpuPercent: 0, tabRamMB: {}, sleepingCount: 0 },
  adBlock: { enabled: true, sessionBlocked: 0, totalBlocked: 0, recentBlocked: [] },
  vpn: { enabled: false, status: 'disconnected', country: 'DE', serverIp: '', protocol: '', latencyMs: 0, externalIp: '', errorMessage: '' },
  tabs: [],
  lastCleanReport: '',
  historyFilter: '',
  detectedBrowsers: null,
  importOptions: { passwords: true, bookmarks: true, history: true },
  importFeedback: ''
};

const els = {
  drawer: document.getElementById('drawer'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerBody: document.getElementById('drawer-body'),
  drawerClose: document.getElementById('drawer-close')
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

function applyAccentColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--accent', color);
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function renderContent() {
  const panel = state.activePanel;
  const body = els.drawerBody;
  body.innerHTML = '';
  if (!panel) return;

  if (panel === 'ram') {
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
      renderContent();
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

    // Interactive RAM Limiter Card
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

      const curRam = state.metrics.totalRamMB || 0;
      const curPct = Math.min(100, Math.round((curRam / val) * 100));
      const targetLbl = summaryCard.querySelector('#lbl-ram-target');
      if (targetLbl) targetLbl.textContent = `/ ${val} MB limit`;
      const fillEl = summaryCard.querySelector('#ram-progress-fill');
      if (fillEl) fillEl.style.width = `${curPct}%`;

      state.settings.ramLimitMB = val;
      clearTimeout(saveLimitTimer);
      saveLimitTimer = setTimeout(() => {
        window.polyAPI.updateSettings({ ramLimitMB: val });
      }, 150);
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
      item.onclick = () => {
        window.polyAPI.activateTab(tab.id);
        window.polyAPI.closeFlyout();
      };
      body.appendChild(item);
    }
  } else if (panel === 'adblock') {
    els.drawerTitle.textContent = 'Reklam & İzleyici Kalkanı';
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
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
      <div class="stat-big" id="adblock-session-stat">${state.adBlock.sessionBlocked} <span class="stat-sub">bu oturumda engellendi</span></div>
      <div class="stat-sub" id="adblock-total-stat">Toplam Engellenen: ${state.adBlock.totalBlocked}</div>
      <div class="stat-sub" id="adblock-tab-stat">Aktif Sekme: ${activeTab ? activeTab.blockedCount : 0} engelleme</div>
    `;
    card.querySelector('#adblock-toggle-sw').onchange = async (e) => {
      state.adBlock = await window.polyAPI.toggleAdBlock(e.target.checked);
    };
    body.appendChild(card);

    const recentWrap = document.createElement('div');
    recentWrap.id = 'adblock-recent-wrap';
    recentWrap.style.display = 'flex';
    recentWrap.style.flexDirection = 'column';
    recentWrap.style.gap = '8px';
    if (state.adBlock.recentBlocked && state.adBlock.recentBlocked.length > 0) {
      const recTitle = document.createElement('div');
      recTitle.className = 'card-title';
      recTitle.textContent = 'Son Engellenen Alan Adları';
      recentWrap.appendChild(recTitle);
      for (const host of state.adBlock.recentBlocked) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `<div class="list-item-sub" style="display:flex;align-items:center;gap:6px">${ICONS.shield} <span>${escapeHtml(host)}</span></div>`;
        recentWrap.appendChild(row);
      }
    }
    body.appendChild(recentWrap);
  } else if (panel === 'bookmarks') {
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
          renderContent();
        };
        item.appendChild(del);
        item.onclick = () => {
          window.polyAPI.navigate(bm.url);
          window.polyAPI.closeFlyout();
        };
        body.appendChild(item);
      }
    }
  } else if (panel === 'history') {
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
    clearBtn.onclick = () => {
      openClearHistoryModal();
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
        item.onclick = () => {
          window.polyAPI.navigate(h.url);
          window.polyAPI.closeFlyout();
        };
        listWrap.appendChild(item);
      }
    };

    searchInput.oninput = () => {
      state.historyFilter = searchInput.value;
      renderHistoryItems();
    };
    renderHistoryItems();
  } else if (panel === 'downloads') {
    els.drawerTitle.textContent = 'İndirmeler';
    if (state.downloads.length > 0) {
      const clearDlBtn = document.createElement('button');
      clearDlBtn.className = 'btn-secondary';
      clearDlBtn.innerHTML = `${ICONS.trash} <span>Tamamlananları Temizle</span>`;
      clearDlBtn.onclick = async () => {
        state.downloads = await window.polyAPI.clearDownloads();
        renderContent();
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
  } else if (panel === 'settings') {
    els.drawerTitle.textContent = 'Tarayıcı Ayarları';

    // Appearance
    const lookCard = document.createElement('div');
    lookCard.className = 'card';
    lookCard.innerHTML = '<div class="card-title">Görünüm & Kişiselleştirme</div>';

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
        renderContent();
      };
      themeGroup.appendChild(chip);
    });
    themeRow.appendChild(themeGroup);
    lookCard.appendChild(themeRow);

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
        renderContent();
      };
      swatches.appendChild(sw);
    });
    colorRow.appendChild(swatches);
    lookCard.appendChild(colorRow);

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
    body.appendChild(lookCard);

    // Search & Performance
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
          renderContent();
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
          renderContent();
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
    };
    ramRow.appendChild(ramRange);
    perfCard.appendChild(ramRow);
    body.appendChild(perfCard);

    // Privacy
    const privCard = document.createElement('div');
    privCard.className = 'card';
    privCard.innerHTML = '<div class="card-title">Gizlilik & Güvenlik</div>';

    addSwitchRow(privCard, 'Reklam & İzleyici Kalkanı', state.adBlock.enabled, async (v) => {
      state.adBlock = await window.polyAPI.toggleAdBlock(v);
    });
    addSwitchRow(privCard, 'Tehlikeli Site & SSL Koruması', state.settings.safeBrowsingEnabled !== false, async (v) => {
      state.settings = await window.polyAPI.updateSettings({ safeBrowsingEnabled: v });
    });
    addSwitchRow(privCard, 'Otomatik Doldurma (Şifre & Form)', state.settings.autofillEnabled !== false, async (v) => {
      state.settings = await window.polyAPI.updateSettings({ autofillEnabled: v });
    });
    addSwitchRow(privCard, 'Çıkışta Geçmişi Temizle', Boolean(state.settings.clearHistoryOnExit), async (v) => {
      state.settings = await window.polyAPI.updateSettings({ clearHistoryOnExit: v });
    });
    body.appendChild(privCard);

    // Version & Auto-Update
    const updCard = document.createElement('div');
    updCard.className = 'card';
    const upd = state.updater || { status: 'idle', currentVersion: '1.0.0', progress: 0 };
    let updText = `Mevcut Sürüm: v${upd.currentVersion || '1.0.0'}`;
    let btnLabel = 'Güncellemeleri Denetle';
    let btnDisabled = false;
    let isInstallReady = false;
    if (upd.status === 'not-configured') {
      updText += ' • GitHub deposu ayarlanmadı (package.json → polyUpdater)';
    } else if (upd.status === 'checking') {
      updText += ' • Güncellemeler denetleniyor...';
      btnLabel = 'Denetleniyor...';
      btnDisabled = true;
    } else if (upd.status === 'downloading') {
      updText += ` • v${upd.latestVersion} indiriliyor (%${upd.progress || 0})`;
      btnLabel = `İndiriliyor %${upd.progress || 0}`;
      btnDisabled = true;
    } else if (upd.status === 'downloaded') {
      updText += ` • Yeni sürüm hazır: v${upd.latestVersion}`;
      btnLabel = `Güncelle ve Yeniden Başlat (v${upd.latestVersion})`;
      isInstallReady = true;
    } else if (upd.status === 'up-to-date') {
      updText += ' • Tarayıcınız güncel';
    } else if (upd.status === 'error') {
      updText += ` • Hata: ${upd.error || 'Kontrol edilemedi'}`;
    }
    updCard.innerHTML = `
      <div class="card-title">Sürüm & Otomatik Güncelleme</div>
      <div class="stat-sub" style="margin-bottom:8px;">${updText}</div>
    `;
    const updBtn = document.createElement('button');
    updBtn.type = 'button';
    updBtn.className = isInstallReady ? 'btn-primary' : 'btn-secondary';
    updBtn.style.width = '100%';
    updBtn.disabled = btnDisabled;
    updBtn.textContent = btnLabel;
    updBtn.onclick = async () => {
      if (isInstallReady) {
        await window.polyAPI.installUpdate();
      } else {
        state.updater = await window.polyAPI.checkUpdates();
        renderContent();
      }
    };
    updCard.appendChild(updBtn);
    body.appendChild(updCard);

    // Import & Export Browser Data (moved to Settings)
    const impCard = document.createElement('div');
    impCard.className = 'card';
    const tickSvg = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.2 8.4 6.6 11.8 12.8 4.4"/></svg>';
    impCard.innerHTML = `
      <div class="card-title">Tarayıcı Verilerini İçe / Dışa Aktar</div>
      <div class="stat-sub">Diğer tarayıcılardaki şifre, yer imi ve tarama geçmişinizi Poly Tarayıcı'ya geçirin veya yedeğinizi dışa aktarın.</div>
      <div class="imp-checks">
        <label class="imp-check-pill ${state.importOptions.passwords ? 'checked' : ''}">
          <input type="checkbox" id="imp-chk-pw" ${state.importOptions.passwords ? 'checked' : ''} />
          <span class="imp-check-box">${tickSvg}</span>
          <span>Şifreler</span>
        </label>
        <label class="imp-check-pill ${state.importOptions.bookmarks ? 'checked' : ''}">
          <input type="checkbox" id="imp-chk-bm" ${state.importOptions.bookmarks ? 'checked' : ''} />
          <span class="imp-check-box">${tickSvg}</span>
          <span>Yer İmleri</span>
        </label>
        <label class="imp-check-pill ${state.importOptions.history ? 'checked' : ''}">
          <input type="checkbox" id="imp-chk-hist" ${state.importOptions.history ? 'checked' : ''} />
          <span class="imp-check-box">${tickSvg}</span>
          <span>Geçmiş</span>
        </label>
      </div>
    `;
    const bindCheckPill = (sel, key) => {
      const inp = impCard.querySelector(sel);
      inp.onchange = (e) => {
        state.importOptions[key] = e.target.checked;
        inp.closest('.imp-check-pill')?.classList.toggle('checked', e.target.checked);
      };
    };
    bindCheckPill('#imp-chk-pw', 'passwords');
    bindCheckPill('#imp-chk-bm', 'bookmarks');
    bindCheckPill('#imp-chk-hist', 'history');

    if (state.importFeedback) {
      const fb = document.createElement('div');
      fb.className = state.importFeedback.includes('v20') ? 'af-msg warn' : 'af-msg';
      fb.textContent = state.importFeedback;
      impCard.appendChild(fb);
    }

    const browsersWrap = document.createElement('div');
    browsersWrap.style.display = 'flex';
    browsersWrap.style.flexDirection = 'column';
    browsersWrap.style.gap = '7px';

    const renderBrowsers = (browsers) => {
      browsersWrap.innerHTML = '';
      for (const b of browsers) {
        const row = document.createElement('div');
        row.className = 'imp-browser-row';
        const caps = [];
        if (b.hasPasswords) caps.push('Şifre');
        if (b.hasBookmarks) caps.push('Yer İmi');
        if (b.hasHistory) caps.push('Geçmiş');
        row.innerHTML = `
          <div style="min-width:0">
            <div class="pw-host">${escapeHtml(b.name)}</div>
            <div class="pw-sub">${b.available ? (caps.join(' • ') || 'Profil bulundu') : 'Bilgisayarda bulunamadı'}</div>
          </div>
        `;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b.available ? 'pw-mini-btn accent' : 'pw-mini-btn';
        btn.disabled = !b.available;
        btn.textContent = b.available ? 'İçe Aktar' : 'Yok';
        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = 'Aktarılıyor...';
          const res = await window.polyAPI.importRunBrowser(b.id, state.importOptions);
          if (res && res.ok) {
            let msg = `${res.browserName}: ${res.passwordsAdded} şifre, ${res.bookmarksAdded} yer imi, ${res.historyAdded} geçmiş aktarıldı.`;
            if (res.v20Skipped > 0) {
              msg += ` (${res.v20Skipped} şifre Chrome/Edge v20 koruması nedeniyle doğrudan okunamadı — tarayıcınızdan "Şifreleri dışa aktar .csv" ile aşağıdan yükleyebilirsiniz.)`;
            }
            state.importFeedback = msg;
          } else {
            state.importFeedback = (res && res.error) || 'İçe aktarma başarısız oldu.';
          }
          renderContent();
        };
        row.appendChild(btn);
        browsersWrap.appendChild(row);
      }
    };

    if (state.detectedBrowsers) {
      renderBrowsers(state.detectedBrowsers);
    } else {
      browsersWrap.innerHTML = '<div class="stat-sub">Yüklü tarayıcılar taranıyor...</div>';
      window.polyAPI.importDetectBrowsers().then((list) => {
        state.detectedBrowsers = list || [];
        if (state.activePanel === 'settings') renderBrowsers(state.detectedBrowsers);
      });
    }
    impCard.appendChild(browsersWrap);

    const fileActions = document.createElement('div');
    fileActions.style.display = 'grid';
    fileActions.style.gridTemplateColumns = '1fr 1fr';
    fileActions.style.gap = '7px';
    fileActions.style.marginTop = '4px';
    fileActions.innerHTML = `
      <button type="button" class="btn-secondary" id="set-imp-csv" style="font-size:11.5px;padding:8px;">Şifre İçe Aktar (.csv)</button>
      <button type="button" class="btn-secondary" id="set-exp-csv" style="font-size:11.5px;padding:8px;">Şifre Dışa Aktar (.csv)</button>
      <button type="button" class="btn-secondary" id="set-imp-html" style="font-size:11.5px;padding:8px;">Yer İmi İçe Aktar (.html)</button>
      <button type="button" class="btn-secondary" id="set-exp-html" style="font-size:11.5px;padding:8px;">Yer İmi Dışa Aktar (.html)</button>
    `;
    fileActions.querySelector('#set-imp-csv').onclick = async () => {
      const res = await window.polyAPI.importPickCsv();
      if (!res || res.canceled) return;
      state.importFeedback = res.ok
        ? `CSV'den ${res.added} yeni şifre eklendi, ${res.updated} güncellendi.`
        : (res.error || 'CSV içe aktarılamadı.');
      renderContent();
    };
    fileActions.querySelector('#set-exp-csv').onclick = async () => {
      const res = await window.polyAPI.importExportPasswordsCsv();
      if (!res || res.canceled) return;
      state.importFeedback = res.ok
        ? `${res.count} şifre CSV dosyasına dışa aktarıldı.`
        : 'Şifreler dışa aktarılamadı.';
      renderContent();
    };
    fileActions.querySelector('#set-imp-html').onclick = async () => {
      const res = await window.polyAPI.importPickHtml();
      if (!res || res.canceled) return;
      state.importFeedback = res.ok
        ? `HTML dosyasından ${res.added} yer imi içe aktarıldı.`
        : (res.error || 'HTML içe aktarılamadı.');
      renderContent();
    };
    fileActions.querySelector('#set-exp-html').onclick = async () => {
      const res = await window.polyAPI.importExportBookmarksHtml();
      if (!res || res.canceled) return;
      state.importFeedback = res.ok
        ? `${res.count} yer imi HTML dosyasına dışa aktarıldı.`
        : 'Yer imleri dışa aktarılamadı.';
      renderContent();
    };
    impCard.appendChild(fileActions);
    body.appendChild(impCard);
  } else if (panel === 'vpn') {
    els.drawerTitle.textContent = 'Poly VPN — Güvenli Tünel';
    const v = state.vpn || { enabled: false, status: 'disconnected', country: 'DE' };
    const isConnected = v.status === 'connected';
    const isConnecting = v.status === 'connecting';

    // Status & Power Card
    const statusCard = document.createElement('div');
    statusCard.className = 'card vpn-hero-card' + (isConnected ? ' connected' : isConnecting ? ' connecting' : '');
    const statusLabel = isConnected
      ? 'Korumalı • Tünel Aktif'
      : isConnecting
        ? 'En hızlı sunucu aranıyor...'
        : v.status === 'error'
          ? 'Bağlantı Hatası'
          : 'Bağlı Değil';

    statusCard.innerHTML = `
      <div class="vpn-hero-top">
        <div class="vpn-status-info">
          <div class="vpn-status-badge ${v.status || 'disconnected'}">
            <span class="vpn-pulse-dot"></span>
            <span>${escapeHtml(statusLabel)}</span>
          </div>
          <div class="vpn-hero-ip">${isConnected && v.externalIp ? `Sanal IP: <strong>${escapeHtml(v.externalIp)}</strong>` : 'IP adresiniz ve trafiğiniz gizlenir'}</div>
        </div>
        <button class="vpn-power-btn ${isConnected ? 'on' : isConnecting ? 'loading' : ''}" id="vpn-power-btn" title="${isConnected ? 'VPN Kapat' : isConnecting ? 'Bağlantıyı İptal Et' : 'VPN Başlat'}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </button>
      </div>
      ${v.errorMessage ? `<div class="vpn-error-msg">${escapeHtml(v.errorMessage)}</div>` : ''}
      ${isConnected ? `
        <div class="vpn-stats-grid">
          <div class="vpn-stat-box"><span>Protokol</span><strong>${escapeHtml(v.protocol || 'TLS')}</strong></div>
          <div class="vpn-stat-box"><span>Gecikme</span><strong>${v.latencyMs || 0} ms</strong></div>
          <div class="vpn-stat-box"><span>WebRTC</span><strong style="color:var(--success)">Korumalı</strong></div>
        </div>
      ` : ''}
    `;
    body.appendChild(statusCard);

    statusCard.querySelector('#vpn-power-btn').onclick = async () => {
      if (isConnected || isConnecting) {
        state.vpn = await window.polyAPI.vpnDisconnect();
      } else {
        state.vpn = await window.polyAPI.vpnConnect(v.country || 'DE', false);
      }
      renderContent();
    };

    // Server Locations (FR, DE, US)
    const locCard = document.createElement('div');
    locCard.className = 'card';
    locCard.innerHTML = '<div class="card-title">Sunucu Konumu Seçin</div>';

    const locations = [
      {
        code: 'FR',
        name: 'Fransa',
        city: 'Paris • Avrupa',
        badge: `<svg viewBox="0 0 32 24" width="32" height="24"><rect width="10.7" height="24" x="0" fill="#002395"/><rect width="10.7" height="24" x="10.65" fill="#FFFFFF"/><rect width="10.7" height="24" x="21.3" fill="#ED2939"/></svg>`
      },
      {
        code: 'DE',
        name: 'Almanya',
        city: 'Frankfurt • Avrupa',
        badge: `<svg viewBox="0 0 32 24" width="32" height="24"><rect width="32" height="8" y="0" fill="#000000"/><rect width="32" height="8" y="8" fill="#DD0000"/><rect width="32" height="8" y="16" fill="#FFCE00"/></svg>`
      },
      {
        code: 'US',
        name: 'ABD',
        city: 'New York • Amerika',
        badge: `<svg viewBox="0 0 32 24" width="32" height="24"><rect width="32" height="24" fill="#B22234"/><rect width="32" height="2" y="2" fill="#FFFFFF"/><rect width="32" height="2" y="6" fill="#FFFFFF"/><rect width="32" height="2" y="10" fill="#FFFFFF"/><rect width="32" height="2" y="14" fill="#FFFFFF"/><rect width="32" height="2" y="18" fill="#FFFFFF"/><rect width="32" height="2" y="22" fill="#FFFFFF"/><rect width="14" height="13" x="0" y="0" fill="#3C3B6E"/><circle cx="3.2" cy="3" r="0.9" fill="#FFF"/><circle cx="7" cy="3" r="0.9" fill="#FFF"/><circle cx="10.8" cy="3" r="0.9" fill="#FFF"/><circle cx="5.1" cy="6.5" r="0.9" fill="#FFF"/><circle cx="8.9" cy="6.5" r="0.9" fill="#FFF"/><circle cx="3.2" cy="10" r="0.9" fill="#FFF"/><circle cx="7" cy="10" r="0.9" fill="#FFF"/><circle cx="10.8" cy="10" r="0.9" fill="#FFF"/></svg>`
      }
    ];

    const locList = document.createElement('div');
    locList.className = 'vpn-loc-list';
    for (const loc of locations) {
      const isSelected = (v.country || 'DE') === loc.code;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vpn-loc-item' + (isSelected ? ' active' : '');
      btn.innerHTML = `
        <span class="vpn-country-code">${loc.badge}</span>
        <div class="vpn-loc-meta">
          <span class="vpn-loc-name">${loc.name}</span>
          <span class="vpn-loc-city">${loc.city}</span>
        </div>
        <span class="vpn-loc-check">${isSelected ? (isConnected ? '● Bağlı' : 'Seçili') : ''}</span>
      `;
      btn.onclick = async () => {
        if (isConnected && isSelected) return;
        state.vpn.country = loc.code;
        if (isConnected) {
          state.vpn = await window.polyAPI.vpnConnect(loc.code, false);
        } else {
          // Connect immediately when user clicks a location or select? Connecting immediately feels snappy!
          state.vpn = await window.polyAPI.vpnConnect(loc.code, false);
        }
        renderContent();
      };
      locList.appendChild(btn);
    }
    locCard.appendChild(locList);
    body.appendChild(locCard);

    if (isConnected) {
      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn-secondary';
      refreshBtn.innerHTML = '<span>En Hızlı Düğümü Yenile</span>';
      refreshBtn.onclick = async () => {
        state.vpn = await window.polyAPI.vpnConnect(v.country || 'DE', true);
        renderContent();
      };
      body.appendChild(refreshBtn);
    }

    const noteCard = document.createElement('div');
    noteCard.className = 'card';
    noteCard.innerHTML = `
      <div class="card-title">Güvenlik Katmanı</div>
      <div class="stat-sub">• Canlı gecikme testi ile çalışan en hızlı düğüm seçilir.</div>
      <div class="stat-sub">• WebRTC IP sızıntı koruması VPN açıkken otomatik devreye girer.</div>
    `;
    body.appendChild(noteCard);
  }
}

els.drawerClose.onclick = () => window.polyAPI.closeFlyout();

window.polyAPI.onFlyoutShow((payload) => {
  state.activePanel = payload.panel;
  state.settings = payload.settings || {};
  state.bookmarks = payload.bookmarks || [];
  state.history = payload.history || [];
  state.downloads = payload.downloads || [];
  state.adBlock = payload.adBlock || state.adBlock;
  state.vpn = payload.vpn || state.vpn;
  state.metrics = payload.metrics || state.metrics;
  state.tabs = payload.tabsState?.tabs || [];
  state.activeTabId = payload.tabsState?.activeTabId;
  state.splitTabId = payload.tabsState?.splitTabId;

  applyTheme(state.settings.theme);
  applyAccentColor(state.settings.accentColor);
  renderContent();
});

window.polyAPI.onMetricsUpdated((metrics) => {
  state.metrics = metrics;
  if (state.activePanel === 'ram') renderContent();
});

window.polyAPI.onAdBlockUpdated((adBlock) => {
  state.adBlock = adBlock;
  if (state.activePanel !== 'adblock') return;
  const sw = document.getElementById('adblock-toggle-sw');
  if (!sw) {
    renderContent();
    return;
  }
  const desired = Boolean(adBlock.enabled);
  if (sw.checked !== desired) sw.checked = desired;
  const sessionEl = document.getElementById('adblock-session-stat');
  const totalEl = document.getElementById('adblock-total-stat');
  const tabEl = document.getElementById('adblock-tab-stat');
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
  if (sessionEl) sessionEl.innerHTML = `${adBlock.sessionBlocked} <span class="stat-sub">bu oturumda engellendi</span>`;
  if (totalEl) totalEl.textContent = `Toplam Engellenen: ${adBlock.totalBlocked}`;
  if (tabEl) tabEl.textContent = `Aktif Sekme: ${activeTab ? activeTab.blockedCount : 0} engelleme`;
});

if (window.polyAPI.onVpnUpdated) {
  window.polyAPI.onVpnUpdated((vpnState) => {
    if (vpnState) {
      state.vpn = vpnState;
      if (state.activePanel === 'vpn') renderContent();
    }
  });
}

window.polyAPI.onDownloadsUpdated((downloads) => {
  state.downloads = downloads;
  if (state.activePanel === 'downloads') renderContent();
});

window.polyAPI.onThemeChanged((theme) => {
  state.settings.theme = theme;
  applyTheme(theme);
  renderContent();
});

if (window.polyAPI.onAccentChanged) {
  window.polyAPI.onAccentChanged((color) => {
    state.settings.accentColor = color;
    applyAccentColor(color);
    if (state.activePanel === 'settings') renderContent();
  });
}

window.polyAPI.onBookmarksUpdated((bookmarks) => {
  state.bookmarks = bookmarks;
  if (state.activePanel === 'bookmarks') renderContent();
});

if (window.polyAPI.onUpdaterUpdated) {
  window.polyAPI.onUpdaterUpdated((upd) => {
    state.updater = upd;
    if (state.activePanel === 'settings') renderContent();
  });
}

function openClearHistoryModal() {
  const existing = document.getElementById('clear-data-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'clear-data-modal';
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>Tarama verilerini sil</h3>
        <button class="modal-close-btn" id="modal-close" title="Kapat">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label class="modal-label">Zaman aralığı</label>
          <select id="modal-time-range" class="poly-select-input">
            <option value="15m">Son 15 dakika</option>
            <option value="1h">Son 1 saat</option>
            <option value="24h">Son 24 saat</option>
            <option value="7d">Son 7 gün</option>
            <option value="4w">Son 4 hafta</option>
            <option value="all" selected>Tüm zamanlar</option>
          </select>
        </div>
        <div class="modal-checkbox-list">
          <label class="modal-checkbox-item">
            <input type="checkbox" id="chk-history" checked />
            <div class="modal-checkbox-text">
              <span class="chk-title">Tarama geçmişi</span>
              <span class="chk-desc">Tüm pencerelerdeki geçmiş temizlenir.</span>
            </div>
          </label>
          <label class="modal-checkbox-item">
            <input type="checkbox" id="chk-cookies" checked />
            <div class="modal-checkbox-text">
              <span class="chk-title">Çerezler ve site verileri</span>
              <span class="chk-desc">Çoğu sitedeki oturumunuz kapatılır.</span>
            </div>
          </label>
          <label class="modal-checkbox-item">
            <input type="checkbox" id="chk-cache" checked />
            <div class="modal-checkbox-text">
              <span class="chk-title">Önbelleğe alınan dosyalar</span>
              <span class="chk-desc">Siteler bir sonraki ziyarette daha yavaş yüklenebilir.</span>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel" id="modal-cancel">İptal</button>
        <button class="btn-primary-action" id="modal-confirm">Verileri sil</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#modal-close').onclick = close;
  overlay.querySelector('#modal-cancel').onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  overlay.querySelector('#modal-confirm').onclick = async () => {
    const timeRange = overlay.querySelector('#modal-time-range').value;
    const clearHistory = overlay.querySelector('#chk-history').checked;
    const clearCookies = overlay.querySelector('#chk-cookies').checked;
    const clearCache = overlay.querySelector('#chk-cache').checked;

    close();
    state.history = await window.polyAPI.clearBrowsingData({
      timeRange,
      clearHistory,
      clearCookies,
      clearCache
    });
    renderContent();
  };
}

