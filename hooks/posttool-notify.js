#!/usr/bin/env node

/**
 * Claude Code Notification Hook for Telegram
 *
 * This hook sends notifications to Telegram after tool execution.
 * Useful for monitoring what Claude Code is doing remotely.
 *
 * Usage: Add to your Claude Code hooks configuration:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": ".*",
 *       "hooks": ["node /path/to/posttool-notify.js"]
 *     }]
 *   }
 * }
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Configuration from environment
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
const NOTIFY_ALL = process.env.TELEGRAM_NOTIFY_ALL === 'true'; // Only notify errors by default

/**
 * Make HTTP request with optional proxy support
 */
function makeRequest(url, options, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    let reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    let transport = https;
    if (PROXY_URL) {
      const proxyUrl = new URL(PROXY_URL);
      reqOptions = {
        hostname: proxyUrl.hostname,
        port: proxyUrl.port,
        path: url,
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          'Host': urlObj.hostname
        }
      };
      transport = proxyUrl.protocol === 'https:' ? https : http;
    }

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Send message to Telegram
 */
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const postData = JSON.stringify({
    chat_id: CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  });

  return makeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);
}

/**
 * Main hook handler
 */
async function main() {
  // Read event from stdin
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  let event;
  try {
    event = JSON.parse(inputData);
  } catch (e) {
    return; // Invalid input, ignore
  }

  const { tool_name, tool_input, tool_output, error } = event;

  // Check if Telegram is configured
  if (!BOT_TOKEN || !CHAT_ID) {
    return;
  }

  // Determine if we should notify
  const hasError = error || (tool_output && tool_output.includes('Error'));
  if (!NOTIFY_ALL && !hasError) {
    return; // Only notify on errors unless NOTIFY_ALL is set
  }

  try {
    let message;
    if (hasError) {
      message = `❌ <b>Tool Error</b>\n\n` +
        `🔧 <b>Tool:</b> ${tool_name}\n` +
        `📝 <b>Error:</b>\n<code>${(error || tool_output || 'Unknown error').substring(0, 500)}</code>`;
    } else {
      message = `✅ <b>Tool Completed</b>\n\n` +
        `🔧 <b>Tool:</b> ${tool_name}\n` +
        `📝 <b>Result:</b> Success`;

      // Add brief output for some tools
      if (tool_name === 'Bash' && tool_output) {
        message += `\n<code>${tool_output.substring(0, 200)}</code>`;
      }
    }

    await sendTelegram(message);
  } catch (e) {
    // Ignore notification errors
  }
}

main();
