# Hermes × Amadeus 桌面插件（预览版）

在 Hermes 桌面版右侧提供独立 Amadeus 第四栏，复用已有聊天、字幕、角色、语音、记忆、B站面板和 Hermes 上下文协同界面。保留 Files 和原有工作区域。插件不内置模型、角色美术、游戏语音或任何用户数据。

**此包需要已配置好的、支持第四栏接口的本地 Amadeus 后端，不是独立运行的聊天服务。普通上游 Amadeus / 当前仓库主分支的后端尚不保证兼容。** 后端接口和人格表现仍在开发；公开插件不代表所有功能均已实机验收。

语音使用本地 **GPT-SoVITS V3**，不采用 Fish 或本地/Fish 混合路由。后端全局 `TTS_BACKEND` 应为 `gpt_sovits`，两位角色各自的 `runtime/characters/<角色>/voice.json` 也应选择此后端，避免角色配置覆盖全局设置。`examples/` 提供无密钥的绑定示例；修改已有绑定时保留自己的参考音配置并先备份。千枝实的 `chiemi_v1` 是既有音色配置名，实际推理使用 V3 的 `s2Gv3.pth`；红莉栖使用 `kurisu_v3`。权重和参考音须自行准备，不随插件发布。

## 安装

1. 使用支持运行时 `plugin.js`、`SandboxedFrame`、会话归属和 `profileRoutes` SDK 的 Hermes Windows 桌面版。开发验证宿主为 v0.21.7；其他版本未验证。
2. 准备本地 Amadeus：能够产生 `runtime/hermes-desktop/connection.json`，并提供认证的 `/hermes/ui/ws`；准备自行取得合法使用权的 SpriteForge 角色资源及渲染器 vendor 文件。不要上传连接描述文件。
3. 将本目录的 `plugin.js`、`LICENSE`、`THIRD_PARTY_NOTICES.txt` 放到 `$HERMES_HOME/desktop-plugins/amadeus-fourth-pane-prototype/`。默认 Hermes home 为 `%LOCALAPPDATA%/hermes`。已有同名插件请先备份；不要同时安装两个副本。
4. 由 Hermes 的插件管理功能重新加载插件。在第四栏“连接设置”填写本机 Amadeus 的完整 Windows 安装目录，点击“保存并连接”。配置仅保存在 Hermes 为本插件提供的本地存储中；不用填写模型密钥。
5. 后端运行后即可连接。只有本地 Amadeus 已配置 `runtime/hermes-desktop/Start Amadeus with Hermes.lnk` 时，才启用“打开第四栏时启动”选项。该启动器由本机 Amadeus 管理其进程，插件不会安装后台服务或修改 Hermes 快捷方式。

这是用户主动安装的受信任本地插件，**尚未提交或通过 Hermes 官方插件目录审核**。使用本地文件桥接和包含现有渲染脚本的隔离 Frame，不承诺通过目录的 SDK-only 静态准入检查。

## 权限与费用

- 宿主读取指定安装目录的本地连接描述和构建时登记的角色资源。UI 凭据仅留在宿主，不交给人物 Frame；人物 Frame 只接收立绘事件和登记资源。
- 用户授权后，由已有 Amadeus 后端同步本机 Hermes 会话；主动接话、打断、麦克风和模型调用沿用现有开关、授权及后端配置。安装插件本身不会开始读取聊天或监听麦克风。
- 模型、TTS、B站等联网和费用由用户自己的后端及 Provider 配置决定；插件不是免费模型服务，也不捆绑密钥。不要将后端监听到公网。
- 公开包不自动停止 Wallpaper Engine 或替换用户的壁纸进程；壁纸入口调用原后端配置。
- 禁用或移除插件只撤除界面，不删除记忆、登录凭据、素材或模型。

## 从源码构建

在本仓库根目录保存源码；本目录 `src` 直接复用 `electron/src/renderer` 的既有组件与 `render/web/renderer.js`，没有另外实现聊天后端。构建需要 Node.js 和本目录声明的 esbuild / qrcode。可在已有安装中复用工具，不必安装大型依赖：

```powershell
# 指向包含 esbuild、qrcode 的现有 package.json；不设置则使用 desktop/package.json。
$env:HERMES_BUILD_PACKAGE = '你的 Hermes 源码目录/package.json'
node desktop/build.mjs
node --experimental-vm-modules --test desktop/tests/*.test.mjs
```

构建扫描本机 `assets/spriteforge/runtime/{kurisu,chiemi}` 的 KTX2 路径，仅将相对资源清单和渲染代码写入 `plugin.js`，不包含贴图、音频、模型和聊天。角色资源版本变化后需要重新构建。源码构建需要独立获取这些素材，仓库不会分发它们。

公开预览保留旧版千枝实渲染兼容性，不代表旧美术已通过视觉验收；新模型正式接入仍需用户批准。人格一致性、语音听感、实际画面、切换速度与真实 Hermes 协同需要后续实机验收。

## 验证范围

- PASS：可移植构建；路径、登记资源、远程连接拒绝、启动选择、取消等待的离线检查；打包内容隐私扫描。
- REAL_ONLY：新安装的 Hermes 与独立后端端到端连接、实际声音、角色视觉及人格自然度。
- BLOCKED：官方目录准入与通用后端独立安装包，尚未交付。

AGPL-3.0：见随包 LICENSE。第三方代码及依赖说明见 THIRD_PARTY_NOTICES.txt。角色名称仅用于描述兼容性，本项目不代表相关原作或 Hermes 官方。
