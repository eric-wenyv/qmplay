# qmplay 开发指南

`linux-qq` 是 qmplay 的源码仓库：一个极简 QQ 音乐播放器，支持 Linux、Windows 和 Android，提供电台、歌手检索、播放、歌词及收藏。各端共享原生 HTML/CSS/JavaScript 界面，并内置从 `qq-music-api` 裁剪的 Koa + TypeScript 服务，无需单独启动相邻仓库。

## 代码入口

- `index.html`、`src/`：共享界面；`app.js` 编排交互，`api.js` 统一接口与数据格式，`player.js` / `audio.js` 处理播放，`auth.js` / `favorites.js` / `storage.js` 处理认证、收藏和本地状态。
- `electron/`：桌面主进程、preload、内置 API 生命周期、请求代理与 Cookie 管理；入口为 `main.cjs`。
- `backend/src/`：内置 API，沿用 `routes → controllers → services → util` 分层。
- `android/`：Java Activity / 播放服务、C++ Node.js Mobile 桥接及 `server.ts` 本地服务，复用前端与后端。
- `scripts/`、`tests/`：开发与构建脚本、Node.js 原生测试；CI 和发布说明见 [.github/CI.md](.github/CI.md)。

## 常用命令

需要 Node.js 22.12+、pnpm 11.25.0，在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm check          # JavaScript 语法及后端、Android TypeScript 检查
pnpm test           # 离线测试
pnpm build          # 构建共享界面、内置 API 和桌面应用目录
pnpm start          # 启动 Electron
```

安装包命令为 `pnpm build:linux`、`pnpm build:windows`、`pnpm build:android`，依赖对应平台工具链；产物在 `release/`。`pnpm test:ci` 额外输出 JUnit，`pnpm test:integration` 会请求真实上游。

## 修改约束

- 保持共享前端和现有模块边界；上游响应在 `src/api.js` 归一化，后端继续走 controller/service 链路，日志统一使用 `backend/src/util/logger.ts`。
- QQ 凭据由后端 `SessionStore` 加密保存；禁止将 QQ Cookie、音乐密钥或刷新票据写入日志、响应或 localStorage。Electron 会话 Cookie 解析集中在 `electron/auth-cookies.cjs`，兼容 `Expires` 和 `Max-Age`，后者优先。
- 有效会话直接进入主页，网络故障不能当作退出登录；收藏按账号隔离，固定目录 201，写入须检查业务码并回读确认。
- 保留桌面沙箱、上下文隔离和本地 API 访问控制；兼容已有用户目录与协议，避免丢失登录及播放状态。
- 行为变更补充相关 `tests/*.test.js` 并同步文档；依赖变更同步 `pnpm-lock.yaml`。跨端改动注意 Windows 路径/CRLF 和 Android Node.js Mobile 兼容性。
- 修改源码而非 `dist/`、`release/`、`output/` 等生成文件；保留第三方许可证，签名密钥与认证数据不得提交或打包。
