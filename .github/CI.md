# CI 与发布

工作流入口为 [workflows/ci.yml](workflows/ci.yml)，环境安装封装在 [actions/setup-project/action.yml](actions/setup-project/action.yml)，校验与发布脚本位于 [../scripts/ci/](../scripts/ci/)。修改流程时以这些文件为准。

## 触发条件

所有触发都会执行检查，通过后构建 Linux、Windows 和 Android 安装包；只有推送版本标签才会创建 GitHub Release。

| 触发                                 | Android APK                              | GitHub Release             |
| ------------------------------------ | ---------------------------------------- | -------------------------- |
| Pull request，包括 fork              | 临时 CI 密钥签名的 debug 包              | 不发布                     |
| 推送 `main` / `master`               | 同上                                     | 不发布                     |
| 手动运行 `CI`（`workflow_dispatch`） | 同上，可勾选 `live_api` 追加真实上游测试 | 不发布，选择标签运行也一样 |
| 推送 `v<package.json version>` 标签  | 固定正式密钥签名的非 debug 包            | 所有必需阶段成功后发布     |

普通分支和 PR 的新运行会取消同一分支/PR 的旧运行；标签运行不自动取消。

## 执行阶段

| Job                             | 运行内容                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `metadata`                      | ShellCheck + actionlint 检查工作流；验证版本格式、标签与 `package.json` 完全一致，以及 Android `versionCode` 为有效正整数。 |
| `tests`                         | Ubuntu 24.04 / Windows Server 2022 × Node.js 22 / 24，共四个组合，依次运行 `pnpm check`、`pnpm test:ci`、`pnpm build`。     |
| `linux` / `windows` / `android` | 等待测试矩阵全部通过，再并行打包、校验并上传各平台产物，见下表。                                                            |
| `live-api`                      | 仅手动勾选 `live_api` 时，在测试通过后运行 `pnpm test:integration`。                                                        |
| `release`                       | 仅版本标签推送执行，等待全部平台打包成功后收集产物并发布。                                                                  |
| `status`                        | 始终汇总结果，显示为 `CI status`；必需阶段失败、取消或被跳过时失败，可选阶段失败或取消也会使其失败。                        |

日常测试使用本地服务和上游替身，覆盖认证、收藏、播放、Android 本地服务、桌面生命周期及发布流程；也覆盖 Windows CRLF 源码和 ASAR 路径分隔符差异。`live-api` 才会访问真实 QQ 音乐，验证搜索、分页、电台、推荐、歌词及可播放音频，结果受网络和账号权限影响。

分支保护可将汇总检查 **`CI status`** 设为必需检查。

## 构建产物与验证

| Artifact                 | 安装包（均附 SHA256 校验文件）       | 验证范围                                                                                   |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages-linux-x64`     | deb、rpm、AppImage                   | 包元数据、ELF 架构、ASAR 与许可证、内置 API；解包 AppImage 后再次启动 API，无需 FUSE。     |
| `packages-windows-x64`   | NSIS 安装版、portable EXE            | PE 架构、ASAR 与许可证、内置 API、静默安装/卸载及用户数据保留。                            |
| `packages-windows-arm64` | ARM64 NSIS 安装版、portable EXE      | PE 架构、ASAR 与许可证；x64 runner 不运行 ARM64 程序。                                     |
| `packages-android-arm64` | ARM64 APK；普通 CI 文件名带 `-debug` | 签名、zipalign、版本、最低 API、debug 状态、DEX、ARM64 ELF、`runtime.zip` 完整性及许可证。 |

构建环境与缓存规则：

- Node 默认使用 22，pnpm 版本取自 `package.json`（当前为 11.25.0）；依赖执行 `pnpm install --frozen-lockfile`。pnpm store 按系统、架构、Node 版本及锁文件隔离缓存。
- Android 固定 JDK 17、API 35、build-tools 35.0.0、NDK 29.0.14206865。Node.js Mobile 压缩包固定版本与 SHA256，解压前校验，缓存仅保留压缩包。
- 第三方 Actions 固定提交 SHA；缓存不保存登录资料或签名密钥。安装包 artifact 不额外压缩，所有包及独立 JUnit 报告保留 14 天。

## 发布前配置签名

在仓库 **Settings → Secrets and variables → Actions** 设置：

| Secret                             | 要求与用途                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `QMPLAY_ANDROID_KEYSTORE_BASE64`   | 发布必需，PKCS12 密钥库文件的 Base64。                                     |
| `QMPLAY_ANDROID_KEYSTORE_PASSWORD` | 发布必需，密钥库密码。                                                     |
| `QMPLAY_ANDROID_KEY_ALIAS`         | 可选，默认 `qmplay`。                                                      |
| `QMPLAY_ANDROID_KEY_PASSWORD`      | 可选，默认与密钥库密码相同。                                               |
| `WINDOWS_CERTIFICATE_BASE64`       | 可选，electron-builder 支持的 PFX 证书 Base64；未配置时 Windows 包不签名。 |
| `WINDOWS_CERTIFICATE_PASSWORD`     | PFX 证书的密码，按证书需要配置。                                           |

本地默认密钥为 `~/.local/share/qmplay/android-signing.p12`，也可用 `QMPLAY_ANDROID_KEYSTORE` 指定其他文件。首次正式发布后应妥善保存该签名密钥，后续版本继续使用，以支持覆盖安装并保留数据。

例如在 Linux 上通过 GitHub CLI 配置已有密钥，密码通过交互输入：

```sh
base64 -w0 ~/.local/share/qmplay/android-signing.p12 | gh secret set QMPLAY_ANDROID_KEYSTORE_BASE64
gh secret set QMPLAY_ANDROID_KEYSTORE_PASSWORD
# 使用自定义密钥别名时再配置
gh secret set QMPLAY_ANDROID_KEY_ALIAS
```

正式密钥仅用于标签发布：Android 密钥临时写入 runner temp 并在结束时清理，只向环境文件导出路径；Windows 证书只传给 Windows 构建步骤。密码和 Base64 不写入环境文件或 artifacts。缺少 Android 必需 Secrets 会使发布失败。普通 CI 使用每次运行独立的临时密钥，预览 APK 不保证能覆盖安装之前的预览或正式版本。

## 发布步骤

1. 修改 `package.json` 的 `version`；依赖有变更时同步提交 `pnpm-lock.yaml`。Android 版本更新还需递增 `android/AndroidManifest.xml` 中的 `android:versionCode`，APK 的 `versionName` 会自动取自 `package.json`。
2. 合并并确认 CI 通过，再推送与版本一致的标签。例如版本为 `1.1.0`：

   ```sh
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. 工作流等待四个测试组合及所有平台打包校验通过，从**同一次运行**下载 `packages-*`，验证八个安装包和四份校验文件，生成汇总 `SHA256SUMS` 与 `build-manifest.json`（版本、提交、Android versionCode、架构、大小及哈希）。
4. 创建 draft Release，全部 14 个附件上传成功后才公开。预发布版本（如 `1.1.0-beta.1`）标记为 prerelease，不更新 latest。

仅 `release` job 获得 `GITHUB_TOKEN` 的 `contents: write` 权限，其余 job 为只读，无需额外 PAT。

## 本地检查与失败处理

在根目录运行 `pnpm check`、`pnpm test:ci`、`pnpm build` 可复现测试矩阵的主要步骤。工作流语法检查另需 Go 和 PATH 中的 ShellCheck；缺少 ShellCheck 时 actionlint 会跳过 Bash 检查，因此先确认它可用：

```sh
shellcheck --version
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.11 -color
node scripts/ci/release.mjs --metadata
```

- **标签或签名校验失败**：核对版本、Android versionCode，以及 Secrets 名称、密码和密钥别名。
- **附件上传中断**：保留的 draft 可通过重跑失败 job 继续发布；artifact 超过 14 天保留期时，重跑完整工作流。
- **Release 已公开**：工作流拒绝覆盖，修复后使用新的版本与标签。
