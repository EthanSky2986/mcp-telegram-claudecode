# Claude Code Hooks for Telegram

This directory contains hook scripts for integrating Claude Code with Telegram for remote approval and notifications.

## Available Hooks

### pretool-approval.js

**PreToolUse hook** - Intercepts sensitive tool calls and requests approval via Telegram.

Features:
- Intercepts Bash, Edit, Write, NotebookEdit operations
- Sends detailed info about the operation to Telegram
- Waits for user approval (Y/N)
- Configurable timeout (default: 60 seconds)
- Supports Chinese responses (是/否)

### posttool-notify.js

**PostToolUse hook** - Sends notifications after tool execution.

Features:
- Notifies on errors by default
- Optional: notify on all tool completions
- Shows brief output for Bash commands

## Installation

### Step 1: Configure Environment Variables

Make sure these environment variables are set (same as MCP server):

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
HTTP_PROXY=http://127.0.0.1:7890  # Optional
```

### Step 2: Add Hooks to Claude Code

Run `/hooks` in Claude Code or edit your settings file:

**Location:**
- User settings: `~/.claude/settings.json`
- Project settings: `.claude/settings.json`

**Configuration:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          "node C:/path/to/telegram-claude-mcp/hooks/pretool-approval.js"
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          "node C:/path/to/telegram-claude-mcp/hooks/posttool-notify.js"
        ]
      }
    ]
  }
}
```

**Note:** Replace the path with your actual installation path.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | - | Your chat ID |
| `HTTP_PROXY` | No | - | Proxy URL if needed |
| `TELEGRAM_APPROVAL_TIMEOUT` | No | 60000 | Approval timeout in ms |
| `TELEGRAM_NOTIFY_ALL` | No | false | Notify on all tool completions |

## Usage

### Remote Approval Flow

1. Claude Code attempts a sensitive operation (e.g., edit a file)
2. You receive a Telegram message with operation details
3. Reply **Y** (or 是/yes/approve) to approve
4. Reply **N** (or 否/no/deny) to deny
5. If no response within timeout, operation is denied

### Approval Responses

**Approve:**
- `Y`, `y`, `yes`, `1`, `approve`
- `是`, `好`, `可以`

**Deny:**
- `N`, `n`, `no`, `0`, `deny`
- `否`, `不`, `拒绝`

## Example Messages

### Approval Request
```
⚠️ Permission Request

🔧 Tool: Edit
📁 File: /path/to/file.js
➖ Remove:
const old = "value";
➕ Add:
const new = "value";

Reply Y to approve or N to deny
(Timeout: 60s)
```

### After Approval
```
✅ Approved: Edit
```

### After Denial
```
❌ Denied: Edit
Reason: User denied: n
```

## Comparison with SendKeys Injection

| Feature | SendKeys | Hooks |
|---------|----------|-------|
| Reliability | Low (depends on window focus) | High (native integration) |
| Cross-platform | Windows only | All platforms |
| Permission control | No | Yes |
| Security | Lower | Higher |
| Setup complexity | Simple | Moderate |

## Troubleshooting

### Hook not triggering
1. Check hook path is correct (use absolute path)
2. Verify environment variables are set
3. Check Claude Code logs for errors

### Telegram message not received
1. Verify bot token and chat ID
2. Check proxy settings if needed
3. Test with the MCP server first

### Timeout too short
Set `TELEGRAM_APPROVAL_TIMEOUT` environment variable (in milliseconds):
```json
{
  "env": {
    "TELEGRAM_APPROVAL_TIMEOUT": "120000"
  }
}
```
