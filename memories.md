# telegram-claude-mcp 项目记忆

## 重要提醒

**每次修改完项目要记得更新这个 memories.md 文件！**

## 项目基本信息

- **npm 包名**: mcp-telegram-claudecode
- **GitHub**: https://github.com/EthanSky2986/mcp-telegram-claudecode
- **当前版本**: 1.4.0
- **作者**: EthanSky
- **许可证**: MIT

## 发布渠道

- npm: `npx -y mcp-telegram-claudecode`
- GitHub Releases: 每次更新需同步发布 release 包
- Reddit 推广帖: https://www.reddit.com/r/ClaudeAI/comments/1qvg57k/

## 版本历史要点

| 版本 | 日期 | 主要更新 |
|------|------|----------|
| 1.0.0 | 2026-02-01 | 初始发布，基础消息收发 |
| 1.1.0 | 2026-02-02 | 添加 telegram_check_new 工具 |
| 1.2.0 | 2026-02-03 | 自动轮询 + SendKeys 终端注入 (Windows) |
| 1.3.0 | 2026-02-04 | 发送图片功能 + 代理支持 |
| 1.3.1 | 2026-02-04 | 修复并发轮询导致的消息重复问题 |
| 1.4.0 | 2026-02-04 | 锁文件机制 + 注入失败通知 + Hooks远程权限 + WriteConsoleInput无焦点注入 |

## 技术实现

### 终端注入方法 (v1.4.0)

使用 Windows API `WriteConsoleInput` 实现无焦点注入：
1. PowerShell 脚本继承 Node.js MCP 的控制台
2. 通过 `GetStdHandle(STD_INPUT_HANDLE)` 获取控制台输入句柄
3. 通过 `WriteConsoleInput()` 直接写入控制台输入缓冲区
4. 不需要窗口焦点，不使用剪贴板

**限制**：单终端模式 - 多个终端窗口时可能注入到错误窗口（Windows Terminal ConPTY 架构限制）

### Hooks 远程权限批准

- `hooks/pretool-approval.js` - PreToolUse hook，拦截敏感操作发送到 Telegram 等待批准
- `hooks/posttool-notify.js` - PostToolUse hook，执行后通知
- 配置方法见 `hooks/README.md`

## 已解决的问题 (v1.4.0)

- [x] 锁文件机制防止多实例冲突
- [x] 注入失败通知到 Telegram
- [x] 无焦点注入 (WriteConsoleInput)
- [x] Hooks 远程权限批准方案

## 已知限制

1. **平台支持**: Windows 完整支持，macOS/Linux 仅工具可用，无自动注入
2. **单终端模式**: 多个终端窗口时可能注入到错误窗口（Windows Terminal ConPTY 限制）
3. **消息可能丢失**: 快速连续发送消息时，部分消息可能未被注入（轮询间隔问题）

## 未来改进方向

- [ ] macOS/Linux 注入支持
- [ ] 失败消息队列和重试
- [ ] 多会话支持

## 相关资源

- **Claude Code Hooks 文档**: 可用于实现远程权限批准
- **类似项目参考**:
  - teleportation.dev - Web 端远程控制
  - ccremote.dev - Discord 端远程控制

## 开发备忘

- 更新 npm 时记得同步发布 GitHub release
- 不要删除旧版本的 release
- Reddit 发帖要用人类语气，避免 AI 味，不用 markdown 格式
- 所有回复都要同步发送到 Telegram
- **每次修改完项目要记得更新 memories.md 文件**

## 配置路径

- 项目位置: `D:\ClaudeCode\telegram-claude-mcp`
- MCP 配置: `C:\Users\EthanSky\.claude.json` 中的 telegram 服务器配置
