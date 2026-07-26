@echo off
chcp 65001 >nul
title 知向 - 本地服务
echo 正在启动知向，浏览器地址：http://localhost:5173
call npm run dev
pause
