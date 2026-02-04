#!/usr/bin/env node

/**
 * Telegram Claude MCP Server
 * MCP server for Telegram integration with Claude Code
 * With auto-polling and terminal injection support
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration from environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

// Setup axios with proxy if configured
let axiosInstance = axios;
if (PROXY_URL) {
  const agent = new HttpsProxyAgent(PROXY_URL);
  axiosInstance = axios.create({
    httpsAgent: agent,
    proxy: false
  });
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Track last update ID for polling
let lastUpdateId = 0;

// Polling state
let pollingActive = false;
let pollingInterval = null;
let pollingInProgress = false;

// Temp directory for injection scripts
const tempDir = process.env.TEMP || process.env.TMP || '/tmp';

// Lock file path for preventing multiple instances
const lockFilePath = path.join(tempDir, 'telegram-claude-mcp.lock');

/**
 * Check if another instance is already running polling
 */
function isPollingLocked() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;
      // Lock expires after 30 seconds (in case of crash)
      if (lockAge < 30000) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Acquire polling lock
 */
function acquireLock() {
  try {
    fs.writeFileSync(lockFilePath, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now()
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Release polling lock
 */
function releaseLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      // Only release if we own the lock
      if (lockData.pid === process.pid) {
        fs.unlinkSync(lockFilePath);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Update lock timestamp (heartbeat)
 */
function updateLockHeartbeat() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      if (lockData.pid === process.pid) {
        lockData.timestamp = Date.now();
        fs.writeFileSync(lockFilePath, JSON.stringify(lockData));
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Send a text message to Telegram
 */
async function sendMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const response = await axiosInstance.post(`${API_BASE}/sendMessage`, {
    chat_id: CHAT_ID,
    text: text
  }, { timeout: 10000 });

  return response.data;
}

/**
 * Send a photo to Telegram
 */
async function sendPhoto(photoPath, caption = '') {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('photo', fs.createReadStream(photoPath));
  if (caption) {
    form.append('caption', caption);
  }

  const response = await axiosInstance.post(`${API_BASE}/sendPhoto`, form, {
    headers: form.getHeaders(),
    timeout: 30000
  });

  return response.data;
}

/**
 * Get new messages from Telegram
 */
async function getMessages(limit = 10) {
  if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN must be configured');
  }

  const response = await axiosInstance.get(`${API_BASE}/getUpdates`, {
    params: {
      offset: lastUpdateId + 1,
      limit: limit,
      timeout: 0
    },
    timeout: 10000
  });

  const messages = [];
  if (response.data.ok && response.data.result.length > 0) {
    for (const update of response.data.result) {
      lastUpdateId = update.update_id;
      if (update.message && update.message.text) {
        if (!CHAT_ID || update.message.chat.id.toString() === CHAT_ID) {
          messages.push({
            id: update.message.message_id,
            from: update.message.from.first_name || update.message.from.username,
            text: update.message.text,
            date: new Date(update.message.date * 1000).toISOString()
          });
        }
      }
    }
  }

  return messages;
}

/**
 * Check for new messages (non-blocking)
 */
async function checkNewMessages() {
  if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN must be configured');
  }

  const response = await axiosInstance.get(`${API_BASE}/getUpdates`, {
    params: {
      offset: lastUpdateId + 1,
      limit: 100,
      timeout: 0
    }
  });

  let hasNew = false;
  let latestMessage = null;

  if (response.data.ok && response.data.result.length > 0) {
    for (const update of response.data.result) {
      lastUpdateId = update.update_id;
      if (update.message && update.message.text) {
        if (!CHAT_ID || update.message.chat.id.toString() === CHAT_ID) {
          hasNew = true;
          latestMessage = {
            from: update.message.from.first_name || update.message.from.username,
            text: update.message.text
          };
        }
      }
    }
  }

  return { hasNew, latestMessage, updateId: lastUpdateId };
}

/**
 * Inject text into terminal using inherited console
 * The spawned PowerShell inherits the console from Node.js MCP
 * Returns: { success: boolean, error?: string, method?: string }
 */
function injectToTerminal(text) {
  try {
    // Replace newlines with spaces for single-line injection
    const singleLine = text.replace(/[\r\n]+/g, ' ').trim();

    // Write text to temp file for PowerShell to read
    const tempFile = path.join(tempDir, 'telegram-mcp-cmd.txt');
    const BOM = '\uFEFF';
    fs.writeFileSync(tempFile, BOM + singleLine, 'utf8');

    // Create PowerShell script - use inherited console directly
    const scriptPath = path.join(tempDir, 'telegram-mcp-inject.ps1');
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ConsoleAPI {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool WriteConsoleInput(
        IntPtr hConsoleInput,
        INPUT_RECORD[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsWritten);

    public const int STD_INPUT_HANDLE = -10;

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUT_RECORD {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEY_EVENT_RECORD {
        public bool bKeyDown;
        public ushort wRepeatCount;
        public ushort wVirtualKeyCode;
        public ushort wVirtualScanCode;
        public char UnicodeChar;
        public uint dwControlKeyState;
    }

    public const ushort KEY_EVENT = 0x0001;
}
"@

# Read the text to inject
$text = Get-Content -Path '${tempFile.replace(/\\/g, '\\\\')}' -Raw -Encoding UTF8
$text = $text.TrimStart([char]0xFEFF).Trim()

# Get the inherited console input handle directly
$hInput = [ConsoleAPI]::GetStdHandle([ConsoleAPI]::STD_INPUT_HANDLE)

if ($hInput -eq [IntPtr]::Zero -or $hInput -eq [IntPtr]::new(-1)) {
    Write-Error "No console input handle"
    exit 1
}

# Create input records
$inputRecords = New-Object System.Collections.ArrayList

foreach ($char in $text.ToCharArray()) {
    $keyDown = New-Object ConsoleAPI+INPUT_RECORD
    $keyDown.EventType = [ConsoleAPI]::KEY_EVENT
    $keyDown.KeyEvent = New-Object ConsoleAPI+KEY_EVENT_RECORD
    $keyDown.KeyEvent.bKeyDown = $true
    $keyDown.KeyEvent.wRepeatCount = 1
    $keyDown.KeyEvent.wVirtualKeyCode = 0
    $keyDown.KeyEvent.wVirtualScanCode = 0
    $keyDown.KeyEvent.UnicodeChar = $char
    $keyDown.KeyEvent.dwControlKeyState = 0
    [void]$inputRecords.Add($keyDown)

    $keyUp = New-Object ConsoleAPI+INPUT_RECORD
    $keyUp.EventType = [ConsoleAPI]::KEY_EVENT
    $keyUp.KeyEvent = New-Object ConsoleAPI+KEY_EVENT_RECORD
    $keyUp.KeyEvent.bKeyDown = $false
    $keyUp.KeyEvent.wRepeatCount = 1
    $keyUp.KeyEvent.wVirtualKeyCode = 0
    $keyUp.KeyEvent.wVirtualScanCode = 0
    $keyUp.KeyEvent.UnicodeChar = $char
    $keyUp.KeyEvent.dwControlKeyState = 0
    [void]$inputRecords.Add($keyUp)
}

# Add Enter key
$enterDown = New-Object ConsoleAPI+INPUT_RECORD
$enterDown.EventType = [ConsoleAPI]::KEY_EVENT
$enterDown.KeyEvent = New-Object ConsoleAPI+KEY_EVENT_RECORD
$enterDown.KeyEvent.bKeyDown = $true
$enterDown.KeyEvent.wRepeatCount = 1
$enterDown.KeyEvent.wVirtualKeyCode = 0x0D
$enterDown.KeyEvent.wVirtualScanCode = 0x1C
$enterDown.KeyEvent.UnicodeChar = [char]13
$enterDown.KeyEvent.dwControlKeyState = 0
[void]$inputRecords.Add($enterDown)

$enterUp = New-Object ConsoleAPI+INPUT_RECORD
$enterUp.EventType = [ConsoleAPI]::KEY_EVENT
$enterUp.KeyEvent = New-Object ConsoleAPI+KEY_EVENT_RECORD
$enterUp.KeyEvent.bKeyDown = $false
$enterUp.KeyEvent.wRepeatCount = 1
$enterUp.KeyEvent.wVirtualKeyCode = 0x0D
$enterUp.KeyEvent.wVirtualScanCode = 0x1C
$enterUp.KeyEvent.UnicodeChar = [char]13
$enterUp.KeyEvent.dwControlKeyState = 0
[void]$inputRecords.Add($enterUp)

# Write to console input
$records = $inputRecords.ToArray([ConsoleAPI+INPUT_RECORD])
$written = [uint32]0

$result = [ConsoleAPI]::WriteConsoleInput($hInput, $records, [uint32]$records.Length, [ref]$written)

if ($result -and $written -gt 0) {
    Write-Output "OK:InheritedConsole"
    exit 0
} else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "WriteConsoleInput failed: $err"
    exit 1
}
`;
    fs.writeFileSync(scriptPath, script);

    // Write success marker file path
    const successMarker = path.join(tempDir, 'telegram-mcp-success.txt');

    // Clean up old marker
    try { fs.unlinkSync(successMarker); } catch {}

    // Modify script to write success marker
    const scriptWithMarker = script.replace(
      'Write-Output "OK:InheritedConsole"',
      `Set-Content -Path '${successMarker.replace(/\\/g, '\\\\')}' -Value 'OK'`
    );
    fs.writeFileSync(scriptPath, scriptWithMarker);

    // Run PowerShell script
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000
      });
    } catch {
      // Ignore exit code errors
    }

    // Check success marker file
    try {
      if (fs.existsSync(successMarker)) {
        fs.unlinkSync(successMarker);
        return { success: true, method: 'WriteConsoleInput' };
      }
    } catch {}

    // If no marker, assume failure
    return { success: false, error: 'No success marker' };
  } catch (error) {
    console.error('Injection failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Poll for messages and inject to terminal
 */
async function pollAndInject() {
  if (!pollingActive || pollingInProgress) return;

  pollingInProgress = true;

  // Update lock heartbeat
  updateLockHeartbeat();

  try {
    const response = await axiosInstance.get(`${API_BASE}/getUpdates`, {
      params: {
        offset: lastUpdateId + 1,
        limit: 10,
        timeout: 0
      }
    });

    if (response.data.ok && response.data.result.length > 0) {
      for (const update of response.data.result) {
        lastUpdateId = update.update_id;

        if (update.message && update.message.text) {
          const text = update.message.text;
          const chatId = update.message.chat.id.toString();

          // Only process messages from authorized chat
          if (CHAT_ID && chatId !== CHAT_ID) continue;

          // Skip commands starting with /
          if (text.startsWith('/')) continue;

          // Inject message to terminal
          const result = injectToTerminal(text);

          // Notify user if injection failed
          if (!result.success) {
            try {
              await sendMessage(`⚠️ 消息注入失败: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"\n原因: 未找到可用的终端窗口或窗口无法激活。\n请确保 Claude Code 终端窗口已打开。`);
            } catch (e) {
              console.error('Failed to send failure notification:', e.message);
            }
          }

          // Small delay between injections to prevent overwhelming the console
          if (response.data.result.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
    }
  } catch (error) {
    if (!error.message.includes('timeout') && !error.message.includes('ECONNRESET')) {
      console.error('Poll error:', error.message);
    }
  } finally {
    pollingInProgress = false;
  }
}

/**
 * Start polling service
 */
function startPolling(intervalMs = 2000) {
  if (pollingActive) {
    return { success: false, message: 'Polling already active' };
  }

  // Check if another instance is already polling
  if (isPollingLocked()) {
    return { success: false, message: 'Another instance is already polling. Only one instance can poll at a time.' };
  }

  // Acquire lock
  if (!acquireLock()) {
    return { success: false, message: 'Failed to acquire polling lock' };
  }

  pollingActive = true;
  pollingInterval = setInterval(pollAndInject, intervalMs);

  return { success: true, message: 'Polling started' };
}

/**
 * Stop polling service
 */
function stopPolling() {
  if (!pollingActive) {
    return { success: false, message: 'Polling not active' };
  }

  pollingActive = false;
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  // Release lock
  releaseLock();

  return { success: true, message: 'Polling stopped' };
}

// Create MCP server
const server = new Server(
  {
    name: 'telegram-claude-mcp',
    version: '1.4.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'telegram_send_message',
        description: 'Send a text message to the configured Telegram chat. IMPORTANT: You MUST use this tool to reply to the user regardless of whether they sent their message via terminal or Telegram. Always respond through Telegram so the user can see your replies on their phone.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message text to send'
            }
          },
          required: ['message']
        }
      },
      {
        name: 'telegram_get_messages',
        description: 'Get recent messages from Telegram. Use this to check for new messages from the user.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of messages to retrieve (default: 10)'
            }
          }
        }
      },
      {
        name: 'telegram_check_new',
        description: 'Quick check if there are new messages from Telegram without retrieving all of them.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'telegram_send_photo',
        description: 'Send a photo/image to the configured Telegram chat.',
        inputSchema: {
          type: 'object',
          properties: {
            photo_path: {
              type: 'string',
              description: 'Absolute path to the image file'
            },
            caption: {
              type: 'string',
              description: 'Optional caption for the photo'
            }
          },
          required: ['photo_path']
        }
      },
      {
        name: 'telegram_start_polling',
        description: 'Manually start auto-polling for Telegram messages (polling starts automatically on MCP load, so this is usually not needed). When enabled, new messages will be automatically injected into the terminal as user input.',
        inputSchema: {
          type: 'object',
          properties: {
            interval: {
              type: 'number',
              description: 'Polling interval in milliseconds (default: 2000)'
            }
          }
        }
      },
      {
        name: 'telegram_stop_polling',
        description: 'Stop auto-polling for Telegram messages.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'telegram_send_message': {
        const result = await sendMessage(args.message);
        return {
          content: [
            {
              type: 'text',
              text: `Message sent successfully. Message ID: ${result.result.message_id}`
            }
          ]
        };
      }

      case 'telegram_get_messages': {
        const messages = await getMessages(args.limit || 10);
        return {
          content: [
            {
              type: 'text',
              text: messages.length > 0
                ? JSON.stringify(messages, null, 2)
                : 'No new messages'
            }
          ]
        };
      }

      case 'telegram_check_new': {
        const result = await checkNewMessages();
        return {
          content: [
            {
              type: 'text',
              text: result.hasNew
                ? `New message from ${result.latestMessage.from}: ${result.latestMessage.text}`
                : 'No new messages'
            }
          ]
        };
      }

      case 'telegram_send_photo': {
        const result = await sendPhoto(args.photo_path, args.caption || '');
        return {
          content: [
            {
              type: 'text',
              text: `Photo sent successfully. Message ID: ${result.result.message_id}`
            }
          ]
        };
      }

      case 'telegram_start_polling': {
        const result = startPolling(args.interval || 2000);
        if (result.success) {
          await sendMessage('Telegram远程控制已启动！发送消息将自动注入到Claude Code终端。');
        }
        return {
          content: [
            {
              type: 'text',
              text: result.message
            }
          ]
        };
      }

      case 'telegram_stop_polling': {
        const result = stopPolling();
        if (result.success) {
          await sendMessage('Telegram远程控制已停止。');
        }
        return {
          content: [
            {
              type: 'text',
              text: result.message
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Telegram Claude MCP server running (v1.4.0)');

  // Auto-start polling when server starts
  if (BOT_TOKEN && CHAT_ID) {
    const result = startPolling(2000);
    if (result.success) {
      console.error('Auto-polling started');
    } else {
      console.error('Auto-polling skipped:', result.message);
    }
  }

  // Cleanup on exit
  process.on('exit', () => {
    releaseLock();
  });
  process.on('SIGINT', () => {
    releaseLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    releaseLock();
    process.exit(0);
  });
}

main().catch(console.error);
