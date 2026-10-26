# qmplay 前端架构

桌面 Electron、Android WebView 和浏览器开发共用 React + TypeScript 前端。平台外壳继续提供本地 API、安全会话与原生媒体能力，后端保持原有 Koa controller/service 分层。

## 从启动到播放

```text
index.html → main.tsx → createApplication({ provider, audio, storage })
                             ↓
                    ApplicationStore 快照
                             ↓ useSyncExternalStore
                         React App
                             ↓ 显式操作
                 播放 / 浏览 / 导航控制器
                             ↓
        QQMusicProvider / PlayerSession / AudioTransport
                             ↓
              同源 /api → 内置 Koa → QQ 音乐
```

`index.html` 仅保留元信息、CSP、资源入口和 React 根节点。`main.tsx` 检测可播放音频格式、建立存储/provider/application 依赖并挂载 React，不承担业务或模板渲染。

## 模块职责

| 位置                                                | 职责                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `src/contracts.ts`                                  | 歌曲、歌手、专辑、来源、认证状态、应用快照及显式操作的共享类型      |
| `src/api.ts`                                        | HTTP、错误映射、上游响应校验与归一化、音质探测                      |
| `src/player.ts`、`src/audio.ts`                     | 队列/顺序/历史规则，以及真实媒体时钟、加载与播放取消                |
| `src/auth.ts`、`src/favorites.ts`、`src/storage.ts` | 登录轮询、按账号收藏同步、兼容旧数据与安全持久化                    |
| `src/application/application.ts`                    | 创建控制器，协调认证、收藏和启动恢复                                |
| `src/application/playback.ts`                       | 来源切换、队列分页、自动切歌与竞态保护                              |
| `src/application/catalog.ts`                        | 搜索、关注人数、专辑、电台及歌词请求生命周期                        |
| `src/application/navigation.ts`                     | 页面与播放来源分离、移动页面挂起/恢复、菜单和队列导航               |
| `src/application/store.ts`                          | 可订阅状态与稳定快照，阻止视图修改业务数据                          |
| `src/ui/`                                           | 播放器、导航、认证、目录、歌词、虚拟队列等 React 组件及界面 hooks   |
| `src/platform/`                                     | Media Session、Electron/Android 桥接、窗口/页面生命周期及响应式检测 |

## 状态与生命周期

应用快照分别描述播放、导航、认证、目录、收藏、请求、歌词和通知。组件调用 `MusicApplication` 的显式操作，不直接修改 `PlayerSession` 或上游响应。应用层可以在没有浏览器 DOM 的情况下运行和测试。

`useSyncExternalStore` 在状态没有发布更新时读取同一个快照。快照与控制器的可变工作数据隔离，避免 React 渲染过程中读取一半更新的数据。

浏览搜索、专辑、收藏、电台或歌词不会替换当前播放来源。只有明确播放操作才切换队列。移动端返回播放器时保留浏览页面及列表滚动位置；请求使用取消信号和版本检查，旧响应不能覆盖新选择。

React 平台 hook 管理应用启动/停止、媒体按键、返回键、焦点/联网刷新和页面生命周期。组件负责清理自己的观察器、事件和计时器。认证凭据仍保存在后端，前端只处理会话状态及业务数据。

## 构建与测试

`scripts/build-frontend.mjs` 使用 esbuild 将 `src/main.tsx` 及其依赖编译为 `src/app.js` 和 `src/app.css`，并复制 HTML、素材及实际打包依赖的许可证。桌面、Android、浏览器开发调用同一个构建函数，发布端不复制 TS/TSX 源码。

- `pnpm dev`：编译并监听前端，启动私有内置 API 与浏览器预览服务；变更后刷新页面。
- `pnpm check`：脚本语法及前端、后端、Android TypeScript 检查；esbuild 本身不做类型检查。
- `pnpm test`：现有 Node 离线测试，加上直接注入依赖的控制器回归与 jsdom 中真实 React DOM 事件测试。
- `pnpm build`：编译共享界面和 API，生成桌面应用目录。

Node 测试通过 `scripts/register-typescript.mjs` 转译被导入的 TS/TSX，并按源码扩展名解析 `.js` 模块引用。测试保留真实 ESM 导入语义，不再移除源码 import 或通过 VM 获取模块局部变量。前端构建测试还验证 CSP 入口、独立产物和依赖许可证。

新增功能时，在相应应用控制器中实现流程，在 `contracts.ts` 中声明必要的状态和操作，再增加 React 组件。优先复用现有 provider 与领域模块，并为行为和跨平台构建补充有意义的回归测试。
