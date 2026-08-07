---
status: accepted
---

# 使用 Docker Compose 提供可选的私有服务器部署

本地优先架构继续使用 Windows 上的 Node.js 与 MySQL，不把 Docker 设为开发前置条件。需要部署到一台不应改动既有软件环境的 Linux 服务器时，使用可选 Docker Compose 运行 Nginx、Express API、一次性数据库初始化任务和 MySQL 8。

Compose 只把 Nginx 网站端口映射到宿主机。API 与 MySQL 仅加入容器网络，MySQL 数据写入命名卷。Nginx 必须挂载部署者单独生成、且不进入版本库的 Basic Auth 文件；缺少该文件时部署应失败关闭，而不是无保护地开放学生档案接口。

API 使用编译后的 JavaScript，并在镜像中安装 PDF 所需 Chromium；数据库初始化镜像保留 TypeScript 脚本和审核数据输入，供首次建库与显式数据导入。真实数据库密码、AI Key、访问密码、备份及学生数据不得写入镜像或仓库。

该方案用于少量受信任人员私有试用，不宣称完成多用户公网运营。面向陌生用户开放前，仍须实现账号归属隔离、HTTPS、访问审计、限流、删除机制和加密备份。
