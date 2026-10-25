# qqmui 内置 API

本目录从当前本地 `qq-music-api` 工作副本裁剪而来，基础提交为
`d05420bf098bd2769866eba81cfd48a6d0c6f50c`，来源为
<https://github.com/Rain120/qq-music-api>，并包含当前工作副本的认证、收藏和电台扩展。
原作者 Rain120；原始 MIT 许可全文保存在 `LICENSE`。

只保留当前 `src/api.js` 使用的接口：

- `GET /getHotkey`、`/getSmartbox`、`/getSingerList`、`/getSingerHotsong`、`/getSingerStarNum`
- `GET /getRadioLists`、`/getRadioTracks`、`/getRecommend`
- `GET /getMusicPlay`、`/getLyric`、`/getSongInfo`
- `GET /auth/status`、`/user/favorites`
- `POST /auth/qr`、`/auth/qr/check`、`/auth/logout`、`/user/favorites`

`GET /health` 仅供启动器检查服务，不访问上游。未包含 Explorer、下载、MV、排行榜、
专辑、批量接口或 Cookie 管理接口。推荐请求只拉取播放器消费的 `new_song`。

`src/app.ts` 创建 Koa 应用，`src/routes` 注册精确路径，控制器继续调用服务和工具。
`src/server.ts` 绑定 `127.0.0.1`，默认让系统分配空闲端口，向父进程报告
`{ type: 'ready', origin }`。设置 `QQMUI_API_TOKEN` 后，每个请求都必须携带
`X-QQMUI-Token`；此令牌仅在应用进程间传递。

QQ 扫码、音乐凭据交换、刷新及收藏写入回读确认沿用来源仓库的当前实现。
凭据使用 SessionStore 加密保存，目录由 `QQ_MUSIC_AUTH_DIR` 指定；未设置时兼容原有
`~/.local/share/qq-music-api/auth`。客户端只得到不透明的 HttpOnly 会话标识。

此处代码许可不授予 QQ 音乐服务、歌曲、歌词、封面或商标的使用权。原项目 README
同时声明仅供学习、不可商业使用；发行前应结合上游服务条款及权利人的授权说明处理。
