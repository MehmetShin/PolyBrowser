const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p) continue;
    const norm = path.normalize(p);
    const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

function getAppDataRoots() {
  const home = os.homedir();
  const localRoots = uniquePaths([
    process.env.LOCALAPPDATA,
    path.join(home, 'AppData', 'Local')
  ]);
  const roamingRoots = uniquePaths([
    process.env.APPDATA,
    path.join(home, 'AppData', 'Roaming')
  ]);
  return { localRoots, roamingRoots };
}

function findStorePackagePaths(localRoots, prefix, subPartsList) {
  const results = [];
  const lowerPrefix = prefix.toLowerCase();
  const variants = Array.isArray(subPartsList[0]) ? subPartsList : [subPartsList];

  for (const localAppData of localRoots) {
    const pkgRoot = path.join(localAppData, 'Packages');
    try {
      if (!fs.existsSync(pkgRoot)) continue;
      for (const entry of fs.readdirSync(pkgRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith(lowerPrefix)) {
          for (const subParts of variants) {
            results.push(path.join(pkgRoot, entry.name, 'LocalCache', ...subParts));
          }
        }
      }
    } catch (_) {}
  }
  return results;
}

function getOperaRegistryPaths(isGx) {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Opera Software', '/s'], {
      timeout: 1200,
      encoding: 'utf8',
      windowsHide: true
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*Last Install Path\s+REG_SZ\s+(.+?)\s*$/i);
      if (!m) continue;
      const installDir = m[1].trim();
      const lower = installDir.toLowerCase();
      if (isGx ? lower.includes('gx') : !lower.includes('gx')) {
        candidates.push(path.join(installDir, 'profile', 'data'));
        candidates.push(installDir);
      }
    }
  } catch (_) {}
  return uniquePaths(candidates);
}

function getBrowserDefs() {
  const { localRoots, roamingRoots } = getAppDataRoots();

  return [
    {
      id: 'chrome',
      name: 'Google Chrome',
      type: 'chromium',
      userDataDirs: uniquePaths([
        ...localRoots.flatMap((r) => [
          path.join(r, 'Google', 'Chrome', 'User Data'),
          path.join(r, 'Google', 'Chrome Beta', 'User Data'),
          path.join(r, 'Google', 'Chrome SxS', 'User Data')
        ])
      ]),
      flatProfile: false
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      type: 'chromium',
      userDataDirs: uniquePaths([
        ...localRoots.flatMap((r) => [
          path.join(r, 'Microsoft', 'Edge', 'User Data'),
          path.join(r, 'Microsoft', 'Edge Beta', 'User Data')
        ])
      ]),
      flatProfile: false
    },
    {
      id: 'brave',
      name: 'Brave',
      type: 'chromium',
      userDataDirs: uniquePaths([
        ...localRoots.flatMap((r) => [
          path.join(r, 'BraveSoftware', 'Brave-Browser', 'User Data'),
          path.join(r, 'BraveSoftware', 'Brave-Browser-Beta', 'User Data')
        ]),
        ...findStorePackagePaths(localRoots, 'BraveSoftware', [
          ['Local', 'BraveSoftware', 'Brave-Browser', 'User Data'],
          ['Roaming', 'BraveSoftware', 'Brave-Browser', 'User Data']
        ])
      ]),
      flatProfile: false
    },
    {
      id: 'opera',
      name: 'Opera',
      type: 'chromium',
      userDataDirs: uniquePaths([
        ...roamingRoots.flatMap((r) => [
          path.join(r, 'Opera Software', 'Opera Stable'),
          path.join(r, 'Opera Software', 'Opera')
        ]),
        ...localRoots.flatMap((r) => [
          path.join(r, 'Opera Software', 'Opera Stable'),
          path.join(r, 'Opera Software', 'Opera'),
          path.join(r, 'Programs', 'Opera', 'profile', 'data')
        ]),
        ...findStorePackagePaths(localRoots, 'OperaSoftware.OperaBrowser', [
          ['Roaming', 'Opera Software', 'Opera Stable'],
          ['Local', 'Opera Software', 'Opera Stable']
        ])
      ]),
      flatProfile: true
    },
    {
      id: 'operagx',
      name: 'Opera GX',
      type: 'chromium',
      userDataDirs: uniquePaths([
        ...roamingRoots.flatMap((r) => [
          path.join(r, 'Opera Software', 'Opera GX Stable'),
          path.join(r, 'Opera Software', 'Opera GX')
        ]),
        ...localRoots.flatMap((r) => [
          path.join(r, 'Opera Software', 'Opera GX Stable'),
          path.join(r, 'Opera Software', 'Opera GX'),
          path.join(r, 'Programs', 'Opera GX', 'profile', 'data')
        ]),
        ...findStorePackagePaths(localRoots, 'OperaSoftware.OperaGX', [
          ['Roaming', 'Opera Software', 'Opera GX Stable'],
          ['Local', 'Opera Software', 'Opera GX Stable'],
          ['Roaming', 'Opera Software', 'Opera GX'],
          ['Local', 'Opera Software', 'Opera GX']
        ])
      ]),
      flatProfile: true
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      type: 'firefox',
      userDataDirs: uniquePaths([
        ...roamingRoots.map((r) => path.join(r, 'Mozilla', 'Firefox', 'Profiles')),
        ...findStorePackagePaths(localRoots, 'Mozilla.Firefox', [
          ['Roaming', 'Mozilla', 'Firefox', 'Profiles'],
          ['Local', 'Mozilla', 'Firefox', 'Profiles']
        ])
      ]),
      flatProfile: false
    }
  ];
}

function scoreChromiumProfileDir(dir) {
  let score = 0;
  for (const file of ['Login Data', 'Bookmarks', 'History']) {
    const p = path.join(dir, file);
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        score += 10 + (stat.size > 0 ? 1 : 0);
      }
    } catch (_) {}
  }
  return score;
}

function parseFirefoxProfilesIni(profilesRoot) {
  const iniPath = path.join(path.dirname(profilesRoot), 'profiles.ini');
  const out = [];
  try {
    if (!fs.existsSync(iniPath)) return out;
    const raw = fs.readFileSync(iniPath, 'utf8');
    let curPath = '';
    let isRelative = true;
    const flush = () => {
      if (!curPath) return;
      out.push(isRelative ? path.resolve(path.dirname(iniPath), curPath) : curPath);
      curPath = '';
      isRelative = true;
    };
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) {
        flush();
      } else if (trimmed.startsWith('Path=')) {
        curPath = trimmed.slice(5).trim();
      } else if (trimmed.startsWith('IsRelative=')) {
        isRelative = trimmed.slice(11).trim() !== '0';
      }
    }
    flush();
  } catch (_) {}
  return out;
}

function resolveChromiumFromBaseDirs(dirs, flatProfile) {
  let best = null;
  let bestScore = 0;
  const skipDirs = new Set([
    '_side_profiles',
    'Crashpad',
    'GrShaderCache',
    'ShaderCache',
    'System Profile',
    'Guest Profile'
  ]);

  const consider = (userDataDir, profileDir) => {
    if (!profileDir || !fs.existsSync(profileDir)) return;
    const score = scoreChromiumProfileDir(profileDir);
    if (score > bestScore) {
      bestScore = score;
      best = { userDataDir, profileDir };
    }
  };

  for (const baseDir of dirs) {
    if (!baseDir || !fs.existsSync(baseDir)) continue;

    if (flatProfile) {
      consider(baseDir, baseDir);
    }

    const knownSubs = ['Default'];
    for (let i = 1; i <= 15; i++) knownSubs.push(`Profile ${i}`);
    for (const sub of knownSubs) {
      consider(baseDir, path.join(baseDir, sub));
    }

    consider(baseDir, path.join(baseDir, 'profile', 'data'));

    // Opera GX side profiles (_side_profiles/<id> or _side_profiles/<id>/Default)
    const sideProfilesDir = path.join(baseDir, '_side_profiles');
    try {
      if (fs.existsSync(sideProfilesDir)) {
        for (const entry of fs.readdirSync(sideProfilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const sp = path.join(sideProfilesDir, entry.name);
          consider(baseDir, sp);
          consider(baseDir, path.join(sp, 'Default'));
        }
      }
    } catch (_) {}

    try {
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || skipDirs.has(entry.name)) continue;
        consider(baseDir, path.join(baseDir, entry.name));
      }
    } catch (_) {}
  }

  return best;
}

function resolveProfileDir(def) {
  const dirs = Array.isArray(def.userDataDirs) ? def.userDataDirs : [def.userDataDir].filter(Boolean);

  if (def.type === 'firefox') {
    for (const baseDir of dirs) {
      if (!baseDir) continue;
      const iniCandidates = parseFirefoxProfilesIni(baseDir);
      let dirCandidates = [];
      try {
        if (fs.existsSync(baseDir)) {
          dirCandidates = fs.readdirSync(baseDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => path.join(baseDir, e.name));
        }
      } catch (_) {}

      const candidates = uniquePaths([...iniCandidates, ...dirCandidates]);
      candidates.sort((a, b) => {
        const aRel = a.includes('default-release') ? 0 : 1;
        const bRel = b.includes('default-release') ? 0 : 1;
        return aRel - bRel;
      });
      for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'places.sqlite'))) {
          return { userDataDir: baseDir, profileDir: dir };
        }
      }
    }
    return null;
  }

  const found = resolveChromiumFromBaseDirs(dirs, def.flatProfile);
  if (found) return found;

  if (def.id === 'opera' || def.id === 'operagx') {
    const regDirs = getOperaRegistryPaths(def.id === 'operagx');
    if (regDirs.length > 0) {
      return resolveChromiumFromBaseDirs(regDirs, true);
    }
  }

  return null;
}

function copySqliteTemp(dbPath) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpMain = path.join(os.tmpdir(), `poly-imp-${token}.sqlite`);
  fs.copyFileSync(dbPath, tmpMain);
  for (const suffix of ['-wal', '-shm']) {
    const src = dbPath + suffix;
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, tmpMain + suffix); } catch (_) {}
    }
  }
  return tmpMain;
}

function cleanupSqliteTemp(tmpMain) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (fs.existsSync(tmpMain + suffix)) fs.unlinkSync(tmpMain + suffix);
    } catch (_) {}
  }
}

function dpapiUnprotectBatch(base64Blobs) {
  return new Promise((resolve) => {
    if (!Array.isArray(base64Blobs) || base64Blobs.length === 0) return resolve([]);
    const joined = base64Blobs.join('\n');
    const b64Input = Buffer.from(joined, 'utf8').toString('base64');
    const psScript = `
Add-Type -AssemblyName System.Security
$lines = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Input}')).Split("\`n")
$out = @()
foreach ($line in $lines) {
  $t = $line.Trim()
  if (-not $t) { $out += ''; continue }
  try {
    $enc = [Convert]::FromBase64String($t)
    $dec = [Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')
    $out += [Convert]::ToBase64String($dec)
  } catch {
    $out += ''
  }
}
Write-Output ($out -join "\`n")
`;
    const encodedCmd = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCmd],
      { windowsHide: true, timeout: 12000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(base64Blobs.map(() => null));
        const lines = stdout.trim().split(/\r?\n/);
        resolve(base64Blobs.map((_, idx) => (lines[idx] ? Buffer.from(lines[idx].trim(), 'base64') : null)));
      }
    );
  });
}

function collectChromiumBookmarks(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'url' && node.url && /^https?:\/\//i.test(node.url)) {
    out.push({ title: node.name || node.url, url: node.url });
  } else if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectChromiumBookmarks(child, out);
    }
  }
  return out;
}

function parseCsvRows(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let curRow = [];
  let curField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          curField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        curField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      curRow.push(curField);
      curField = '';
    } else if (ch === '\r') {
      // ignore CR
    } else if (ch === '\n') {
      curRow.push(curField);
      rows.push(curRow);
      curRow = [];
      curField = '';
    } else {
      curField += ch;
    }
  }
  if (curField.length > 0 || curRow.length > 0) {
    curRow.push(curField);
    rows.push(curRow);
  }
  return rows;
}

class PolyBrowserImporter {
  detectBrowsers() {
    const defs = getBrowserDefs();
    return defs.map((def) => {
      const resolved = resolveProfileDir(def);
      if (!resolved) {
        return {
          id: def.id,
          name: def.name,
          available: false,
          hasBookmarks: false,
          hasHistory: false,
          hasPasswords: false
        };
      }
      const { profileDir } = resolved;
      if (def.type === 'firefox') {
        const hasPlaces = fs.existsSync(path.join(profileDir, 'places.sqlite'));
        return {
          id: def.id,
          name: def.name,
          available: hasPlaces,
          hasBookmarks: hasPlaces,
          hasHistory: hasPlaces,
          hasPasswords: false // Firefox NSS passwords via CSV import
        };
      }
      const hasBookmarks = fs.existsSync(path.join(profileDir, 'Bookmarks'));
      const hasHistory = fs.existsSync(path.join(profileDir, 'History'));
      const hasPasswords = fs.existsSync(path.join(profileDir, 'Login Data'));
      return {
        id: def.id,
        name: def.name,
        available: hasBookmarks || hasHistory || hasPasswords,
        hasBookmarks,
        hasHistory,
        hasPasswords
      };
    });
  }

  async importFromBrowser(browserId, options = {}, { store, passwordStore }) {
    const def = getBrowserDefs().find((b) => b.id === browserId);
    if (!def) return { ok: false, error: 'Tarayıcı tanınmadı.' };
    const resolved = resolveProfileDir(def);
    if (!resolved) return { ok: false, error: `${def.name} profili bulunamadı.` };
    const { userDataDir, profileDir } = resolved;

    const wantBookmarks = options.bookmarks !== false;
    const wantHistory = options.history !== false;
    const wantPasswords = options.passwords !== false;

    let bookmarksAdded = 0;
    let historyAdded = 0;
    let passwordsAdded = 0;
    let v20Skipped = 0;

    if (def.type === 'firefox') {
      const placesPath = path.join(profileDir, 'places.sqlite');
      if (fs.existsSync(placesPath) && (wantBookmarks || wantHistory)) {
        const tmpDb = copySqliteTemp(placesPath);
        try {
          const db = new DatabaseSync(tmpDb, { readOnly: true });
          if (wantBookmarks) {
            const bmRows = db.prepare(
              "SELECT b.title AS title, p.url AS url FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND p.url LIKE 'http%' LIMIT 500"
            ).all();
            const existingUrls = new Set(store.getAll().bookmarks.map((b) => b.url));
            for (const row of bmRows) {
              if (row.url && !existingUrls.has(row.url)) {
                store.addBookmark({ title: row.title || row.url, url: row.url });
                existingUrls.add(row.url);
                bookmarksAdded++;
              }
            }
          }
          if (wantHistory) {
            const histRows = db.prepare(
              "SELECT url, title, CAST((last_visit_date / 1000) AS INTEGER) AS visit_ms FROM moz_places WHERE visit_count > 0 AND url LIKE 'http%' ORDER BY last_visit_date DESC LIMIT 350"
            ).all();
            const existingHist = new Set(store.getAll().history.map((h) => h.url));
            const nextEntries = [];
            for (const row of histRows) {
              if (!row.url || existingHist.has(row.url)) continue;
              existingHist.add(row.url);
              const visitedAt = row.visit_ms ? Number(row.visit_ms) : Date.now();
              nextEntries.push({
                id: `hist-${visitedAt}-${Math.random().toString(36).slice(2, 6)}`,
                title: row.title || row.url,
                url: row.url,
                visitedAt
              });
              historyAdded++;
            }
            if (nextEntries.length > 0) {
              const all = store.getAll();
              all.history = [...nextEntries, ...all.history].slice(0, 500);
              store.saveNow();
            }
          }
          db.close();
        } catch (err) {
          console.error('[Importer] Firefox places read error:', err);
        } finally {
          cleanupSqliteTemp(tmpDb);
        }
      }
      return { ok: true, browserName: def.name, bookmarksAdded, historyAdded, passwordsAdded, v20Skipped };
    }

    // Chromium family: Bookmarks
    if (wantBookmarks) {
      const bmPath = path.join(profileDir, 'Bookmarks');
      if (fs.existsSync(bmPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(bmPath, 'utf8'));
          const collected = [];
          if (raw.roots) {
            for (const key of Object.keys(raw.roots)) {
              collectChromiumBookmarks(raw.roots[key], collected);
            }
          }
          const existingUrls = new Set(store.getAll().bookmarks.map((b) => b.url));
          for (const bm of collected) {
            if (!existingUrls.has(bm.url)) {
              store.addBookmark(bm);
              existingUrls.add(bm.url);
              bookmarksAdded++;
            }
          }
        } catch (err) {
          console.error('[Importer] Chromium bookmarks error:', err);
        }
      }
    }

    // Chromium family: History
    if (wantHistory) {
      const histPath = path.join(profileDir, 'History');
      if (fs.existsSync(histPath)) {
        const tmpDb = copySqliteTemp(histPath);
        try {
          const db = new DatabaseSync(tmpDb, { readOnly: true });
          const rows = db.prepare(
            "SELECT url, title, CAST((last_visit_time / 1000) AS INTEGER) AS visit_ms FROM urls WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT 350"
          ).all();
          const existingHist = new Set(store.getAll().history.map((h) => h.url));
          const nextEntries = [];
          for (const row of rows) {
            if (!row.url || existingHist.has(row.url)) continue;
            existingHist.add(row.url);
            const rawMs = Number(row.visit_ms) || 0;
            const visitedAt = rawMs > WEBKIT_EPOCH_OFFSET_MS ? rawMs - WEBKIT_EPOCH_OFFSET_MS : Date.now();
            nextEntries.push({
              id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: row.title || row.url,
              url: row.url,
              visitedAt: visitedAt > 0 ? visitedAt : Date.now()
            });
            historyAdded++;
          }
          if (nextEntries.length > 0) {
            const all = store.getAll();
            all.history = [...nextEntries, ...all.history].slice(0, 500);
            store.saveNow();
          }
          db.close();
        } catch (err) {
          console.error('[Importer] Chromium history error:', err);
        } finally {
          cleanupSqliteTemp(tmpDb);
        }
      }
    }

    // Chromium family: Passwords (DPAPI / v10 / v11 + v20 tracking)
    if (wantPasswords) {
      const loginPath = path.join(profileDir, 'Login Data');
      const localStatePath = fs.existsSync(path.join(userDataDir, 'Local State'))
        ? path.join(userDataDir, 'Local State')
        : path.join(path.dirname(profileDir), 'Local State');

      if (fs.existsSync(loginPath)) {
        let masterKey = null;
        try {
          if (fs.existsSync(localStatePath)) {
            const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
            const encKeyB64 = localState?.os_crypt?.encrypted_key;
            if (encKeyB64) {
              const rawKeyBuf = Buffer.from(encKeyB64, 'base64');
              const stripped = rawKeyBuf.subarray(0, 5).toString('utf8') === 'DPAPI'
                ? rawKeyBuf.subarray(5)
                : rawKeyBuf;
              const [decKey] = await dpapiUnprotectBatch([stripped.toString('base64')]);
              masterKey = decKey;
            }
          }
        } catch (_) {}

        const tmpDb = copySqliteTemp(loginPath);
        try {
          const db = new DatabaseSync(tmpDb, { readOnly: true });
          const rows = db.prepare(
            'SELECT origin_url, action_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0'
          ).all();
          db.close();

          const importedEntries = [];
          const legacyDpapiQueue = [];

          for (const row of rows) {
            const url = row.origin_url || row.action_url || '';
            const username = row.username_value || '';
            const blob = row.password_value ? Buffer.from(row.password_value) : null;
            if (!url || !blob || blob.length === 0) continue;

            const prefix = blob.subarray(0, 3).toString('utf8');
            if (prefix === 'v20') {
              v20Skipped++;
              continue;
            }
            if ((prefix === 'v10' || prefix === 'v11') && masterKey && blob.length > 31) {
              try {
                const iv = blob.subarray(3, 15);
                const tag = blob.subarray(blob.length - 16);
                const cipher = blob.subarray(15, blob.length - 16);
                const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
                decipher.setAuthTag(tag);
                const plain = Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
                if (plain) importedEntries.push({ url, username, password: plain });
              } catch (_) {}
            } else {
              legacyDpapiQueue.push({ url, username, b64: blob.toString('base64') });
            }
          }

          if (legacyDpapiQueue.length > 0) {
            const decrypted = await dpapiUnprotectBatch(legacyDpapiQueue.map((q) => q.b64));
            legacyDpapiQueue.forEach((item, idx) => {
              const buf = decrypted[idx];
              if (buf && buf.length > 0) {
                importedEntries.push({ url: item.url, username: item.username, password: buf.toString('utf8') });
              }
            });
          }

          if (importedEntries.length > 0 && passwordStore) {
            const res = passwordStore.importMany(importedEntries);
            passwordsAdded = res.added + res.updated;
          }
        } catch (err) {
          console.error('[Importer] Chromium passwords error:', err);
        } finally {
          cleanupSqliteTemp(tmpDb);
        }
      }
    }

    return { ok: true, browserName: def.name, bookmarksAdded, historyAdded, passwordsAdded, v20Skipped };
  }

  importPasswordsCsv(filePath, passwordStore) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsvRows(raw);
    if (rows.length < 2) return { ok: false, error: 'CSV dosyası boş veya geçersiz.' };

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxUrl = headers.findIndex((h) => h === 'url' || h === 'origin' || h === 'website');
    const idxUser = headers.findIndex((h) => h === 'username' || h === 'user' || h === 'email' || h === 'login');
    const idxPass = headers.findIndex((h) => h === 'password' || h === 'pass');

    if (idxUrl === -1 || idxPass === -1) {
      return { ok: false, error: 'Geçerli şifre CSV başlıkları bulunamadı (url, username, password).' };
    }

    const entries = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const url = (r[idxUrl] || '').trim();
      const username = idxUser >= 0 ? (r[idxUser] || '').trim() : '';
      const password = (r[idxPass] || '');
      if (url && password) {
        entries.push({ url, username, password });
      }
    }

    const res = passwordStore.importMany(entries);
    return { ok: true, added: res.added, updated: res.updated, skipped: res.skipped };
  }

  importBookmarksHtml(filePath, store) {
    const html = fs.readFileSync(filePath, 'utf8');
    const re = /<A\s+[^>]*HREF=["']([^"']+)["'][^>]*>([^<]*)<\/A>/gi;
    const existingUrls = new Set(store.getAll().bookmarks.map((b) => b.url));
    let added = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = (m[1] || '').trim();
      const title = (m[2] || '').trim() || url;
      if (/^https?:\/\//i.test(url) && !existingUrls.has(url)) {
        store.addBookmark({ title, url });
        existingUrls.add(url);
        added++;
      }
    }
    return { ok: true, added };
  }

  exportPasswordsCsv(filePath, passwordStore) {
    const entries = passwordStore.exportDecryptedEntries();
    const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    const lines = ['name,url,username,password'];
    for (const e of entries) {
      lines.push([esc(e.name), esc(e.url), esc(e.username), esc(e.password)].join(','));
    }
    fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
    return { ok: true, count: entries.length };
  }

  exportBookmarksHtml(filePath, store) {
    const bms = store.getAll().bookmarks || [];
    const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const items = bms
      .map((b) => `    <DT><A HREF="${escHtml(b.url)}" ADD_DATE="${Math.floor((b.createdAt || Date.now()) / 1000)}">${escHtml(b.title || b.url)}</A>`)
      .join('\n');
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Poly Yer İmleri</TITLE>
<H1>Poly Yer İmleri</H1>
<DL><p>
  <DT><H3 FOLDED>Poly Yer İmleri</H3>
  <DL><p>
${items}
  </DL><p>
</DL><p>
`;
    fs.writeFileSync(filePath, html, 'utf8');
    return { ok: true, count: bms.length };
  }
}

module.exports = PolyBrowserImporter;

