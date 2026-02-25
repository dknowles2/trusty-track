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
#define MyAppExeName   "TrustyTrack.exe"

; Adjust these paths relative to where ISCC is called from (repo root)
#define BundleDir      "..\packaging\dist\TrustyTrack"
#define LauncherScript "..\packaging\launcher.py"

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
PrivilegesRequired=admin
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Server bundle (PyInstaller output)
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Launcher
Source: "{#LauncherScript}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
