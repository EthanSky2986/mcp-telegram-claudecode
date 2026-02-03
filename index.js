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

// Temp directory for injection scripts
const tempDir = process.env.TEMP || process.env.TMP || '/tmp';

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
  });

  return response.data;
}

/**
 * Send a photo to Telegram
 */
async function sendPhoto(photoPath, caption = '') {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const FormData = require('form-data');

  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('photo', fs.createReadStream(photoPath));
  if (caption) {
    form.append('caption', caption);
  }

  const response = await axiosInstance.post(`${API_BASE}/sendPhoto`, form, {
    headers: form.getHeaders()
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
    }
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
 * Inject text into terminal via clipboard and SendKeys (Windows)
 */
function injectToTerminal(text) {
  try {
    // Replace newlines with spaces for single-line injection
    const singleLine = text.replace(/[\r\n]+/g, ' ').trim();

    // Write to temp file with UTF-8 BOM
    const tempFile = path.join(tempDir, 'telegram-mcp-cmd.txt');
    const BOM = '\uFEFF';
    fs.writeFileSync(tempFile, BOM + singleLine, 'utf8');

    // Copy to clipboard with UTF-8 encoding
    execSync(`powershell -command "$text = Get-Content -Path '${tempFile}' -Raw -Encoding UTF8; Set-Clipboard -Value $text"`, { stdio: 'ignore' });

    // Create PowerShell script for SendKeys
    const scriptPath = path.join(tempDir, 'telegram-mcp-inject.ps1');
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject wscript.shell
$windows = @('WindowsTerminal', 'cmd', 'powershell', 'Code')
foreach ($proc in $windows) {
    $p = Get-Process -Name $proc -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p) {
        $wshell.AppActivate($p.Id)
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
        break
    }
}
`;
    fs.writeFileSync(scriptPath, script);
    execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: 'ignore' });

    return true;
  } catch (error) {
    console.error('Injection failed:', error.message);
    return false;
  }
}

/**
 * Poll for messages and inject to terminal
 */
async function pollAndInject() {
  if (!pollingActive) return;

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
          injectToTerminal(text);
        }
      }
    }
  } catch (error) {
    if (!error.message.includes('timeout') && !error.message.includes('ECONNRESET')) {
      console.error('Poll error:', error.message);
    }
  }
}

/**
 * Start polling service
 */
function startPolling(intervalMs = 2000) {
  if (pollingActive) {
    return { success: false, message: 'Polling already active' };
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

  return { success: true, message: 'Polling stopped' };
}

// Create MCP server
const server = new Server(
  {
    name: 'telegram-claude-mcp',
    version: '1.1.0',
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
        description: 'Send a text message to the configured Telegram chat. Use this to communicate with the user via Telegram.',
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
        description: 'Start auto-polling for Telegram messages. When enabled, new messages will be automatically injected into the terminal as user input. Call this at the start of a session to enable remote communication.',
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
  console.error('Telegram Claude MCP server running (v1.1.0 with polling support)');
}

main().catch(console.error);
