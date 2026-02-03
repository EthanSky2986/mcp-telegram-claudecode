# MCP-Telegram-ClaudeCode

An MCP (Model Context Protocol) server that enables Claude Code to send and receive messages via Telegram. This allows you to interact with Claude Code remotely through your Telegram app.

## Features

- Send text messages from Claude Code to Telegram
- Receive messages from Telegram in Claude Code
- Send photos/screenshots to Telegram
- Proxy support for regions where Telegram is blocked

## Prerequisites

- [Node.js](https://nodejs.org/) 18.0.0 or higher
- [Claude Code](https://claude.ai/code) installed
- A Telegram account

## Quick Start

### Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the prompts to name your bot
4. **Save the bot token** - it looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Step 2: Get Your Chat ID

1. Open Telegram and search for [@userinfobot](https://t.me/userinfobot)
2. Send any message to this bot
3. **Save the `Id` value** from the response - it looks like: `123456789`

### Step 3: Start Your Bot

**Important:** Before Claude Code can receive your messages, you must start a conversation with your bot:
1. Search for your bot by its username in Telegram
2. Click "Start" or send any message to it

### Step 4: Configure Claude Code

Add the MCP server to your Claude Code configuration.

**Option A: Using Claude Code settings command**
```bash
claude /settings
```
Then add the MCP server configuration.

**Option B: Edit configuration file directly**

The configuration file is located at:
- Windows: `%USERPROFILE%\.claude.json`
- macOS/Linux: `~/.claude.json`

---

## Configuration Examples

### Without Proxy

If you can access Telegram directly:

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

### With Proxy

If you need a proxy to access Telegram:

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

**Common proxy ports:**
- Clash: `http://127.0.0.1:7890`
- V2Ray: `http://127.0.0.1:10808`
- Shadowsocks: `http://127.0.0.1:1080`

Replace with your actual proxy address and port.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your chat ID from @userinfobot |
| `HTTP_PROXY` | No | HTTP proxy URL (e.g., `http://127.0.0.1:7890`) |
| `HTTPS_PROXY` | No | HTTPS proxy URL (alternative to HTTP_PROXY) |

---

## Available Tools

Once configured, Claude Code will have access to these tools:

### telegram_send_message
Send a text message to your Telegram.
```
Parameters:
- message (required): The text message to send
```

### telegram_get_messages
Retrieve recent messages from Telegram.
```
Parameters:
- limit (optional): Maximum number of messages to retrieve (default: 10)
```

### telegram_check_new
Quick check if there are new messages.
```
No parameters required
```

### telegram_send_photo
Send an image file to Telegram.
```
Parameters:
- photo_path (required): Absolute path to the image file
- caption (optional): Caption for the photo
```

---

## Usage Examples

After configuration, you can ask Claude Code to:

- "Send me a message on Telegram saying the task is complete"
- "Check if I sent any new messages on Telegram"
- "Send a screenshot of the current code to my Telegram"

---

## Troubleshooting

### "TELEGRAM_BOT_TOKEN must be configured"
Make sure you've added the bot token to your `.claude.json` configuration.

### "No new messages" but you sent messages
1. Make sure you started a conversation with your bot first
2. Check that your `TELEGRAM_CHAT_ID` is correct
3. If using a proxy, verify the proxy is working

### Connection timeout or network error
If you're in a region where Telegram is blocked:
1. Make sure your proxy software is running
2. Add the `HTTP_PROXY` environment variable to your configuration
3. Verify the proxy port is correct

### Bot not responding
1. Check that the bot token is correct (no extra spaces)
2. Make sure you've started a conversation with your bot
3. Try sending a message to your bot first, then check for messages

---

## How It Works

### Architecture

This MCP server acts as a bridge between Claude Code and Telegram:

```
┌─────────────┐     MCP Protocol      ┌─────────────────┐     Telegram API     ┌──────────┐
│ Claude Code │ ◄──────────────────► │ MCP Server      │ ◄─────────────────► │ Telegram │
│             │                       │ (this project)  │                      │          │
└─────────────┘                       └─────────────────┘                      └──────────┘
```

### Auto-Polling & Terminal Injection (Experimental)

When the MCP server starts, it automatically begins polling for new Telegram messages. When a message is received, it attempts to inject the text into the active terminal window using:

1. **Clipboard**: Message is copied to system clipboard
2. **SendKeys (Windows)**: PowerShell script simulates Ctrl+V and Enter keystrokes
3. **Window Activation**: Attempts to find and activate terminal windows (Windows Terminal, cmd, PowerShell, VS Code)

**This is an experimental feature** - it enables "remote control" of Claude Code via Telegram, but has reliability limitations.

### Tools Available

| Tool | Description |
|------|-------------|
| `telegram_send_message` | Send text to Telegram |
| `telegram_get_messages` | Retrieve recent messages |
| `telegram_check_new` | Quick check for new messages |
| `telegram_send_photo` | Send images to Telegram |
| `telegram_start_polling` | Manually start auto-polling |
| `telegram_stop_polling` | Stop auto-polling |

---

## Known Issues & Limitations

### ⚠️ Multiple Claude Code Instances

**Problem**: If you run multiple Claude Code windows, each will start its own MCP server instance. All instances will poll the same Telegram bot, causing:
- Duplicate message processing
- Multiple injection attempts
- Duplicate responses

**Workaround**: Only run one Claude Code instance when using Telegram integration, or disable the Telegram MCP in additional instances.

### ⚠️ SendKeys Reliability (Windows)

The terminal injection feature depends on:
- **Window focus**: Target terminal must be activatable
- **Clipboard access**: System clipboard must be available
- **Timing**: SendKeys requires precise timing

**When it may fail**:
- Another application has focus and won't release it
- System is under heavy load
- Remote desktop or virtual machine environments
- Screen is locked

**Workaround**: If injection fails, manually check Telegram messages using the `telegram_get_messages` tool.

### ⚠️ Platform Support

- **Windows**: Full support (auto-polling + SendKeys injection)
- **macOS/Linux**: Partial support (tools work, but auto-injection not implemented)

### ⚠️ Not Fully Unattended

This MCP cannot wake up Claude Code on its own. The auto-injection only works when:
- Claude Code is running and waiting for input
- A terminal window is accessible

For true unattended operation, consider using Claude Code's hook system instead.

---

## Planned Improvements

- [ ] Lock file mechanism to prevent multiple instance conflicts
- [ ] Retry logic for failed injections
- [ ] Failure notifications via Telegram
- [ ] Message queue for failed injections
- [ ] macOS/Linux injection support

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

EthanSky

## Repository

https://github.com/EthanSky2986/mcp-telegram-claudecode
