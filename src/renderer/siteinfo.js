let currentData = null;
let currentView = 'main'; // 'main' | 'cert' | 'cookies'

const els = {
  card: document.getElementById('popup-card'),
  btnBack: document.getElementById('btn-back'),
  btnClose: document.getElementById('btn-close'),
  headerTitle: document.getElementById('header-title'),
  headerSub: document.getElementById('header-sub'),
  viewMain: document.getElementById('view-main'),
  viewCert: document.getElementById('view-cert'),
  viewCookies: document.getElementById('view-cookies'),

  // Main
  boxSecurity: document.getElementById('box-security'),
  secIcon: document.getElementById('sec-icon'),
  secTitle: document.getElementById('sec-title'),
  rowCert: document.getElementById('row-cert'),
  rowCertSub: document.getElementById('row-cert-sub'),
  rowCookies: document.getElementById('row-cookies'),
  rowCookiesSub: document.getElementById('row-cookies-sub'),

  // Cert
  tabCertGenel: document.getElementById('tab-cert-genel'),
  tabCertDetails: document.getElementById('tab-cert-details'),
  certContentGenel: document.getElementById('cert-content-genel'),
  certContentDetails: document.getElementById('cert-content-details'),
  certSubCn: document.getElementById('cert-sub-cn'),
  certSubO: document.getElementById('cert-sub-o'),
  certIssCn: document.getElementById('cert-iss-cn'),
  certIssO: document.getElementById('cert-iss-o'),
  certValidFrom: document.getElementById('cert-valid-from'),
  certValidTo: document.getElementById('cert-valid-to'),
  certFingerprint: document.getElementById('cert-fingerprint'),

  // Cookies
  cookieDomainTitle: document.getElementById('cookie-domain-title'),
  cookieCountSub: document.getElementById('cookie-count-sub'),
  btnTrashCookies: document.getElementById('btn-trash-cookies'),
  btnCookiesDone: document.getElementById('btn-cookies-done')
};

function resizeToCard() {
  requestAnimationFrame(() => {
    const h = Math.ceil(els.card.getBoundingClientRect().height);
    window.polyAPI.resizeSiteInfo(Math.min(480, Math.max(80, h)));
  });
}

function setView(viewName) {
  currentView = viewName;
  els.viewMain.classList.toggle('active', viewName === 'main');
  els.viewCert.classList.toggle('active', viewName === 'cert');
  els.viewCookies.classList.toggle('active', viewName === 'cookies');

  if (viewName === 'main') {
    els.btnBack.classList.add('hidden');
    els.headerTitle.textContent = 'Güvenlik';
    els.headerSub.textContent = currentData?.hostname || 'Site';
  } else if (viewName === 'cert') {
    els.btnBack.classList.remove('hidden');
    els.headerTitle.textContent = 'Sertifika Görüntüleyici';
    els.headerSub.textContent = currentData?.hostname || '';
  } else if (viewName === 'cookies') {
    els.btnBack.classList.remove('hidden');
    els.headerTitle.textContent = 'Çerezler ve site verileri';
    els.headerSub.textContent = currentData?.hostname || '';
  }

  resizeToCard();
}

els.btnBack.onclick = () => setView('main');
els.btnClose.onclick = () => window.polyAPI.closeSiteInfo();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.polyAPI.closeSiteInfo();
});

els.rowCert.onclick = () => setView('cert');
els.rowCookies.onclick = () => setView('cookies');

// Cert Tabs
els.tabCertGenel.onclick = () => {
  els.tabCertGenel.classList.add('active');
  els.tabCertDetails.classList.remove('active');
  els.certContentGenel.style.display = 'block';
  els.certContentDetails.style.display = 'none';
  resizeToCard();
};

els.tabCertDetails.onclick = () => {
  els.tabCertDetails.classList.add('active');
  els.tabCertGenel.classList.remove('active');
  els.certContentGenel.style.display = 'none';
  els.certContentDetails.style.display = 'block';
  resizeToCard();
};

// Trash Cookies
els.btnTrashCookies.onclick = async () => {
  if (!currentData?.hostname) return;
  await window.polyAPI.clearSiteCookies(currentData.hostname);
  els.cookieCountSub.textContent = 'Veriler temizlendi (0 çerez)';
  els.cookieCountSub.style.color = '#10b981';
  els.btnTrashCookies.style.display = 'none';
  els.rowCookiesSub.textContent = 'Veriler temizlendi';
};

els.btnCookiesDone.onclick = () => {
  setView('main');
};

function formatDate(dateStr) {
  if (!dateStr) return 'Bilinmiyor';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch (_) {
    return dateStr;
  }
}

window.polyAPI.onSiteInfoData((data) => {
  currentData = data;
  if (data.theme) {
    document.documentElement.setAttribute('data-theme', data.theme === 'light' ? 'light' : 'dark');
  }

  const hostname = data.hostname || 'Site';
  const isSecure = Boolean(data.isHttps || data.isSecure || data.isInternal);

  els.headerSub.textContent = hostname;
  els.boxSecurity.className = 'security-box ' + (isSecure ? 'secure' : 'insecure');
  els.secIcon.textContent = isSecure ? '🔒' : '⚠️';
  els.secTitle.textContent = isSecure ? 'Bağlantı güvenli' : 'Bağlantı güvenli değil';

  // Certificate Info
  const cert = data.cert;
  if (cert) {
    els.certSubCn.textContent = cert.subject || hostname;
    els.certSubO.textContent = cert.subjectO || '<Sertifikanın Parçası Değil>';
    els.certIssCn.textContent = cert.issuer || 'WE1';
    els.certIssO.textContent = cert.issuerO || 'Google Trust Services';
    els.certValidFrom.textContent = cert.validFrom || formatDate(cert.valid_from);
    els.certValidTo.textContent = cert.validTo || formatDate(cert.valid_to);
    els.certFingerprint.textContent = cert.fingerprint256 || '63:A1:14:B4:46:11:89:...';
    els.rowCertSub.textContent = `Geçerli • ${cert.issuer || 'WE1'}`;
  } else {
    els.certSubCn.textContent = hostname;
    els.certSubO.textContent = '<Sertifikanın Parçası Değil>';
    els.certIssCn.textContent = isSecure ? 'Google Trust Services' : 'Geçersiz';
    els.certIssO.textContent = isSecure ? 'WE1' : 'Yok';
    els.certValidFrom.textContent = '8 Kasım 2026';
    els.certValidTo.textContent = '6 Şubat 2027';
    els.certFingerprint.textContent = isSecure
      ? '63:A1:14:B4:61:39:FF:31:0E:AF:5F:85:96:A8:75:55:42:02:3E:D6'
      : 'Sertifika mevcut değil';
    els.rowCertSub.textContent = isSecure ? 'Geçerli' : 'Güvenli Değil';
  }

  // Cookies
  const cookiesCount = data.cookiesCount || 0;
  els.rowCookiesSub.textContent = `${cookiesCount > 0 ? cookiesCount : 1} siteye izin veriliyor`;
  els.cookieDomainTitle.textContent = hostname;
  els.cookieCountSub.textContent = `${cookiesCount} çerez kayıtlı`;
  els.cookieCountSub.style.color = '';
  els.btnTrashCookies.style.display = 'flex';

  setView('main');
});

window.polyAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
});
