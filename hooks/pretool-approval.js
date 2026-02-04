#!/usr/bin/env node

/**
 * Claude Code PreToolUse Hook for Telegram Remote Approval
 *
 * This hook intercepts sensitive tool calls and requests approval via Telegram.
 *
 * Usage: Add to your Claude Code hooks configuration:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "Edit|Write|Bash",
 *       "hooks": ["node /path/to/pretool-approval.js"]
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
const APPROVAL_TIMEOUT = parseInt(process.env.TELEGRAM_APPROVAL_TIMEOUT) || 60000; // 60 seconds default

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

    // Handle proxy
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
 * Get latest message from Telegram
 */
async function getLatestMessage(afterMessageId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1&limit=1`;
  const result = await makeRequest(url, { method: 'GET' });

  if (result.ok && result.result.length > 0) {
    const update = result.result[0];
    if (update.message && update.message.message_id > afterMessageId) {
      if (!CHAT_ID || update.message.chat.id.toString() === CHAT_ID) {
        return update.message;
      }
    }
  }
  return null;
}

/**
 * Wait for user approval via Telegram
 */
async function waitForApproval(promptMessageId) {
  const startTime = Date.now();

  while (Date.now() - startTime < APPROVAL_TIMEOUT) {
    try {
      const message = await getLatestMessage(promptMessageId);
      if (message) {
        const text = message.text.toLowerCase().trim();
        if (text === 'y' || text === 'yes' || text === '1' || text === 'approve' || text === '是' || text === '好' || text === '可以') {
          return { approved: true, response: message.text };
        }
        if (text === 'n' || text === 'no' || text === '0' || text === 'deny' || text === '否' || text === '不' || text === '拒绝') {
          return { approved: false, response: message.text };
        }
        // Unrecognized response, continue waiting
      }
    } catch (e) {
      // Ignore errors, continue polling
    }

    // Wait 1 second before next poll
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { approved: false, response: 'timeout' };
}

/**
 * Format tool info for display
 */
function formatToolInfo(toolName, toolInput) {
  let info = `🔧 <b>Tool:</b> ${toolName}\n`;

  if (toolName === 'Bash' && toolInput.command) {
    info += `📝 <b>Command:</b>\n<code>${toolInput.command.substring(0, 500)}</code>`;
  } else if (toolName === 'Edit' && toolInput.file_path) {
    info += `📁 <b>File:</b> ${toolInput.file_path}\n`;
    if (toolInput.old_string) {
      info += `➖ <b>Remove:</b>\n<code>${toolInput.old_string.substring(0, 200)}</code>\n`;
    }
    if (toolInput.new_string) {
      info += `➕ <b>Add:</b>\n<code>${toolInput.new_string.substring(0, 200)}</code>`;
    }
  } else if (toolName === 'Write' && toolInput.file_path) {
    info += `📁 <b>File:</b> ${toolInput.file_path}\n`;
    info += `📝 <b>Content:</b> ${toolInput.content ? toolInput.content.length : 0} chars`;
  } else {
    // Generic display
    info += `📝 <b>Input:</b>\n<code>${JSON.stringify(toolInput, null, 2).substring(0, 300)}</code>`;
  }

  return info;
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
    // Invalid input, allow by default
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  const { tool_name, tool_input } = event;

  // Skip non-sensitive tools
  const sensitiveTool = ['Bash', 'Edit', 'Write', 'NotebookEdit'].includes(tool_name);
  if (!sensitiveTool) {
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  // Check if Telegram is configured
  if (!BOT_TOKEN || !CHAT_ID) {
    // No Telegram config, allow by default
    console.log(JSON.stringify({ decision: "approve" }));
    return;
  }

  try {
    // Send approval request to Telegram
    const toolInfo = formatToolInfo(tool_name, tool_input);
    const message = `⚠️ <b>Permission Request</b>\n\n${toolInfo}\n\n` +
      `Reply <b>Y</b> to approve or <b>N</b> to deny\n` +
      `(Timeout: ${APPROVAL_TIMEOUT / 1000}s)`;

    const sendResult = await sendTelegram(message);

    if (!sendResult.ok) {
      // Failed to send, allow by default
      console.log(JSON.stringify({ decision: "approve" }));
      return;
    }

    const promptMessageId = sendResult.result.message_id;

    // Wait for user response
    const { approved, response } = await waitForApproval(promptMessageId);

    if (approved) {
      await sendTelegram(`✅ Approved: ${tool_name}`);
      console.log(JSON.stringify({ decision: "approve" }));
    } else {
      const reason = response === 'timeout' ? 'Timeout - no response' : `User denied: ${response}`;
      await sendTelegram(`❌ Denied: ${tool_name}\nReason: ${reason}`);
      console.log(JSON.stringify({ decision: "deny", reason: reason }));
    }

  } catch (error) {
    // On error, allow by default to not block workflow
    console.log(JSON.stringify({ decision: "approve" }));
  }
}

main();
