# qqmui

面向 Linux 的极简 QQ 音乐播放器，基于 Electron，内置精简的 `qq-music-api` 后端。

## 功能

- 每日推荐
- 公共电台
- 歌手搜索

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
./build.sh
```

构建机需安装 `rpmbuild`。脚本会安装依赖、检查代码、运行测试并构建，生成的 deb、rpm、AppImage 安装包及 SHA256 校验文件位于 `release/`。

## 检查

```sh
pnpm check
pnpm test
```

歌曲播放权限及可用音质取决于 QQ 音乐账号和版权。第三方来源与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
