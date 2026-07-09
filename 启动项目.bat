@echo off
chcp 65001 >nul
setlocal

set "PROJECT_DIR=D:\build\project-manager"
title Project Manager 启动器

echo ================================
echo   Project Manager 快捷启动器
echo ================================
echo.

if not exist "%PROJECT_DIR%\package.json" (
  echo [错误] 没有找到项目目录：%PROJECT_DIR%
  echo 请检查项目是否还在这个路径。
  echo.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js，请先安装 Node.js。
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 npm，请确认 Node.js 安装完整。
  echo.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\node_modules" (
  echo [提示] 当前还没有 node_modules，需要先安装依赖。
  echo 请在本窗口执行：npm install
  echo 安装完成后再双击本脚本启动。
  echo.
  pause
  exit /b 1
)

echo 正在启动项目，请稍等...
echo 项目目录：%PROJECT_DIR%
echo.

npm run dev

echo.
echo 项目已退出或启动进程已结束。
pause
