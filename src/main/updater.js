const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net } = require('electron');

function parseVersion(v) {
  const clean = String(v || '0.0.0').trim().replace(/^v/i, '').split('-')[0];
  return clean.split('.').map((n) => parseInt(n, 10) || 0);
}

function compareSemver(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

class PolyUpdater {
  constructor({ onState } = {}) {
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.config = this._loadConfig();
    this.state = {
      status: this.isConfigured() ? 'idle' : 'not-configured',
      currentVersion: this.config.currentVersion,
      latestVersion: null,
      progress: 0,
      error: null,
      downloadedPath: null,
      releaseUrl: null,
      repo: this.isConfigured() ? `${this.config.owner}/${this.config.repo}` : ''
    };
    this._checking = false;
    this._installing = false;
  }

  _loadConfig() {
    let pkg = {};
    try {
      const pkgPath = path.join(app.getAppPath(), 'package.json');
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (_) {
      try {
        pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
      } catch (__) {}
    }

    const currentVersion = pkg.version || app.getVersion() || '1.0.0';
    const upd = pkg.polyUpdater || {};
    let owner = (upd.owner || '').trim();
    let repo = (upd.repo || '').trim();

    if ((!owner || !repo) && pkg.repository) {
      const rawUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url || '';
      const m = rawUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/i);
      if (m) {
        owner = m[1];
        repo = m[2];
      }
    }

    return { currentVersion, owner, repo };
  }

  isConfigured() {
    const { owner, repo } = this.config;
    return Boolean(
      owner &&
      repo &&
      owner !== 'GITHUB_KULLANICI_ADIN' &&
      !owner.includes(' ') &&
      !repo.includes(' ')
    );
  }

  getState() {
    return { ...this.state };
  }

  _setState(patch) {
    this.state = { ...this.state, ...patch };
    try {
      this.onState(this.getState());
    } catch (_) {}
  }

  async checkForUpdates({ autoDownload = true } = {}) {
    if (this._checking) return this.getState();
    if (!this.isConfigured()) {
      this._setState({ status: 'not-configured', error: null });
      return this.getState();
    }

    this._checking = true;
    this._setState({ status: 'checking', error: null, progress: 0 });

    try {
      const apiUrl = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/releases/latest`;
      const res = await net.fetch(apiUrl, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Poly-Browser/${this.state.currentVersion}`
        }
      });

      if (!res.ok) {
        throw new Error(`GitHub API HTTP ${res.status}`);
      }

      const release = await res.json();
      const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '').trim();
      if (!latestVersion || compareSemver(latestVersion, this.state.currentVersion) <= 0) {
        this._setState({
          status: 'up-to-date',
          latestVersion: latestVersion || this.state.currentVersion,
          progress: 0,
          error: null
        });
        return this.getState();
      }

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const exeAsset = assets.find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));
      if (!exeAsset || !exeAsset.browser_download_url) {
        throw new Error('Release içinde .exe kurulum dosyası bulunamadı.');
      }
      const shaAsset = assets.find((a) => a.name && a.name.toLowerCase() === `${exeAsset.name.toLowerCase()}.sha256`);

      if (!autoDownload) {
        this._setState({
          status: 'available',
          latestVersion,
          releaseUrl: release.html_url || null
        });
        return this.getState();
      }

      const destPath = path.join(app.getPath('temp'), `Poly_Update_v${latestVersion}.exe`);
      const partPath = `${destPath}.part`;

      // Reuse already-downloaded installer if valid
      let alreadyReady = false;
      if (fs.existsSync(destPath) && fs.statSync(destPath).size === exeAsset.size) {
        if (shaAsset) {
          alreadyReady = await this._verifySha256(destPath, shaAsset.browser_download_url);
        } else {
          alreadyReady = true;
        }
      }

      if (!alreadyReady) {
        this._setState({ status: 'downloading', latestVersion, progress: 0 });
        await this._downloadFile(exeAsset.browser_download_url, partPath, exeAsset.size || 0);

        if (shaAsset) {
          const valid = await this._verifySha256(partPath, shaAsset.browser_download_url);
          if (!valid) {
            try { fs.unlinkSync(partPath); } catch (_) {}
            throw new Error('Güncelleme dosyası SHA-256 doğrulamasından geçemedi.');
          }
        }

        if (fs.existsSync(destPath)) {
          try { fs.unlinkSync(destPath); } catch (_) {}
        }
        fs.renameSync(partPath, destPath);
      }

      this._setState({
        status: 'downloaded',
        latestVersion,
        progress: 100,
        downloadedPath: destPath,
        releaseUrl: release.html_url || null,
        error: null
      });
      return this.getState();
    } catch (err) {
      this._setState({
        status: 'error',
        error: err && err.message ? err.message : 'Güncelleme kontrolü başarısız.'
      });
      return this.getState();
    } finally {
      this._checking = false;
    }
  }

  async _verifySha256(filePath, shaUrl) {
    try {
      const res = await net.fetch(shaUrl, {
        headers: { 'User-Agent': `Poly-Browser/${this.state.currentVersion}` }
      });
      if (!res.ok) return false;
      const text = (await res.text()).trim();
      const expected = text.split(/\s+/)[0].toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expected)) return false;
      const actual = await sha256File(filePath);
      return actual === expected;
    } catch (_) {
      return false;
    }
  }

  async _downloadFile(url, destPath, totalBytes) {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': `Poly-Browser/${this.state.currentVersion}` }
    });
    if (!res.ok || !res.body) {
      throw new Error(`İndirme hatası: HTTP ${res.status}`);
    }

    const total = totalBytes || parseInt(res.headers.get('content-length') || '0', 10) || 0;
    let received = 0;
    let lastPct = -1;

    const out = fs.createWriteStream(destPath);
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          out.write(Buffer.from(value));
          received += value.length;
          if (total > 0) {
            const pct = Math.min(99, Math.floor((received / total) * 100));
            if (pct !== lastPct) {
              lastPct = pct;
              this._setState({ status: 'downloading', progress: pct });
            }
          }
        }
      }
      await new Promise((resolve, reject) => {
        out.on('finish', resolve);
        out.on('error', reject);
        out.end();
      });
    } catch (err) {
      try { out.destroy(); } catch (_) {}
      try { fs.unlinkSync(destPath); } catch (_) {}
      throw err;
    }
  }

  installUpdate({ relaunch = true } = {}) {
    if (this._installing) return false;
    const installerPath = this.state.downloadedPath;
    if (!installerPath || !fs.existsSync(installerPath)) return false;
    this._installing = true;

    const exePath = process.execPath;
    const silentArgs = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS';
    const script = relaunch
      ? `timeout /t 2 /nobreak >nul && "${installerPath}" ${silentArgs} && start "" "${exePath}"`
      : `timeout /t 2 /nobreak >nul && "${installerPath}" ${silentArgs}`;

    const child = spawn('cmd.exe', ['/d', '/s', '/c', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    if (relaunch) {
      setTimeout(() => app.quit(), 150);
    }
    return true;
  }
}

module.exports = PolyUpdater;

