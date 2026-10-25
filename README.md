# qqmui

qqmui 是 qq music ui 的缩写，是为 Linux 打造的极简 QQ 音乐播放器，专注于听歌。

应用基于 `qq-music-api` 获取歌曲并播放音频，提供推荐电台、喜欢的音乐、歌手电台三种来源。界面采用 540 × 580 紧凑窗口、白色控制键和封面取色背景。Linux 桌面版使用 Electron，浏览器调试页面与桌面版共用原生 HTML / CSS / JavaScript。

## 启动与开发

源码和精简后的 `qq-music-api` 后端都在本仓库。构建环境需要 Node.js 22.12+ 和 pnpm 11（固定为 11.25.0）；安装后的 Linux 应用自带 Electron 和后端运行时，不需要另外安装 Node.js、下载 API 仓库或手动启动服务。

```sh
pnpm install --frozen-lockfile
pnpm dev           # 浏览器调试：http://127.0.0.1:4173
```

`pnpm dev` 与 `pnpm dev:ui` 都会构建并启动内置 API，退出时清理自己的子进程。页面端口可通过 `PORT=4180 pnpm dev` 调整。API 只监听本机随机空闲端口，由同源 `/api` 代理访问；不依赖 3200 端口，也不复用外部 API 进程。内部访问令牌只在启动器和代理之间传递。

首次或认证过期时显示 QQ 扫码登录，手机确认后进入主页；已有有效认证时直接恢复主页。首次加载每日新歌，不自动播放。播放时自动选择歌曲和浏览器支持的最高可用音质：FLAC → MP3 320 kbps → MP3 128 kbps → AAC。高音质返回空链接时继续尝试下一档，网络错误保留重试提示。

## Linux 桌面版

```sh
pnpm build
pnpm start
```

`pnpm build` 将界面资源复制到 `dist/`，并把应用实际使用的 API 及依赖打包成 `dist/backend/server.cjs`。`pnpm start` 启动 Electron，由主进程自动启动内置 API 子进程；后端退出会显示可重试的连接错误。后端与窗口一起退出。修改界面源码后需要重新构建。

Electron 保留 sandbox、contextIsolation、webSecurity 与受限的最小化 / 关闭桥接。窗口最小 380 × 520，支持拖动和调整大小。现有 `interlude://app` 页面来源和桌面用户数据目录继续复用，保留登录 Cookie、播放状态和收藏缓存。

## Linux 安装包

在 Linux 构建机运行：

```sh
./build.sh
# 已安装依赖时也可以：
pnpm build:linux
```

脚本依次运行代码检查、测试、界面与后端构建，然后使用 electron-builder 生成全部三种格式：

```text
release/
├── qqmui-1.0.0-amd64.deb
├── qqmui-1.0.0-x86_64.rpm
├── qqmui-1.0.0-x86_64.AppImage
└── SHA256SUMS
```

上例为 x86-64 构建，文件名中的架构使用各格式的命名（deb 为 `amd64`，rpm / AppImage 为 `x86_64`）。版本和架构取自工程配置及构建目标。默认构建当前机器架构；可用 `./build.sh --x64` 或 `./build.sh --arm64` 显式指定，目标架构的安装运行仍需在相应系统验证。校验文件可用 `cd release && sha256sum -c SHA256SUMS` 检查。`pnpm dist:linux` 是同一构建入口，`pnpm pack:dir` 只生成可运行目录供调试。

构建机需要能够下载 Electron 与打包工具，并安装 RPM 构建工具 `rpmbuild`（Fedora 系统通常由 `rpm-build` 提供）。Electron 和工具镜像默认来自工程配置，可通过 `ELECTRON_MIRROR` 和 `ELECTRON_BUILDER_BINARIES_MIRROR` 覆盖。pnpm 注册表配置位于 `.npmrc`。安装依赖使用 `pnpm install --frozen-lockfile`，不要在 pnpm 依赖目录中混用 `npm install`。

所有安装包均包含后端，不需要相邻 `qq-music-api` 仓库。Electron 自带的 `LICENSE`、`LICENSES.chromium.html`，API 原始许可证及实际打包依赖的声明会随发行产物保留。项目源码与问题反馈分别位于 [eric-wenyv/qmui](https://github.com/eric-wenyv/qmui) 和 [Issues](https://github.com/eric-wenyv/qmui/issues)；安装包元数据使用此项目地址，上游 API 来源单独保留在第三方声明中。

## 功能

- 推荐电台：每日新歌及 QQ 公共电台；选台后更新真实歌曲队列。电台队列结束时尝试获取下一批，也可在队列中点击“再听一批”。每日新歌列表未更新时会提示没有更多歌曲。
- 歌手电台：中文 / 英文关键词联想、热门歌手、真实头像与可见歌手的关注人数；选择歌手后播放其热门歌曲，支持继续加载后续页。搜索防抖、取消过期请求，关注人数获取失败不阻断选歌。
- 喜欢的音乐：分页同步 QQ 音乐“我喜欢”完整列表，现有心形按钮直接收藏/取消收藏并回读确认。按账号缓存，切换账号不混入之前的收藏；首次登录把原有本地收藏合并到该账号一次，迁移记录保留以便失败重试。
- 播放连续性：浏览电台或歌手期间，当前音乐继续播放。正在播放“喜欢的音乐”时再次选择该来源，会返回当前歌曲，保留进度、队列和播放 / 暂停状态；从其他来源切换到收藏列表时正常开始播放。
- 音频：自动选择最高可用音质，实际播放 / 暂停、拖动进度、上一首 / 下一首、列表循环 / 随机 / 单曲循环。上一首在进度超过三秒时先回到开头。音量与静音由桌面系统的应用音量控制管理。
- 歌词：点击封面查看，随音频高亮滚动，点击歌词定位进度。封面也支持 Enter / 空格打开歌词。支持多时间戳、毫秒与 LRC offset。
- 队列：选曲、移除单曲、清空、继续加载；抽屉管理焦点、遮罩及 Escape 关闭。
- 恢复：播放顺序、来源、收藏、队列、当前歌曲及进度保存在本机，重启保持暂停。签名播放 URL 不持久化；旧版应用音量偏好会被忽略并在保存时清理。
- 错误处理：连接失败、超时、无播放权限、音频加载失败均显示提示及重试入口。请求失败时保留已有队列，旧播放请求不会覆盖新选歌曲。
- 系统集成：通过 Media Session 提供歌曲信息、播放 / 暂停、切歌及定位能力，具体支持取决于操作系统和运行环境。

快捷键：空白区域的空格播放 / 暂停，左右方向键切歌，Ctrl / ⌘ + K 搜索歌手，Escape 关闭当前面板。原生输入控件保留各自键盘行为。

## 接口与代码

| 能力 | qq-music-api 接口 |
| --- | --- |
| 每日新歌 | `/getRecommend` |
| 公共电台目录 / 曲目 | `/getRadioLists`、新增 `/getRadioTracks?id=199&firstplay=1` |
| 歌手搜索 / 热门歌手 | `/getSmartbox?key=...`、`/getSingerList` |
| 歌手曲目 / 关注人数 | `/getSingerHotsong`、`/getSingerStarNum` |
| 播放地址 | `/getMusicPlay?songmid=...&mediaId=...&quality=...`（自动选择） |
| 歌词 / 连接测试 | `/getLyric`、`/getHotkey` |
| 登录状态 / 二维码 / 退出 | `/auth/status`、`/auth/qr`、`/auth/qr/check`、`/auth/logout` |
| 收藏分页 / 写入 / 旧歌曲 ID 补全 | `/user/favorites`（GET / POST）、`/getSongInfo` |

`src/api.js` 负责参数和响应归一化；`src/audio.js` 管实际媒体状态与请求竞态；`src/player.js` 管队列和播放顺序；`src/storage.js` 管本机保存；`src/app.js` 管界面与命令。`scripts/serve.mjs` 提供本机 API 代理，`electron/artwork.cjs` 提供受限的 QQ 图片代理，供背景取色复用。

`backend/src/` 只保留上表接口及其依赖，沿用 controller → service → util 分层。`/health` 仅用于内部就绪检查；不包含 Explorer、评论、MV、专辑、排行榜、下载或通用 Cookie 接口。API 的来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [backend/README.md](backend/README.md)。

## 验证

```sh
pnpm check
pnpm test
pnpm build
pnpm test:integration  # 自动启动内置 API；需要网络，验证真实接口与音频字节
```

本地测试覆盖响应归一化、无播放权限、超时、播放请求竞态、媒体事件、歌词、队列、存储及图片代理边界。`test:integration` 从当前推荐中尝试获取可播放音频；上游权限或网络变化可能导致此项失败。后端回归测试直接在本仓库运行，覆盖路由范围、认证边界和会话持久化。

构建产物在 `dist/`。历史 `output/preview.html` 是旧原型的离线导出，不作为当前应用入口；`scripts/export-preview.mjs` 现在构建真实应用并提示启动本地服务。

## 账号和播放权限

qqmui 在首次使用或认证失效时显示 QQ 扫码登录页面。会话由 API 持久保存并校验，失效时尝试刷新；确认无法恢复后才重新显示登录页面。网络中断只显示连接/同步重试，不清除有效会话。恢复窗口、重新联网和前台运行每五分钟都会同步收藏。

QQ 音乐密钥和刷新票据由内置 API 加密保存在本机，浏览器只保存不透明的 HttpOnly 会话 Cookie，Electron 使用持久 Cookie 存储，localStorage 只保存播放偏好与按账号隔离的收藏缓存。会话有效期为 30 天，QQ 上游仍可提前撤销。桌面优先复用已有 `~/.local/share/qq-music-api/auth` 认证目录以迁移登录，否则保存在 Electron 用户数据目录的 `auth/`；浏览器调试继续使用前述默认目录。可通过 `QQ_MUSIC_AUTH_DIR` 显式指定认证目录，备份时应同时保留其中的密钥和会话文件。浏览器和桌面分别保存自己的 Cookie。

Electron 同时识别 `Set-Cookie` 中的 `Max-Age` 和 `Expires`，前者优先；Koa 返回的只有 `Expires` 的二维码 Cookie 和登录 Cookie 也会正确保存。只有明确删除或已过期的 Cookie 才会清理。桌面二维码轮询和登录恢复的回归测试包含此响应格式。

播放链接和音质仍由 QQ 音乐的账号权限决定。登录不会解锁未购买的会员或版权内容；本应用不增加下载、账号管理等额外界面。

默认占位封面来源及说明见 [assets/README.md](assets/README.md)。仅用于学习与个人调试，遵循上游服务和 API 仓库的使用约束。


顶部左侧保留音乐来源控制，Electron 右侧保留最小化 / 关闭按钮。来源展示按钮与列表选项均为 44 × 44 的方形按钮，图标为 22 × 22；收起按钮与选中选项使用相同的背景、图标和状态点。展开时同一个选中图标按钮在约 320ms 内滑到列表对应位置（电台 / 喜欢 / 歌手依次为第 1 / 2 / 3 项），收起时滑回顶部；其他选项和外框淡入淡出。选择其他来源时，该选项从点击位置滑回顶部。支持快速反向切换和系统减少动态效果设置。

顶部来源与 Electron 最小化 / 关闭按钮均为 44 × 44、图标为 22 × 22，顶部距边界 16px，最外侧按钮分别距左右边界 16px；窗口按钮为圆形、间隔 4px，窄窗口也保持相同尺寸。来源菜单展开后外框距顶部和左侧均为 12px。窗口、来源菜单外框和选项统一使用 16px 圆角。Electron 使用透明窗口底层，页面背景透明，由播放器裁切窗口四角，窄窗口也保留圆角。右上角不再提供音量、静音弹层及独立歌词按钮；登录页面仍可使用最小化 / 关闭按钮。
