@echo off
REM ============================================================
REM  Nexus dev launcher
REM  Starts (or restarts) both dev servers in their own windows:
REM    - Backend  (Express + WebSocket) on http://localhost:3001
REM    - Frontend (Vite HMR)             on http://localhost:5173
REM
REM  Safe to run repeatedly — any existing listener on either
REM  port is killed first, then both are started fresh.
REM  Usage: double-click or run `nexus-dev.bat` from anywhere.
REM ============================================================

setlocal

echo.
echo   ======================================================
echo   NEXUS DEV LAUNCHER  --  The Cartographer
echo   ======================================================
echo.

REM -- Kill anything currently listening on 3001 ----------------
echo   [1/4] Releasing port 3001 (backend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3001"') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM -- Kill anything currently listening on 5173 ----------------
echo   [2/4] Releasing port 5173 (frontend)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":5173"') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM -- Let the OS actually release the sockets -------------------
timeout /t 1 /nobreak >nul

REM -- Move to the Nexus repo root regardless of cwd -------------
cd /d "%~dp0"

REM -- Spawn backend in its own persistent window ---------------
echo   [3/4] Starting backend  (tsx watch server/index.ts)...
start "Nexus Backend :3001" cmd /k "cd /d %~dp0 && npm run dev:server"

REM -- Small stagger so the backend claims port 3001 first ------
timeout /t 2 /nobreak >nul

REM -- Spawn frontend in its own persistent window --------------
echo   [4/4] Starting frontend (vite on :5173)...
start "Nexus Frontend :5173" cmd /k "cd /d %~dp0 && npm run dev:client"

echo.
echo   ------------------------------------------------------
echo   Both servers launched in separate windows.
echo.
echo     Backend  : http://localhost:3001
echo     Frontend : http://localhost:5173
echo.
echo   Close their windows (or re-run this script) to stop.
echo   ------------------------------------------------------
echo.

REM -- Auto-close this launcher window after 3 seconds ----------
timeout /t 3 /nobreak >nul
endlocal
