
[Setup]
AppId={{D377B68E-45A9-4A9B-983C-1F5BC45EE302}
AppName=Poly
AppVersion=1.0.0
AppPublisher=Poly Browser
AppPublisherURL=https://polybrowser.com/
AppSupportURL=https://polybrowser.com/
AppUpdatesURL=https://polybrowser.com/
DefaultDirName={autopf}\Poly
DisableProgramGroupPage=yes
OutputDir=C:\\Users\\mehme\\OneDrive\\Masaüstü\\Poly Tarayıcı\\dist
OutputBaseFilename=Poly_Kurulum_v1.0.0
SetupIconFile=C:\\Users\\mehme\\OneDrive\\Masaüstü\\Poly Tarayıcı\\src\\assets\\setup-icon.ico
WizardSmallImageFile=C:\\Users\\mehme\\OneDrive\\Masaüstü\\Poly Tarayıcı\\src\\assets\\wizard-small-55.bmp
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\Poly.exe
UninstallDisplayName=Poly Tarayıcı

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "C:\\Users\\mehme\\OneDrive\\Masaüstü\\Poly Tarayıcı\\dist\\packaged\\Poly-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Poly"; Filename: "{app}\Poly.exe"; IconFilename: "{app}\Poly.exe"
Name: "{autodesktop}\Poly"; Filename: "{app}\Poly.exe"; Tasks: desktopicon; IconFilename: "{app}\Poly.exe"

[Run]
Filename: "{app}\Poly.exe"; Description: "{cm:LaunchProgram,Poly}"; Flags: nowait postinstall skipifsilent
