# Telegram Claude MCP

MCP server for Telegram integration with Claude Code. Allows Claude to send and receive messages via Telegram.

## Features

- Send text messages to Telegram
- Send photos/images to Telegram
- Receive messages from Telegram
- Proxy support for regions where Telegram is blocked

## Installation

```bash
npm install -g telegram-claude-mcp
```

Or use npx directly:
```bash
npx telegram-claude-mcp
```

## Configuration

Add to your Claude Code settings (`.claude.json` or via `/settings`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["telegram-claude-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token",
        "TELEGRAM_CHAT_ID": "your-chat-id",
        "HTTP_PROXY": "http://127.0.0.1:10808"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Yes | Your chat ID from [@userinfobot](https://t.me/userinfobot) |
| `HTTP_PROXY` | No | Proxy URL (for regions where Telegram is blocked) |

## Getting Your Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the instructions
3. Copy the bot token provided

## Getting Your Chat ID

1. Open Telegram and search for [@userinfobot](https://t.me/userinfobot)
2. Send any message to the bot
3. Copy the `Id` value from the response

## Available Tools

### telegram_send_message
Send a text message to Telegram.

### telegram_get_messages
Get recent messages from Telegram.

### telegram_check_new
Quick check if there are new messages.

### telegram_send_photo
Send a photo/image to Telegram.

## Usage Example

Once configured, Claude Code can use these tools:

```
Claude: I'll send you a message on Telegram.
[Uses telegram_send_message tool]

Claude: Let me check if you replied.
[Uses telegram_check_new tool]
```

## License

MIT
