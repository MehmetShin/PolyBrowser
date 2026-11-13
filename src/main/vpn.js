const net = require('net');
const tls = require('tls');

const VPN_LOCATIONS = {
  FR: { code: 'FR', name: 'Fransa', city: 'Paris', flag: 'FR' },
  DE: { code: 'DE', name: 'Almanya', city: 'Frankfurt', flag: 'DE' },
  US: { code: 'US', name: 'ABD', city: 'New York', flag: 'US' }
};

function testSocks5(ip, port, timeoutMs = 2200) {
  return new Promise((resolve) => {
    const start = Date.now();
    let sock = null;
    let step = 0;
    let done = false;
    let hardTimer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (hardTimer) clearTimeout(hardTimer);
      try { sock?.destroy(); } catch (_) {}
      resolve(ok ? { ok: true, ms: Date.now() - start } : { ok: false });
    };
    hardTimer = setTimeout(() => finish(false), timeoutMs + 200);
    try {
      sock = net.connect(port, ip);
    } catch (_) {
      return finish(false);
    }
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      try { sock.write(Buffer.from([0x05, 0x01, 0x00])); } catch (_) { finish(false); }
    });
    sock.on('data', (d) => {
      if (step === 0 && d.length >= 2 && d[0] === 0x05 && d[1] === 0x00) {
        step = 1;
        try { sock.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 1, 1, 1, 1, 0x01, 0xbb])); } catch (_) { finish(false); }
      } else if (step === 1 && d.length >= 2 && d[0] === 0x05 && d[1] === 0x00) {
        finish(true);
      } else {
        finish(false);
      }
    });
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

function testHttpConnect(ip, port, useTls = false, timeoutMs = 2200) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    let sock = null;
    let hardTimer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (hardTimer) clearTimeout(hardTimer);
      try { sock?.destroy(); } catch (_) {}
      resolve(ok ? { ok: true, ms: Date.now() - start } : { ok: false });
    };
    hardTimer = setTimeout(() => finish(false), timeoutMs + 200);
    try {
      sock = useTls
        ? tls.connect(port, ip, { rejectUnauthorized: true })
        : net.connect(port, ip);
    } catch (_) {
      return finish(false);
    }
    sock.setTimeout(timeoutMs);
    const onReady = () => {
      try {
        sock.write('CONNECT 1.1.1.1:443 HTTP/1.1\r\nHost: 1.1.1.1:443\r\n\r\n');
      } catch (_) {
        finish(false);
      }
    };
    sock.on(useTls ? 'secureConnect' : 'connect', onReady);
    sock.on('data', (d) => {
      const s = d.toString('utf8', 0, 64);
      finish(s.includes('200'));
    });
    sock.on('error', () => finish(false));
    sock.on('timeout', () => finish(false));
  });
}

async function fetchCandidatesForCountry(countryCode) {
  const cc = countryCode.toUpperCase();
  const candidates = [];
  const seen = new Set();

  const addCand = (proto, ip, port) => {
    if (!ip || !port) return;
    const p = String(proto).toLowerCase();
    if (!['socks5', 'http', 'https'].includes(p)) return;
    const key = `${p}://${ip}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ proto: p, ip, port: Number(port), rule: `${p}=${ip}:${port}`, display: `${ip}:${port}` });
  };

  // Source 1: proxifly (fast CDN, updated every 5 mins, sorted by country)
  const fetchProxifly = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/countries/${cc}/data.json`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          // Prefer socks5 & http/https with higher score
          const sorted = [...arr].sort((a, b) => {
            const pa = a.protocol === 'socks5' ? 0 : 1;
            const pb = b.protocol === 'socks5' ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return (b.score || 0) - (a.score || 0);
          });
          for (const item of sorted.slice(0, 60)) {
            addCand(item.protocol, item.ip, item.port);
          }
        }
      }
    } catch (_) {}
  };

  // Source 2: geonode API
  const fetchGeonode = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`https://proxylist.geonode.com/api/proxy-list?limit=30&page=1&sort_by=lastChecked&sort_type=desc&protocols=socks5%2Chttp%2Chttps&country=${cc}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.data)) {
          for (const item of j.data) {
            const proto = Array.isArray(item.protocols) ? item.protocols[0] : 'http';
            addCand(proto, item.ip, item.port);
          }
        }
      }
    } catch (_) {}
  };

  await Promise.all([fetchProxifly(), fetchGeonode()]);
  return candidates;
}

class PolyVPN {
  constructor(session, onStateChange) {
    this.session = session;
    this.onStateChange = onStateChange;
    this.state = {
      enabled: false,
      status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'
      country: 'DE',
      serverIp: '',
      protocol: '',
      latencyMs: 0,
      externalIp: '',
      errorMessage: '',
      webrtcProtected: true,
      locations: VPN_LOCATIONS
    };
    this._verifiedPool = {}; // country -> array of working nodes
    this._connectSeq = 0;
  }

  getState() {
    return { ...this.state };
  }

  _emit() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.getState());
    }
  }

  applyWebRTCPolicy(wc) {
    if (!wc || wc.isDestroyed()) return;
    try {
      if (typeof wc.setWebRTCIPHandlingPolicy === 'function') {
        wc.setWebRTCIPHandlingPolicy(this.state.enabled ? 'disable_non_proxied_udp' : 'default');
      }
    } catch (_) {}
  }

  async _probeBatch(nodes) {
    const results = await Promise.all(
      nodes.map(async (node) => {
        let res;
        if (node.proto === 'socks5') {
          res = await testSocks5(node.ip, node.port, 2600);
        } else {
          res = await testHttpConnect(node.ip, node.port, node.proto === 'https', 2600);
        }
        return res.ok ? { ...node, ms: res.ms } : null;
      })
    );
    return results.filter(Boolean).sort((a, b) => a.ms - b.ms);
  }

  async _findWorkingNodes(countryCode, forceRefresh = false, seq = null) {
    const cc = countryCode.toUpperCase();
    if (!forceRefresh && Array.isArray(this._verifiedPool[cc]) && this._verifiedPool[cc].length > 0) {
      // Re-verify top cached nodes quickly
      const retested = await this._probeBatch(this._verifiedPool[cc].slice(0, 5));
      if (seq !== null && seq !== this._connectSeq) return [];
      if (retested.length > 0) {
        this._verifiedPool[cc] = retested;
        return retested;
      }
    }

    const candidates = await fetchCandidatesForCountry(cc);
    if (seq !== null && seq !== this._connectSeq) return [];
    if (candidates.length === 0) return [];

    // Probe in batches of 25 to find working nodes quickly
    const working = [];
    for (let i = 0; i < Math.min(candidates.length, 75); i += 25) {
      if (seq !== null && seq !== this._connectSeq) return [];
      const batch = candidates.slice(i, i + 25);
      const found = await this._probeBatch(batch);
      working.push(...found);
      if (working.length >= 3) break;
    }
    working.sort((a, b) => a.ms - b.ms);
    this._verifiedPool[cc] = working;
    return working;
  }

  async _verifySessionExitIp() {
    let t;
    let hardTimer;
    try {
      const ctrl = new AbortController();
      t = setTimeout(() => ctrl.abort(), 3500);
      const fetchPromise = (async () => {
        const res = await this.session.fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          return data.ip || '';
        }
        return '';
      })();
      const timeoutPromise = new Promise((resolve) => {
        hardTimer = setTimeout(() => {
          try { ctrl.abort(); } catch (_) {}
          resolve('');
        }, 4000);
      });
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (_) {
      return '';
    } finally {
      clearTimeout(t);
      clearTimeout(hardTimer);
    }
  }

  async connect(countryCode, forceRefresh = false) {
    const cc = VPN_LOCATIONS[countryCode] ? countryCode : this.state.country || 'DE';
    const seq = ++this._connectSeq;

    this.state.country = cc;
    this.state.status = 'connecting';
    this.state.errorMessage = '';
    this.state.externalIp = '';
    this._emit();

    const nodes = await this._findWorkingNodes(cc, forceRefresh, seq);
    if (seq !== this._connectSeq) return this.getState();

    if (nodes.length === 0) {
      this.state.enabled = false;
      this.state.status = 'error';
      this.state.errorMessage = `${VPN_LOCATIONS[cc].name} için yanıt veren sunucu bulunamadı, tekrar deneyin.`;
      await this.session.setProxy({ mode: 'direct' }).catch(() => {});
      this._emit();
      return this.getState();
    }

    // Try top working nodes until Electron session successfully tunnels HTTPS
    for (const node of nodes.slice(0, 4)) {
      if (seq !== this._connectSeq) return this.getState();
      try {
        const proxyRules = node.proto === 'socks5'
          ? `socks5://${node.ip}:${node.port}`
          : node.proto === 'https'
            ? `https://${node.ip}:${node.port}`
            : `http=${node.ip}:${node.port};https=${node.ip}:${node.port}`;

        await this.session.setProxy({
          proxyRules,
          proxyBypassRules: '<local>'
        });

        const exitIp = await this._verifySessionExitIp();
        if (seq !== this._connectSeq) return this.getState();
        if (!exitIp) continue;

        this.state.enabled = true;
        this.state.status = 'connected';
        this.state.serverIp = node.ip;
        this.state.protocol = node.proto.toUpperCase();
        this.state.latencyMs = node.ms;
        this.state.externalIp = exitIp;
        this.state.errorMessage = '';
        this._emit();
        return this.getState();
      } catch (_) {
        // Try next node
      }
    }

    // Fallback: if probe passed but verify timed out, still apply best node or report error
    this.state.enabled = false;
    this.state.status = 'error';
    this.state.errorMessage = 'Tünel doğrulanamadı, başka bir sunucu deneyin.';
    await this.session.setProxy({ mode: 'direct' }).catch(() => {});
    this._emit();
    return this.getState();
  }

  async disconnect() {
    this._connectSeq++;
    try {
      await this.session.setProxy({ mode: 'direct' });
    } catch (_) {}
    this.state.enabled = false;
    this.state.status = 'disconnected';
    this.state.serverIp = '';
    this.state.protocol = '';
    this.state.latencyMs = 0;
    this.state.externalIp = '';
    this.state.errorMessage = '';
    this._emit();
    return this.getState();
  }

  destroy() {
    this._connectSeq++;
  }
}

module.exports = { PolyVPN, VPN_LOCATIONS };
