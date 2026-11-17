@echo off
cd /d "%~dp0"
if not exist "FalconBEND.exe" (
  if not exist "FalconBEND_Launcher_Binary.zip" (
    echo Blad: Brak archiwum FalconBEND_Launcher_Binary.zip
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '%~dp0FalconBEND_Launcher_Binary.zip' -DestinationPath '%~dp0' -Force"
  if errorlevel 1 (
    echo Blad rozpakowywania programu.
    pause
    exit /b 1
  )
)
start "" "%~dp0FalconBEND.exe"
