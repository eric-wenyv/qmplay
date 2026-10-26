# qqmui

面向 Linux、Windows 和 Android 的极简 QQ 音乐播放器，内置精简的 `qq-music-api` 后端。

## 功能

- 私人电台／猜你喜欢：电台页面首项，使用当前登录账号获取个性化歌曲，播放到队尾时自动续载；公共频道目录暂时不可用时仍可进入。
- 每日新歌
- 公共电台
- 歌手搜索：默认使用原有列表显示最近访问的 10 位歌手，去重并保存在本机；输入搜索后显示搜索结果，清空输入恢复历史。
- 歌手专辑：点击歌手查看专辑，点击专辑播放整张专辑；顶部单行显示歌手图片、名字和全部歌曲播放按钮。
- 歌手全部歌曲和专辑歌曲按每页 50 首载入，接近队尾时自动预取下一页（随机播放在切歌时续载），不再截断为前 50 或 1000 首。分页请求合并、切换队列时取消旧请求，长队列只渲染可见区域附近的 60 行；队列、分页和进度可在重启后继续恢复。
- QQ 音乐收藏同步
- 桌面端左上角页面菜单提供主页、电台、收藏和歌手入口，点击「主页」返回播放界面。移动端菜单位于下半部右上角，仅保留电台、收藏和歌手三个入口；展开时背景虚化并阻止操作，点击遮罩关闭。
- 点击专辑封面查看歌词；点击歌词外的空白区域返回播放界面，点击歌词仍可跳转到对应进度。
- 独立播放队列：切换电台、歌手搜索、歌手专辑、收藏或歌词页面时继续播放；点击电台、专辑、歌手播放按钮、收藏歌曲或收藏页的「播放全部」才会替换队列。收藏同步和取消收藏不会删除队列中的歌曲，队列及进度会在重启后恢复（默认暂停）。
- 全平台播放队列仅保留中文标题、数量、歌曲列表和逐首移除操作，删除英文标题和底部操作栏；播放方式通过主界面轮盘切换。

私人电台沿用 `/getRadioTracks?id=99` 的路由和歌曲响应格式，服务端通过当前账号调用 `music.radioProxy.MbTrackRadioSvr/get_radio_track`（每批 5 首），使用现有登录刷新和会话隔离机制。其他电台继续使用公共频道接口；每日新歌继续使用原有新歌接口，不以它们替代个性化推荐。

## 运行

需要 Node.js 22.12+ 和 pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

浏览器调试运行 `pnpm dev`，访问 [本地页面](http://127.0.0.1:4173)。桌面版和浏览器调试均会自动启动内置后端。

## Linux 打包

```sh
pnpm install --frozen-lockfile
pnpm build:linux
```

构建机需安装 `rpmbuild`。脚本会检查代码、运行测试并构建，生成的 deb、rpm、AppImage 安装包及 SHA256 校验文件位于 `release/`。

## Windows 打包

在 Windows 或 Linux x64 上运行（需要 Node.js 22.12+ 和 pnpm 11.25.0）：

```sh
pnpm install --frozen-lockfile
pnpm build:windows
```

脚本先检查代码、运行全部测试并构建内置后端，再生成 Windows x64 安装版和免安装版：

- `release/qqmui-1.0.0-win-x64-setup.exe`：安装向导，可选择安装位置，创建桌面和开始菜单入口。
- `release/qqmui-1.0.0-win-x64-portable.exe`：直接运行，无需安装。
- `release/SHA256SUMS-windows-x64`：以上两个文件的 SHA256 校验值，不覆盖 Linux 的校验文件。

Windows 用户无需另装 Node.js 或部署 API。两种版本均将登录凭据和播放状态保存在当前用户的 `%APPDATA%/qqmui`，免安装版也会复用该目录；关闭窗口后继续在托盘运行，通过托盘「退出」结束播放。卸载默认保留用户数据。当前未配置代码签名证书，分发产物为未签名版本。

`pnpm dist:win` 为同一构建入口。需要 Windows ARM64 时运行 `pnpm build:windows --arm64`，产物和校验文件名中的 `x64` 相应替换为 `arm64`。Linux 交叉构建需先安装 Wine，并确保 `wine` 命令在 `PATH` 中；脚本会在构建前检查。首次构建需要联网下载 Electron 和 NSIS。也可使用包含 Wine 的 [electron-builder Docker 构建环境](https://www.electron.build/v26/docs/features/multi-platform-build/)。

仓库的 `CI` GitHub Actions 工作流会同时构建 Windows x64 和 ARM64 安装包、免安装包及校验文件。

## 检查

```sh
pnpm check
pnpm test
# 同时生成 output/test-results.xml，供 CI 收集 JUnit 报告
pnpm test:ci
```

## GitHub CI 与发布

PR、推送到 `main`/`master`、推送 `v*` 标签及手动运行均触发完整流水线：验证工作流与版本 → Linux/Windows × Node.js 22/24 检查和测试 → Windows、Linux、Android 并行打包 → 校验产物 → 上传 Actions artifacts。所有必需步骤的结果汇总为 `CI status`，可将其配置为分支保护检查。

Windows 生成 x64/ARM64 安装版和免安装版；Linux 生成 x64 deb、rpm、AppImage；Android 生成 ARM64 APK。非版本发布构建使用临时 CI 密钥签名的 debug 预览 APK。推送与 `package.json` 版本一致的标签（例如 `v1.0.0`）后，必须使用已配置的 Android 正式签名密钥；全部平台通过后，自动上传安装包、各平台校验文件、汇总 `SHA256SUMS` 和 `build-manifest.json`，然后发布 GitHub Release。预发布版本不会设为 latest。

首次发布前需配置 `QQMUI_ANDROID_KEYSTORE_BASE64`、`QQMUI_ANDROID_KEYSTORE_PASSWORD`，可选配置别名及 Windows 签名证书。具体触发条件、产物、检查范围和签名配置见 [CI 与发布文档](.github/CI.md)。

## Android 与移动端

移动端按手机实际宽高铺满可用区域，沿用封面取色和原有图标。上方显示封面或当前浏览页面；歌曲名称和浅色小字歌手排在同一行，下接无时间数字的进度条。下方轮盘直径约为屏幕宽度的 80%，左右留白缩小至原来约一半，并压缩封面上下间距；短屏或软键盘弹出时随可用高度收缩。轮盘中央播放/暂停、左右切歌、上方打开队列、下方切换播放方式；页面切换菜单保留在下半部右上角。桌面 Electron 界面保留原布局及时间显示。封面点击查看歌词、收藏和队列操作继续使用原有逻辑。

以下交互调整仅用于移动端：收藏等列表限制在屏幕宽度内，长歌曲名和歌手名省略显示，播放按钮保留独立空间。播放队列通过轮盘队列按钮进入，使用与收藏相同的列表页面，再次点击队列按钮或右滑返回播放主页。电台、收藏、歌手、专辑、歌词和队列页面均可右滑返回播放主页，再从主页左滑回到刚才的页面，保留搜索内容、列表位置和加载状态；下方页面菜单继续显示所选页面，不切换为主页图标。纵向滚动、搜索框操作和取消的手势不会触发切换。进入歌手页面只展示搜索栏和最近访问记录，点击搜索栏后才弹出输入法。轮盘按钮轻触后恢复普通外观，键盘操作保留焦点提示。桌面端保留主页菜单项、原有菜单交互、歌手搜索自动聚焦和队列侧栏，不启用左右滑动切页。

APK 内置 Node.js Mobile 和同一套 controller → service → util 后端，服务仅监听手机自身的回环地址，首次启动由原生活动写入私有访问凭据。无需部署远程 API，也无需 ADB 端口转发。登录凭据保存在应用私有目录，播放队列与进度保存在 WebView 本地存储；关闭后重开默认暂停。支持通知栏/耳机切歌、后台播放及 Android 返回键（先关闭队列或返回播放页）。从最近任务中划掉应用后结束播放。

构建需要 Linux、JDK 17+、Android SDK platform 35、build-tools 35.0.0+、NDK（推荐 29）、`curl`、`unzip` 和 `zip`。SDK 默认位于 `~/Android/Sdk`，可设置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，NDK 可由 `ANDROID_NDK_HOME` 指定。无需安装 Android Studio 或 Gradle。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build:android
# 构建、安装到当前唯一的 ADB 设备并启动
pnpm install:android
```

产物为 `release/qqmui-1.0.0-arm64.apk`，附带 SHA256 文件。当前构建面向 ARM64 手机，最低 Android 8.0；内置 Node.js Mobile 18.20.4 原始二进制只支持 4 KB 内存页设备，16 KB 页设备需要升级或重编该运行时。首次构建下载运行时并缓存于 `.cache/android/`。本地签名密钥生成并保存在 `~/.local/share/qqmui/android-signing.p12`，后续安装复用该密钥以保留应用数据；正式发行可通过 `QQMUI_ANDROID_KEYSTORE`、`QQMUI_ANDROID_KEYSTORE_PASSWORD`、`QQMUI_ANDROID_KEY_ALIAS` 指定自己的签名。该脚本用于本地 APK 分发，未配置应用商店发布。

歌曲播放权限及可用音质取决于 QQ 音乐账号和版权。第三方来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
