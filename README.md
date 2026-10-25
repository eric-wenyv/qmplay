# 间奏 · Interlude

一个接近正方形的极简音乐播放器，按手绘草图实现的可交互前端原型。Electron 桌面端与浏览器预览共用同一套原生 HTML / CSS / JavaScript，无前端框架和运行时 CDN。

当前进度与待办见 [proton.md](proton.md)。

当前使用本地演示数据；播放按钮、进度、音量和切歌用于展示交互，**不会输出音乐，也尚未连接 QQ 账号与 QQ Music API**。封面为生成图，不是真实专辑封面。正式音频播放可在后续通过 HTMLAudioElement 接入。

## 本地预览

需要 Node.js 22.12+ 和 pnpm 11。浏览器预览不需要安装依赖：

```sh
cd /home/eric/Code/linux-qq
node scripts/serve.mjs
```

打开 <http://127.0.0.1:4173>。`PORT=4180 node scripts/serve.mjs` 可修改端口。服务仅监听本机。

也可直接双击 `output/preview.html` 查看完整离线原型，无需启动服务器。该文件由 `node scripts/build.mjs` 导出，内嵌全部样式、脚本和封面，仍支持交互。

## Electron

```sh
pnpm install
pnpm start
```

`pnpm start` 优先加载 `dist/`，不存在构建目录时直接加载源码。修改源码后执行 `pnpm build`，或删除已有的 `dist/` 后启动。

```sh
pnpm check
pnpm test
pnpm build
pnpm pack:dir      # 当前平台未打包的可运行目录
pnpm dist:linux    # AppImage + deb
pnpm dist:mac      # dmg，建议在 macOS 构建
pnpm dist:win      # NSIS，建议在 Windows 构建
```

桌面窗口初始尺寸 540 × 580，支持拖动标题区域、调整窗口大小、最小化与关闭。保留 Linux / Windows / macOS 通用的窗口逻辑，不依赖系统毛玻璃、系统字体下载、绝对素材路径或原生 Node 插件。Linux 使用系统默认的 Chromium / Electron 平台后端，适配 X11 / Wayland；发行包仍需在目标系统实测。桌面端启用 sandbox、contextIsolation，并通过受限 preload 提供两个窗口操作。

## 交互

- 左上状态按钮与电台 / 喜欢 / 歌手菜单共用一个连续胶囊外形，以 280ms 高度过渡展开和收起；菜单选项淡入，关闭后不可聚焦。鼠标悬停或键盘聚焦时显示名称。支持方向键选项和 Escape 收起。
- 电台、喜欢直接换队列并进入演示播放；喜欢列表与音量、播放顺序保存在本机。取消最后一首喜欢后显示空态。
- 歌手搜索已移除英文标题、推荐提示与结果数量，关闭按钮合并到搜索栏。
- 歌手模式在中央显示搜索；支持中文、英文名、拼音，每位歌手一行，左侧头像，右侧名称和关注人数，点选歌手后回到播放器。
- 底部五键依次为列表循环 / 随机 / 单曲循环、上一首、播放 / 暂停、下一首、播放队列。上一首在进度大于三秒时先回到开头。
- 右上音量弹层支持静音，歌曲右侧爱心切换喜欢。队列支持点选歌曲、遮罩与 Escape 关闭，并管理键盘焦点。
- 页面空白处聚焦时：空格播放 / 暂停，左右方向键切歌。按钮保留标准键盘行为，进度条方向键只调整进度。
- 背景从当前封面取色并适度压暗，配合白色控制图标与白色播放键；切歌时跟随封面变化。无法读取封面像素时保留上一次主题。
- 已移除底部的来源 / 序号状态行，收紧封面、歌曲信息与控制区间距。
- 窄窗口自适应，支持减少动态效果的系统偏好；图标按钮均提供屏幕阅读器标签。

## 后续接入 qq-music-api

`src/data.js` 中 `demoProvider` 是数据边界。界面只消费归一化的歌手和歌曲记录，切换成真实 provider 时保留这四个异步方法：

| 方法 | 返回值 / 对应现有后端能力 |
| --- | --- |
| `searchArtists(query)` | 歌手数组；现有 `/getSearchByKey` 服务固定 `t: 0`，接入歌手搜索前需扩展后端检索类型 |
| `getArtistTracks(artistId)` | 歌曲数组；对应 `/getSingerHotsong/:singermid` |
| `getRadioTracks()` | 歌曲数组；对应 `/getRadioLists` 后选择电台、获取其歌曲 |
| `getLikedTracks(ids)` | 歌曲数组；当前本机收藏，后续决定 QQ 收藏同步方案 |

歌手记录：`{ id, name, en, initial, avatarUrl, followerCount, color }`。`avatarUrl` 用于歌手头像，当前离线数据为空时保留首字头像；`followerCount` 为 QQ 音乐返回并归一化的非负整数，未知时显示“— 人关注”，不使用虚构粉丝数。真实接入时可使用 `/getSingerStarNum?singermid=...` 获取数据并依据实际响应映射。歌曲记录：`{ id, title, artist, artistId, album, duration, art }`。真实 provider 还需补充播放 URL、封面 URL、登录态、失败与加载状态，并按后端实际响应处理歌手搜索参数及电台曲目；当前没有猜测或调用未验证的接口。

代码结构：`src/app.js` 管视图与事件，`src/player.js` 管队列 / 顺序 / 进度，`src/data.js` 管演示数据，`electron/` 管窗口与安全桥接。`tests/` 覆盖队列、播放顺序、搜索及数据来源切换。

封面文件 `assets/coast.jpg` 由内置 image_gen 生成。提示词与资源说明见 [assets/README.md](assets/README.md)。

## 本次验证

2026-10-25：更新为紧凑布局、白色按钮与封面取色背景。JavaScript 语法检查、6 项单元测试、静态构建和离线 HTML 导出通过。浏览器检查确认切歌后背景取色变化、底部状态行移除、白色播放键，覆盖来源切换、歌手搜索与选择、队列选曲、收藏及其空态；380 × 520 窗口无横向溢出，搜索结果滚动区不遮挡底部控件，浏览器未记录警告或错误。

Electron 原生启动尚未验证：执行环境没有 DISPLAY / WAYLAND_DISPLAY；尝试生成 Linux 可运行目录时，Electron 发行文件下载连接超时，未生成安装包。请在可访问 Electron 下载源的 Linux 桌面中运行 `pnpm start` / `pnpm pack:dir`，再进行系统与发行格式验证。

`output/player.jpg`、`output/artist-search.jpg`、`output/queue.jpg`、`output/mode-menu.jpg` 为浏览器设计预览截图。
