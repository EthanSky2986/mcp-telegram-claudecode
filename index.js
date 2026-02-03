#!/usr/bin/env node

/**
 * Telegram Claude MCP Server
 * MCP server for Telegram integration with Claude Code
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

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

/**
 * Send a text message to Telegram
 */
async function sendMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const response = await axiosInstance.post(`${API_BASE}/sendMessage`, {
    chat_id: CHAT_ID,
    text: text,
    parse_mode: 'Markdown'
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

  const fs = require('fs');
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
        // Filter by chat ID if configured
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

// Create MCP server
const server = new Server(
  {
    name: 'telegram-claude-mcp',
    version: '1.0.0',
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
  console.error('Telegram Claude MCP server running');
}

main().catch(console.error);
