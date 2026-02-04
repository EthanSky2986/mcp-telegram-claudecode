# MCP-Telegram-ClaudeCode

[![npm version](https://img.shields.io/npm/v/mcp-telegram-claudecode.svg)](https://www.npmjs.com/package/mcp-telegram-claudecode)
[![npm downloads](https://img.shields.io/npm/dm/mcp-telegram-claudecode.svg)](https://www.npmjs.com/package/mcp-telegram-claudecode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

一个 MCP（Model Context Protocol）服务器，让 Claude Code 能够通过 Telegram 发送和接收消息。这样你就可以通过 Telegram 远程与 Claude Code 交互。

## 功能特性

- 从 Claude Code 发送文字消息到 Telegram
- 在 Claude Code 中接收 Telegram 消息
- 发送图片/截图到 Telegram
- 支持代理（适用于无法直接访问 Telegram 的地区）

## 前置要求

- [Node.js](https://nodejs.org/) 18.0.0 或更高版本
- 已安装 [Claude Code](https://claude.ai/code)
- 一个 Telegram 账号

## 快速开始

### 第一步：创建 Telegram 机器人

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 命令
3. 按照提示为你的机器人起名
4. **保存机器人 Token** - 格式类似：`1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### 第二步：获取你的 Chat ID

1. 打开 Telegram，搜索 [@userinfobot](https://t.me/userinfobot)
2. 给这个机器人发送任意消息
3. **保存返回的 `Id` 值** - 格式类似：`123456789`

### 第三步：启动你的机器人

**重要：** 在 Claude Code 能接收你的消息之前，你必须先和你的机器人开始对话：
1. 在 Telegram 中搜索你的机器人用户名
2. 点击"开始"或发送任意消息

### 第四步：配置 Claude Code

将 MCP 服务器添加到你的 Claude Code 配置中。

**方式 A：使用 Claude Code 设置命令**
```bash
claude /settings
```
然后添加 MCP 服务器配置。

**方式 B：直接编辑配置文件**

配置文件位置：
- Windows: `%USERPROFILE%\.claude.json`
- macOS/Linux: `~/.claude.json`

---

## 配置示例

### 不使用代理

如果你可以直接访问 Telegram：

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "mcp-telegram-claudecode"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
        "TELEGRAM_CHAT_ID": "123456789"
      }
    }
  }
}
```

### 使用代理

如果你需要代理才能访问 Telegram：

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "mcp-telegram-claudecode"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
        "TELEGRAM_CHAT_ID": "123456789",
        "HTTP_PROXY": "http://127.0.0.1:7890"
      }
    }
  }
}
```

**常用代理端口：**
- Clash: `http://127.0.0.1:7890`
- V2Ray: `http://127.0.0.1:10808`
- Shadowsocks: `http://127.0.0.1:1080`

请替换为你实际的代理地址和端口。

---

## 环境变量

| 变量名 | 是否必需 | 说明 |
|--------|----------|------|
| `TELEGRAM_BOT_TOKEN` | 是 | 从 @BotFather 获取的机器人 Token |
| `TELEGRAM_CHAT_ID` | 是 | 从 @userinfobot 获取的 Chat ID |
| `HTTP_PROXY` | 否 | HTTP 代理地址（如 `http://127.0.0.1:7890`） |
| `HTTPS_PROXY` | 否 | HTTPS 代理地址（HTTP_PROXY 的替代选项） |

---

## 可用工具

配置完成后，Claude Code 将可以使用以下工具：

### telegram_send_message
发送文字消息到你的 Telegram。
```
参数：
- message（必需）：要发送的文字消息
```

### telegram_get_messages
获取 Telegram 的最近消息。
```
参数：
- limit（可选）：获取消息的最大数量（默认：10）
```

### telegram_check_new
快速检查是否有新消息。
```
无需参数
```

### telegram_send_photo
发送图片文件到 Telegram。
```
参数：
- photo_path（必需）：图片文件的绝对路径
- caption（可选）：图片说明文字
```

---

## 使用示例

配置完成后，你可以让 Claude Code：

- "在 Telegram 上给我发消息说任务完成了"
- "检查一下我在 Telegram 上有没有发新消息"
- "把当前代码的截图发到我的 Telegram"

---

## 常见问题

### "TELEGRAM_BOT_TOKEN must be configured"
确保你已经在 `.claude.json` 配置文件中添加了机器人 Token。

### 发了消息但显示"No new messages"
1. 确保你已经先和机器人开始了对话
2. 检查 `TELEGRAM_CHAT_ID` 是否正确
3. 如果使用代理，确认代理正常工作

### 连接超时或网络错误
如果你在无法直接访问 Telegram 的地区：
1. 确保代理软件正在运行
2. 在配置中添加 `HTTP_PROXY` 环境变量
3. 确认代理端口正确

### 机器人没有响应
1. 检查机器人 Token 是否正确（没有多余空格）
2. 确保你已经和机器人开始了对话
3. 先给机器人发一条消息，然后再检查消息

---

## 工作原理

### 架构

这个 MCP 服务器充当 Claude Code 和 Telegram 之间的桥梁：

```
┌─────────────┐     MCP 协议         ┌─────────────────┐     Telegram API     ┌──────────┐
│ Claude Code │ ◄──────────────────► │ MCP 服务器      │ ◄─────────────────► │ Telegram │
│             │                       │ (本项目)        │                      │          │
└─────────────┘                       └─────────────────┘                      └──────────┘
```

### 自动轮询与终端注入（实验性功能）

MCP 服务器启动时会自动开始轮询 Telegram 新消息。收到消息后，会尝试将文本注入到活动的终端窗口：

1. **剪贴板**：消息被复制到系统剪贴板
2. **SendKeys (Windows)**：PowerShell 脚本模拟 Ctrl+V 和 Enter 按键
3. **窗口激活**：尝试查找并激活终端窗口（Windows Terminal、cmd、PowerShell、VS Code）

**这是一个实验性功能** - 它可以实现通过 Telegram "远程控制" Claude Code，但存在可靠性限制。

### 可用工具

| 工具 | 说明 |
|------|------|
| `telegram_send_message` | 发送文字到 Telegram |
| `telegram_get_messages` | 获取最近消息 |
| `telegram_check_new` | 快速检查新消息 |
| `telegram_send_photo` | 发送图片到 Telegram |
| `telegram_start_polling` | 手动启动自动轮询 |
| `telegram_stop_polling` | 停止自动轮询 |

---

## 已知问题与限制

### ⚠️ 多个 Claude Code 实例

**问题**：如果运行多个 Claude Code 窗口，每个都会启动自己的 MCP 服务器实例。所有实例都会轮询同一个 Telegram 机器人，导致：
- 消息重复处理
- 多次注入尝试
- 重复回复

**解决方法**：使用 Telegram 集成时只运行一个 Claude Code 实例，或在其他实例中禁用 Telegram MCP。

### ⚠️ SendKeys 可靠性 (Windows)

终端注入功能依赖于：
- **窗口焦点**：目标终端必须可以被激活
- **剪贴板访问**：系统剪贴板必须可用
- **时序控制**：SendKeys 需要精确的时序

**可能失败的情况**：
- 其他应用程序占用焦点且不释放
- 系统负载过高
- 远程桌面或虚拟机环境
- 屏幕被锁定

**解决方法**：如果注入失败，可以手动使用 `telegram_get_messages` 工具检查消息。

### ⚠️ 平台支持

- **Windows**：完整支持（自动轮询 + SendKeys 注入）
- **macOS/Linux**：部分支持（工具可用，但未实现自动注入）

### ⚠️ 非完全无人值守

这个 MCP 无法主动唤醒 Claude Code。自动注入只在以下情况下有效：
- Claude Code 正在运行并等待输入
- 终端窗口可以被访问

如需真正的无人值守操作，请考虑使用 Claude Code 的 Hook 系统。

---

## 计划改进

- [ ] 锁文件机制防止多实例冲突
- [ ] 注入失败重试逻辑
- [ ] 通过 Telegram 发送失败通知
- [ ] 失败消息队列
- [ ] macOS/Linux 注入支持

---

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 作者

EthanSky

## 仓库地址

https://github.com/EthanSky2986/mcp-telegram-claudecode
