const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const STAGING_DIR = path.join(ROOT_DIR, 'dist', 'staging');
const PACKAGED_DIR = path.join(ROOT_DIR, 'dist', 'packaged');
const OUTPUT_INSTALLER_DIR = path.join(ROOT_DIR, 'dist');
const DESKTOP_DIR = 'C:\\Users\\mehme\\OneDrive\\Masaüstü';

console.log('=== 1. STAGING & OBFUSCATION (KOD GÜVENLİĞİ) BAŞLATILIYOR ===');

// Clean staging directory
if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

// Copy package.json (stripped of devDependencies for security)
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.scripts;
fs.writeFileSync(path.join(STAGING_DIR, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

// Copy src recursively
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyDirSync(path.join(ROOT_DIR, 'src'), path.join(STAGING_DIR, 'src'));

// Find and obfuscate all .js files in staging
function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getJsFiles(fullPath));
    } else if (item.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const jsFiles = getJsFiles(path.join(STAGING_DIR, 'src'));
console.log(`Güvenlikleştirilecek JavaScript dosya sayısı: ${jsFiles.length}`);

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'variable',
  stringArrayThreshold: 0.85,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

for (const filePath of jsFiles) {
  const rel = path.relative(STAGING_DIR, filePath);
  console.log(` -> Şifreleniyor & Karıştırılıyor: ${rel}`);
  const code = fs.readFileSync(filePath, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
  fs.writeFileSync(filePath, obfuscated.getObfuscatedCode(), 'utf8');
}
console.log('Tüm kaynak kodları başarıyla kırılamaz / anlaşılamaz hale getirildi!');

console.log('\n=== 2. ASAR ARŞİVİ VE ELEKTRON PAKETLEME (PACKAGER) ===');
if (fs.existsSync(PACKAGED_DIR)) {
  fs.rmSync(PACKAGED_DIR, { recursive: true, force: true });
}

const packagerCmd = `npx electron-packager "${STAGING_DIR}" Poly --platform=win32 --arch=x64 --icon="${path.join(ROOT_DIR, 'src', 'assets', 'icon.ico')}" --out="${PACKAGED_DIR}" --overwrite --asar`;
console.log(`Çalıştırılıyor: ${packagerCmd}`);
execSync(packagerCmd, { stdio: 'inherit', cwd: ROOT_DIR, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });

const appDir = path.join(PACKAGED_DIR, 'Poly-win32-x64');
if (!fs.existsSync(appDir)) {
  throw new Error(`Paketlenmiş uygulama bulunamadı: ${appDir}`);
}
console.log(`Paketleme tamamlandı: ${appDir}`);

console.log('\n=== 3. INNO SETUP KURULUM MOTORU (SETUP INSTALLER) OLUŞTURULUYOR ===');
const innoScriptPath = path.join(ROOT_DIR, 'installer.iss');
const darkIconPath = path.join(ROOT_DIR, 'src', 'assets', 'setup-icon.ico');
const wizardBmpPath = path.join(ROOT_DIR, 'src', 'assets', 'wizard-small-55.bmp');

const innoScriptContent = `
[Setup]
AppId={{D377B68E-45A9-4A9B-983C-1F5BC45EE302}
AppName=Poly
AppVersion=${pkg.version}
AppPublisher=Poly Browser
AppPublisherURL=https://polybrowser.com/
AppSupportURL=https://polybrowser.com/
AppUpdatesURL=https://polybrowser.com/
DefaultDirName={autopf}\\Poly
DisableProgramGroupPage=yes
OutputDir=${OUTPUT_INSTALLER_DIR.replace(/\\/g, '\\\\')}
OutputBaseFilename=Poly_Kurulum_v${pkg.version}
SetupIconFile=${darkIconPath.replace(/\\/g, '\\\\')}
WizardSmallImageFile=${wizardBmpPath.replace(/\\/g, '\\\\')}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\\Poly.exe
UninstallDisplayName=Poly Tarayıcı

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "${appDir.replace(/\\/g, '\\\\')}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\\Poly"; Filename: "{app}\\Poly.exe"; IconFilename: "{app}\\Poly.exe"
Name: "{autodesktop}\\Poly"; Filename: "{app}\\Poly.exe"; Tasks: desktopicon; IconFilename: "{app}\\Poly.exe"

[Run]
Filename: "{app}\\Poly.exe"; Description: "{cm:LaunchProgram,Poly}"; Flags: nowait postinstall skipifsilent
`;

fs.writeFileSync(innoScriptPath, innoScriptContent, 'utf8');

const isccExe = path.join(ROOT_DIR, 'node_modules', 'innosetup-compiler', 'bin', 'ISCC.exe');
console.log(`ISCC Derleyicisi çalıştırılıyor: ${isccExe}`);
execSync(`"${isccExe}" "${innoScriptPath}"`, { stdio: 'inherit', cwd: ROOT_DIR });

const setupName = `Poly_Kurulum_v${pkg.version}.exe`;
const finalSetup = path.join(OUTPUT_INSTALLER_DIR, setupName);
if (fs.existsSync(finalSetup)) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(finalSetup)).digest('hex');
  const shaPath = path.join(OUTPUT_INSTALLER_DIR, `${setupName}.sha256`);
  fs.writeFileSync(shaPath, `${hash}  ${setupName}\n`, 'utf8');
  console.log(`\nBAŞARILI: Kurulum dosyası oluşturuldu -> ${finalSetup}`);
  console.log(`SHA-256 dosyası oluşturuldu -> ${shaPath}`);
  const desktopSetup = path.join(DESKTOP_DIR, setupName);
  fs.copyFileSync(finalSetup, desktopSetup);
  console.log(`Masaüstüne kopyalandı -> ${desktopSetup}`);
} else {
  console.error('HATA: Kurulum dosyası oluşturulamadı!');
}

