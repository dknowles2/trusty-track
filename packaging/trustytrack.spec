# -*- mode: python ; coding: utf-8 -*-
import sys
import os

block_cipher = None

# The analysis starts from run_server.py in the current directory (packaging/)
# We need to include frontend/dist and backend/assets from the root.

added_files = [
    ('../frontend/dist', 'frontend/dist'),
    ('../backend/assets', 'backend/assets'),
    ('../frontend/src/assets/logo_transparent.png', 'assets'),
    # Alembic loads migration scripts from disk at runtime, so they have to be
    # shipped as data. backend.db.database._migrations_dir() looks for them
    # here under sys._MEIPASS.
    ('../backend/migrations', 'backend/migrations'),
]

hidden_imports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'backend.api.main',
    'engineio.async_drivers.uvicorn', # Often needed for uvicorn + websockets
    # backend.db.database imports these lazily inside init_db(), so PyInstaller's
    # static analysis does not pick them up.
    'alembic',
    'alembic.command',
    'alembic.config',
    'alembic.runtime.migration',
]

if sys.platform == 'darwin':
    hidden_imports.append('rumps')
elif sys.platform == 'win32':
    hidden_imports.append('pystray')
    hidden_imports.append('PIL.Image')

# Get icon path from environment or use defaults
icon_path = os.environ.get('APP_ICON')
if not icon_path or not os.path.exists(icon_path):
    if sys.platform == 'darwin':
        icon_path = 'TrustyTrack.icns'
    else:
        icon_path = 'TrustyTrack.ico'

# Get the absolute path to the project root (one level up from this spec file)
# The build script runs pyinstaller from within the packaging/ directory.
root_dir = os.path.abspath('..')

a = Analysis(
    ['run_server.py'],
    pathex=[root_dir],
    binaries=[],
    datas=added_files,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='trustytrack-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path if sys.platform == 'win32' else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='TrustyTrack',
)

if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='TrustyTrack.app',
        icon=icon_path,
        bundle_identifier='com.trustytrack.app',
        info_plist={
            'LSUIElement': False,
            'NSHighResolutionCapable': True,
            'CFBundleShortVersionString': '0.0.0',
            'CFBundleVersion': '0.0.0',
        },
    )
