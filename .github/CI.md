# CI 与发布

工作流为 `.github/workflows/ci.yml`；所有第三方 Actions 固定到已解析的提交 SHA。
Node/pnpm 安装集中在 `.github/actions/setup-project/action.yml`，依赖按锁文件安装，pnpm store 按操作系统、架构、Node 版本和锁文件隔离缓存，不缓存登录资料或签名密钥。

## 触发与检查

| 触发 | 检查与打包 | Android 签名 | 发布 |
| --- | --- | --- | --- |
| Pull request，包括 fork | 完整流程 | 临时 CI 密钥，debug APK | 不发布 |
| 推送 `main` / `master` | 完整流程 | 临时 CI 密钥，debug APK | 不发布 |
| 手动运行 `CI` | 完整流程，可额外勾选 `live_api` | 临时 CI 密钥，debug APK | 不发布 |
| 推送 `v<package.json version>` 标签 | 完整流程 | 固定正式密钥，非 debug APK | 全部平台成功后发布 |

标签与 `package.json` 的版本必须完全一致；Android `versionCode` 必须为正整数。工作流先运行 actionlint，再在 Ubuntu 24.04 / Windows Server 2022 × Node.js 22 / 24 的四个组合上进行 JavaScript 语法检查、后端和 Android TypeScript 检查、全部离线测试及前端/后端构建。测试包括认证、收藏、播放器、Android 本地服务、桌面生命周期和发布流程；播放测试分别使用 LF 和 Windows CRLF 源码验证启动及播放，避免依赖 Git 的换行配置。JUnit 报告作为独立 artifact 保留 14 天。

actionlint 会调用 PATH 中的 ShellCheck 检查 Bash 脚本；缺少 ShellCheck 时会跳过这项检查，因此 CI 会先确认它可用。本地复现工作流检查时，也应先安装 Go 和 ShellCheck，再在仓库根目录运行：

```sh
shellcheck --version
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.11 -color
```

普通提交和 PR 会取消同一分支过时的构建，版本标签的发布流程不会因新运行而被取消。建议将唯一汇总检查 `CI status` 设为必需的分支保护检查；它会在依赖失败或被取消时失败。

`live_api` 只在手动勾选时调用现有 `pnpm test:integration`，验证真实 QQ 音乐搜索、分页、电台、推荐、歌词及可播放音频。日常测试使用本地服务和上游替身，不依赖 QQ 音乐网络和账号权限。

## 平台产物与验证

| Artifact | 内容 | 额外验证 |
| --- | --- | --- |
| `packages-windows-x64` | NSIS 安装版、portable EXE、SHA256 | PE 架构、ASAR/许可证、使用内置 Electron 启动 API、静默安装/卸载、保留用户数据 |
| `packages-windows-arm64` | ARM64 NSIS 安装版、portable EXE、SHA256 | PE 架构、ASAR 文件及许可证；x64 runner 不运行 ARM64 程序 |
| `packages-linux-x64` | deb、rpm、AppImage、SHA256 | 包元数据、ELF/ASAR/许可证、内置 API；解包 AppImage 后再次启动 API，无需 FUSE |
| `packages-android-arm64` | APK、SHA256 | 签名、zipalign、包版本、最低 API、debug 状态、DEX、ARM64 ELF、内置 runtime.zip 及其校验和和许可证 |

Actions artifacts 保留 14 天，已压缩安装包不再进行高压缩。桌面 API 冒烟测试验证健康检查、令牌拒绝与未登录状态，使用独立临时认证目录，不请求上游。ARM64 桌面包不在 x64 runner 上运行。Android 的现有离线运行时测试和 APK 检查不包含模拟器或真机 UI 测试；当前 APK 只有 ARM64 原生库，Node.js Mobile 18.20.4 仍要求 4 KB 内存页设备。

Android 构建固定 JDK 17、API 35、build-tools 35.0.0、NDK 29.0.14206865；Node.js Mobile 压缩包固定版本和 SHA256，并在解压前校验。缓存只保存该压缩包。

## 正式签名配置

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 必需 | 用途 |
| --- | --- | --- |
| `QQMUI_ANDROID_KEYSTORE_BASE64` | 发布时必需 | PKCS12 签名密钥文件的 Base64 |
| `QQMUI_ANDROID_KEYSTORE_PASSWORD` | 发布时必需 | 密钥库密码 |
| `QQMUI_ANDROID_KEY_ALIAS` | 可选 | 密钥别名，默认 `qqmui` |
| `QQMUI_ANDROID_KEY_PASSWORD` | 可选 | 私钥密码，默认与密钥库密码相同 |
| `WINDOWS_CERTIFICATE_BASE64` | 可选 | electron-builder 支持的 PFX 证书 Base64；未配置时 Windows 包不签名 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 可选 | PFX 密码 |

Android 必须沿用已分发 APK 的签名密钥，才能覆盖安装并保留应用数据。本机原有密钥默认位于 `~/.local/share/qqmui/android-signing.p12`。例如在 Linux 上通过 GitHub CLI 设置已有密钥，不将密钥内容写入终端：

```sh
base64 -w0 ~/.local/share/qqmui/android-signing.p12 | gh secret set QQMUI_ANDROID_KEYSTORE_BASE64
gh secret set QQMUI_ANDROID_KEYSTORE_PASSWORD
# 自定义别名时再配置
gh secret set QQMUI_ANDROID_KEY_ALIAS
```

发布密钥只提供给标签发布的 Android job；Windows 证书只提供给标签发布的 Windows 构建步骤。密钥临时解码到 runner temp，工作流结束前删除；只导出文件路径，不将密码或 Base64 写入 Actions 环境文件或 artifacts。缺少 Android 正式签名配置会直接令发布构建失败，不生成临时密钥替代。普通 CI 的预览密钥每次运行独立，因此预览 APK 不能保证覆盖安装之前的预览或正式版本。

## 版本发布

1. 修改 `package.json` 的 `version`，同步依赖变更时更新并提交 `pnpm-lock.yaml`；Android 版本更新还需递增 `android/AndroidManifest.xml` 的 `android:versionCode`。APK 的 `versionName` 由构建脚本从 `package.json` 注入。
2. 合并通过 CI 的改动后创建相同版本的标签，例如版本为 `1.1.0` 时：

   ```sh
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. 等待四个测试组合以及全部平台打包、冒烟检查通过。Release job 只从同一次工作流下载 `packages-*` 产物，要求八个安装包及四份对应校验文件齐全，重新验证每个 SHA256，并生成汇总 `SHA256SUMS` 和记录版本、提交、Android versionCode、架构、文件大小及哈希的 `build-manifest.json`。
4. 工作流创建 draft Release，上传全部 14 个附件并成功后才公开发布。上传中断时保留 draft，可重跑失败的 job；已公开的 Release 不会被覆盖。版本包含 `-`（例如 `1.1.0-beta.1`）时标记为 prerelease，并且不更新 latest。

无需额外 PAT：仅 Release job 给 `GITHUB_TOKEN` 授予 `contents: write`，其他 job 使用只读权限。`workflow_dispatch` 即使选择标签也不会发布。若 artifacts 已超过保留期，应重跑完整工作流后重试发布。
