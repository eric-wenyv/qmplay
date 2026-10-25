# qqmui

qqmui 是 qq music ui 的缩写，是为 Linux 打造的极简 QQ 音乐播放器，专注于听歌。

应用基于 `qq-music-api` 获取歌曲并播放音频，提供推荐电台、喜欢的音乐、歌手电台三种来源。界面采用 540 × 580 紧凑窗口、白色控制键和封面取色背景。Linux 桌面版使用 Electron，浏览器调试页面与桌面版共用原生 HTML / CSS / JavaScript。

## 启动

需要 Node.js 22.12+。qqmui 源码当前位于 `linux-qq` 目录，依赖安装使用 pnpm 11（`package.json` 固定为 11.25.0），`qq-music-api` 的依赖安装使用 npm。`npm run ...` 可以执行播放器脚本，不会改变依赖布局。两个仓库默认并排放置：

```text
Code/
├── linux-qq/
└── qq-music-api/
```

先安装 API 依赖：

```sh
cd /home/eric/Code/qq-music-api
npm install
```

浏览器版不需要安装前端依赖：

```sh
cd /home/eric/Code/linux-qq
npm run dev
```

打开 <http://127.0.0.1:4173>。启动器会复用已经运行的 API，或自动启动相邻仓库的 API（默认 3200 端口）；退出时只停止自己启动的服务。首次或认证过期时显示 QQ 扫码登录，手机确认后自动进入原有主页。已有有效认证时直接恢复主页。首次加载每日新歌，不自动播放；点击播放后开始输出音频。

如果 API 已由其他方式管理，只启动界面：

```sh
npm run dev:ui
```

播放器固定使用本地 `http://127.0.0.1:3200` 服务。浏览器和 Electron 都通过同源 `/api` 代理访问；Electron 由主进程保存和传递 HttpOnly 会话 Cookie。API 仓库位于其他目录时，可设置 `QQ_MUSIC_API_DIR=/path/to/qq-music-api`；页面端口可通过 `PORT=4180` 调整。

播放时自动选择歌曲和浏览器支持的最高可用音质：FLAC → MP3 320 kbps → MP3 128 kbps → AAC。仅请求歌曲提供的格式；旧收藏缺少格式信息时按上述顺序探测。高音质返回空链接时继续尝试下一档，网络错误保留重试提示。应用不提供设置入口，旧版保存的服务地址和音质不会继续使用。

## Linux 桌面版

```sh
pnpm install
pnpm build
pnpm start
```

`pnpm start` 会复用或启动相邻的 API，然后启动 Electron。已打包的应用需要另外在本机 3200 端口运行 API。

Electron 启用 sandbox、contextIsolation 和 webSecurity，保留受限的最小化 / 关闭桥接。支持标题区拖动、调整窗口大小；窗口最小 380 × 520。`pnpm start` 优先加载 `dist/`，修改源码后需重新构建。

发行构建：

```sh
pnpm pack:dir      # 当前平台的可运行目录
pnpm dist:linux    # AppImage + deb
```

本项目的依赖镜像配置在 `.npmrc`，使用 `https://registry.npmmirror.com`。`package.json` 的 `config` 同时配置了 Electron 和 electron-builder 工具下载镜像，执行 `pnpm start`、`pnpm pack:dir`、`pnpm dist:linux` 时自动传给下载器。配置仅作用于当前项目。

可检查和安装：

```sh
pnpm config get registry
pnpm install --frozen-lockfile
```

Electron 首次安装和发行构建需要能够下载 Electron 文件。本次环境没有桌面显示会话；浏览器功能已实测，原生窗口和安装包仍需在目标系统验证。

### 安装出现 `EUNSUPPORTEDPROTOCOL` / `patch:`

如果在 `linux-qq` 中执行 `npm install`，且 `node_modules` 已由 pnpm 创建，npm 可能沿符号链接读取 `@electron-internal/extract-zip` 的开发依赖，从而尝试解析它内部的 Yarn `patch:@napi-rs/cli...` 声明。它不是播放器的直接依赖，也不需要切换到 Yarn。

保留当前依赖目录，使用项目锁文件重新安装：

```sh
cd /home/eric/Code/linux-qq
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`qq-music-api` 目录继续使用 `npm install`。Electron 可执行文件会在桌面版首次启动时按需下载；下载问题与此处的依赖协议错误应分别排查。

## 功能

- 推荐电台：每日新歌及 QQ 公共电台；选台后更新真实歌曲队列。电台队列结束时尝试获取下一批，也可在队列中点击“再听一批”。每日新歌列表未更新时会提示没有更多歌曲。
- 歌手电台：中文 / 英文关键词联想、热门歌手、真实头像与可见歌手的关注人数；选择歌手后播放其热门歌曲，支持继续加载后续页。搜索防抖、取消过期请求，关注人数获取失败不阻断选歌。
- 喜欢的音乐：分页同步 QQ 音乐“我喜欢”完整列表，现有心形按钮直接收藏/取消收藏并回读确认。按账号缓存，切换账号不混入之前的收藏；首次登录把原有本地收藏合并到该账号一次，迁移记录保留以便失败重试。
- 播放连续性：浏览电台或歌手期间，当前音乐继续播放。正在播放“喜欢的音乐”时再次选择该来源，会返回当前歌曲，保留进度、队列和播放 / 暂停状态；从其他来源切换到收藏列表时正常开始播放。
- 音频：自动选择最高可用音质，实际播放 / 暂停、拖动进度、上一首 / 下一首、音量 / 静音、列表循环 / 随机 / 单曲循环。上一首在进度超过三秒时先回到开头。
- 歌词：点击封面查看，随音频高亮滚动，点击歌词定位进度。封面也支持 Enter / 空格打开歌词。支持多时间戳、毫秒与 LRC offset。
- 队列：选曲、移除单曲、清空、继续加载；抽屉管理焦点、遮罩及 Escape 关闭。
- 恢复：音量、播放顺序、来源、收藏、队列、当前歌曲及进度保存在本机，重启保持暂停。签名播放 URL 不持久化。
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

`src/api.js` 负责参数和响应归一化；`src/audio.js` 管实际媒体状态与请求竞态；`src/player.js` 管队列和播放顺序；`src/storage.js` 管本机保存；`src/app.js` 管界面与命令。`scripts/serve.mjs` 提供本机 API 代理，`electron/artwork.cjs` 提供受限的 QQ 图片代理，供背景取色复用。

API 仓库新增的电台歌曲接口遵循 controller → service → UCommon，已同步注册路由、Explorer 元数据、测试和文档。

## 验证

```sh
npm run check
npm test
npm run build
npm run test:integration  # 需要已运行的真实 API 和网络，验证接口与实际音频字节
```

本地测试覆盖响应归一化、无播放权限、超时、播放请求竞态、媒体事件、歌词、队列、存储及图片代理边界。`test:integration` 从当前推荐中尝试获取可播放音频；上游权限或网络变化可能导致此项失败。API 仓库运行 `npm run build`、`npm test -- --runInBand`。

构建产物在 `dist/`。历史 `output/preview.html` 是旧原型的离线导出，不作为当前应用入口；`scripts/export-preview.mjs` 现在构建真实应用并提示启动本地服务。

## 账号和播放权限

qqmui 在首次使用或认证失效时显示 QQ 扫码登录页面。会话由 API 持久保存并校验，失效时尝试刷新；确认无法恢复后才重新显示登录页面。网络中断只显示连接/同步重试，不清除有效会话。恢复窗口、重新联网和前台运行每五分钟都会同步收藏。

QQ 音乐密钥和刷新票据由 API 加密保存在服务端，浏览器只保存不透明的 HttpOnly 会话 Cookie，Electron 使用持久 Cookie 存储，localStorage 只保存播放偏好与按账号隔离的收藏缓存。会话有效期为 30 天，QQ 上游仍可提前撤销；部署时应持久化 API 的认证目录。浏览器和桌面分别保存自己的会话。

Electron 同时识别 `Set-Cookie` 中的 `Max-Age` 和 `Expires`，前者优先；Koa 返回的只有 `Expires` 的二维码 Cookie 和登录 Cookie 也会正确保存。只有明确删除或已过期的 Cookie 才会清理。桌面二维码轮询和登录恢复的回归测试包含此响应格式。

播放链接和音质仍由 QQ 音乐的账号权限决定。登录不会解锁未购买的会员或版权内容；本应用不增加下载、账号管理等额外界面。

默认占位封面来源及说明见 [assets/README.md](assets/README.md)。仅用于学习与个人调试，遵循上游服务和 API 仓库的使用约束。


顶部仅保留听歌所需的来源和音量控制。来源展示按钮与列表选项均为 44 × 44 的方形按钮，图标为 22 × 22；收起按钮与选中选项使用相同的背景、图标和状态点。展开时同一个选中图标按钮在约 320ms 内滑到列表对应位置（电台 / 喜欢 / 歌手依次为第 1 / 2 / 3 项），收起时滑回顶部；其他选项和外框淡入淡出。选择其他来源时，该选项从点击位置滑回顶部。支持快速反向切换和系统减少动态效果设置。

来源按钮距窗口顶部与左侧等距，容器与图标居中；窗口、来源菜单外框和选项统一使用 16px 圆角。右上角已移除独立歌词按钮，Electron 的最小化 / 关闭按钮均为 28 × 28 的圆形，图标为 14 × 14。
