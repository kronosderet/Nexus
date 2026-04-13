@echo off
REM ============================================================
REM  Nexus dev launcher — The Cartographer
REM
REM  Starts (or restarts) both servers in their own windows:
REM    - Dashboard (Express + built React) on http://localhost:3001
REM    - Frontend  (Vite HMR for dev)      on http://localhost:5173
REM
REM  Data: reads/writes ~/.nexus/nexus.json (same as MCP plugin)
REM  Safe to run repeatedly — kills existing processes first.
REM ============================================================

setlocal

echo.
echo   ======================================================
echo   NEXUS DEV LAUNCHER  --  The Cartographer  v4.2
echo   ======================================================
echo.

REM -- Kill anything currently listening on 3001 ----------------
echo   [1/4] Releasing port 3001 (dashboard)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3001"') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM -- Kill anything currently listening on 5173 ----------------
echo   [2/4] Releasing port 5173 (frontend HMR)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":5173"') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM -- Let the OS actually release the sockets -------------------
timeout /t 1 /nobreak >nul

REM -- Move to the Nexus repo root regardless of cwd -------------
cd /d "%~dp0"

REM -- Spawn dashboard in its own persistent window ---------------
echo   [3/4] Starting dashboard (server/dashboard.ts on :3001)...
start "Nexus Dashboard :3001" cmd /k "cd /d %~dp0 && npx tsx server/dashboard.ts"

REM -- Small stagger so the dashboard claims port 3001 first ------
timeout /t 2 /nobreak >nul

REM -- Spawn frontend dev server in its own persistent window ------
echo   [4/4] Starting frontend HMR (vite on :5173)...
start "Nexus Frontend :5173" cmd /k "cd /d %~dp0 && npm run dev:client"

echo.
echo   ------------------------------------------------------
echo   Both servers launched in separate windows.
echo.
echo     Dashboard : http://localhost:3001 (built React + API)
echo     Frontend  : http://localhost:5173 (Vite HMR for dev)
echo     Data      : %USERPROFILE%\.nexus\nexus.json
echo.
echo   Close their windows (or re-run this script) to stop.
echo   ------------------------------------------------------
echo.

REM -- Auto-close this launcher window after 3 seconds ----------
timeout /t 3 /nobreak >nul
endlocal
