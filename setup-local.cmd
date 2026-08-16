@echo off
chcp 65001 >nul
title 知向 - 首次安装
echo [1/2] 安装项目依赖...
call npm install || goto :error
echo [2/2] 检查环境配置...
if not exist .env (
  echo 未找到 .env。请复制 .env.example 为 .env，并填写 Supabase 的 DATABASE_URL。
  goto :error
)
echo 安装完成，请双击 start-local.cmd 启动。
pause
exit /b 0
:error
echo 安装失败，请查看上方错误信息。
pause
exit /b 1
