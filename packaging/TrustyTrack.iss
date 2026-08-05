; Trusty Track — Inno Setup Script
; Produces a Windows installer for Trusty Track.
;
; Run with:
;   iscc TrustyTrack.iss /DMyAppVersion=1.0.0

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName      "TrustyTrack"
#define MyAppPublisher "Trusty Track"
#define MyAppURL       "https://github.com/dknowles2/trusty-track"

; The executable PyInstaller actually produces — `name='trustytrack-server'`
; in trustytrack.spec, plus Windows' .exe. This said "TrustyTrack.exe" for as
; long as the installer has existed, so every shortcut it created, and the
; "launch now" checkbox on the last page, pointed at a file that was never
; built. `backend/tests/test_packaging.py` now holds the two names together.
#define MyAppExeName   "trustytrack-server.exe"

; Relative to this file, which lives in packaging/.
#define BundleDir      "dist\TrustyTrack"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=installer-output
OutputBaseFilename=TrustyTrack-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0

; Per-user by default: the app writes nothing outside %APPDATA%, and the person
; installing it is often a volunteer on a school or church laptop without an
; administrator password. `dialog` still offers a machine-wide install to
; anyone who has one — with `lowest`, {autopf} resolves under %LOCALAPPDATA%.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The PyInstaller bundle, and nothing else. It used to also install
; `launcher.py` — a Python *source* file, onto a machine with no interpreter,
; next to a frozen executable that already starts the server, opens the browser
; and puts an icon in the tray by itself.
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
