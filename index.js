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
      if (lockAge >= 30000) {
        return false;
      }

      // Check if the process that holds the lock is still running
      if (lockData.pid && lockData.pid !== process.pid) {
        try {
          // process.kill(pid, 0) throws if process doesn't exist
          process.kill(lockData.pid, 0);
          // Process is still running, lock is valid
          return true;
        } catch {
          // Process is not running, lock is stale - clean it up
          try {
            fs.unlinkSync(lockFilePath);
          } catch {}
          return false;
        }
      }

      // Lock is held by current process
      return false;
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
 * Send a video to Telegram
 */
async function sendVideo(videoPath, caption = '') {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('video', fs.createReadStream(videoPath));
  if (caption) {
    form.append('caption', caption);
  }

  const response = await axiosInstance.post(`${API_BASE}/sendVideo`, form, {
    headers: form.getHeaders(),
    timeout: 300000  // 5 minutes timeout for large videos
  });

  return response.data;
}

/**
 * Send a document/file to Telegram
 */
async function sendDocument(documentPath, caption = '') {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  }

  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('document', fs.createReadStream(documentPath));
  if (caption) {
    form.append('caption', caption);
  }

  const response = await axiosInstance.post(`${API_BASE}/sendDocument`, form, {
    headers: form.getHeaders(),
    timeout: 300000  // 5 minutes timeout for large files
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
 * Inject text into terminal using SendInput API
 * Finds and activates terminal window, then sends keyboard events
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

    // Create PowerShell script using SendInput API
    const scriptPath = path.join(tempDir, 'telegram-mcp-inject.ps1');
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;

public class SendInputAPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public const int SW_SHOW = 5;
    public const byte VK_MENU = 0x12;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const ushort VK_RETURN = 0x0D;
    public const ushort VK_CONTROL = 0x11;
    public const ushort VK_V = 0x56;

    private static List<IntPtr> foundWindows = new List<IntPtr>();

    public static List<IntPtr> FindWindowsByTitle(string pattern) {
        foundWindows.Clear();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (title.Contains(pattern)) {
                    foundWindows.Add(hWnd);
                }
            }
            return true;
        }, IntPtr.Zero);
        return new List<IntPtr>(foundWindows);
    }

    public static List<IntPtr> FindWindowsByClassName(string className) {
        foundWindows.Clear();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                StringBuilder sb = new StringBuilder(256);
                GetClassName(hWnd, sb, 256);
                if (sb.ToString() == className) {
                    foundWindows.Add(hWnd);
                }
            }
            return true;
        }, IntPtr.Zero);
        return new List<IntPtr>(foundWindows);
    }

    public static bool ActivateWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;

        // Try multiple times to ensure window is activated
        for (int i = 0; i < 3; i++) {
            // Use Alt key trick to allow SetForegroundWindow from background process
            keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            System.Threading.Thread.Sleep(50);

            ShowWindow(hWnd, SW_SHOW);
            SetForegroundWindow(hWnd);
            System.Threading.Thread.Sleep(100);

            // Verify the window is now in foreground
            if (GetForegroundWindow() == hWnd) {
                return true;
            }
        }
        // Final attempt
        return GetForegroundWindow() == hWnd;
    }

    public static uint SendCtrlV() {
        var inputs = new List<INPUT>();
        int size = Marshal.SizeOf(typeof(INPUT));

        // Ctrl down
        INPUT ctrlDown = new INPUT();
        ctrlDown.type = INPUT_KEYBOARD;
        ctrlDown.u.ki.wVk = VK_CONTROL;
        ctrlDown.u.ki.dwFlags = 0;
        inputs.Add(ctrlDown);

        // V down
        INPUT vDown = new INPUT();
        vDown.type = INPUT_KEYBOARD;
        vDown.u.ki.wVk = VK_V;
        vDown.u.ki.dwFlags = 0;
        inputs.Add(vDown);

        // V up
        INPUT vUp = new INPUT();
        vUp.type = INPUT_KEYBOARD;
        vUp.u.ki.wVk = VK_V;
        vUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs.Add(vUp);

        // Ctrl up
        INPUT ctrlUp = new INPUT();
        ctrlUp.type = INPUT_KEYBOARD;
        ctrlUp.u.ki.wVk = VK_CONTROL;
        ctrlUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs.Add(ctrlUp);

        return SendInput((uint)inputs.Count, inputs.ToArray(), size);
    }

    // Send Unicode text directly via SendInput (no clipboard needed)
    public static uint SendUnicodeText(string text) {
        var inputs = new List<INPUT>();
        int size = Marshal.SizeOf(typeof(INPUT));

        foreach (char c in text) {
            // Key down
            INPUT keyDown = new INPUT();
            keyDown.type = INPUT_KEYBOARD;
            keyDown.u.ki.wVk = 0;
            keyDown.u.ki.wScan = (ushort)c;
            keyDown.u.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs.Add(keyDown);

            // Key up
            INPUT keyUp = new INPUT();
            keyUp.type = INPUT_KEYBOARD;
            keyUp.u.ki.wVk = 0;
            keyUp.u.ki.wScan = (ushort)c;
            keyUp.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            inputs.Add(keyUp);
        }

        if (inputs.Count == 0) return 0;
        return SendInput((uint)inputs.Count, inputs.ToArray(), size);
    }

    public static uint SendEnter() {
        var inputs = new List<INPUT>();
        int size = Marshal.SizeOf(typeof(INPUT));

        INPUT enterDown = new INPUT();
        enterDown.type = INPUT_KEYBOARD;
        enterDown.u.ki.wVk = VK_RETURN;
        enterDown.u.ki.dwFlags = 0;
        inputs.Add(enterDown);

        INPUT enterUp = new INPUT();
        enterUp.type = INPUT_KEYBOARD;
        enterUp.u.ki.wVk = VK_RETURN;
        enterUp.u.ki.dwFlags = KEYEVENTF_KEYUP;
        inputs.Add(enterUp);

        return SendInput((uint)inputs.Count, inputs.ToArray(), size);
    }
}
"@

# Read the text to inject
$text = Get-Content -Path '${tempFile.replace(/\\/g, '\\\\')}' -Raw -Encoding UTF8
$text = $text.TrimStart([char]0xFEFF).Trim()

# CRITICAL: If text is empty, exit immediately without sending anything
if ([string]::IsNullOrWhiteSpace($text)) {
    Write-Error "Empty text detected - aborting injection"
    exit 1
}

# Find terminal window by class name (not title - more reliable)
$windows = [SendInputAPI]::FindWindowsByClassName("CASCADIA_HOSTING_WINDOW_CLASS")
if (-not $windows) { $windows = [SendInputAPI]::FindWindowsByClassName("ConsoleWindowClass") }

if (-not $windows) {
    Write-Error "No terminal window found"
    exit 1
}

$targetWindow = @($windows)[0]

# Activate terminal window and verify it's in foreground
$activated = [SendInputAPI]::ActivateWindow($targetWindow)
Start-Sleep -Milliseconds 300

# CRITICAL: Verify the terminal window is now in foreground before sending any keys
# This prevents injecting text into wrong windows (e.g., browser input fields)
$currentForeground = [SendInputAPI]::GetForegroundWindow()
if ($currentForeground -ne $targetWindow) {
    Write-Error "Terminal window activation failed - wrong window has focus, aborting to prevent misinjection"
    exit 1
}

# Send text directly via SendInput Unicode (no clipboard needed - avoids race condition)
$sent = [SendInputAPI]::SendUnicodeText($text)
Start-Sleep -Milliseconds 100

# Double-check foreground window before pressing Enter
$currentForeground = [SendInputAPI]::GetForegroundWindow()
if ($currentForeground -ne $targetWindow) {
    Write-Error "Terminal lost focus before Enter - aborting"
    exit 1
}

# Send Enter
$sent = [SendInputAPI]::SendEnter()

if ($sent -gt 0) {
    Write-Output "OK:SendInput"
    exit 0
} else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Error "SendInput failed: $err"
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
      'Write-Output "OK:SendInput"',
      `Set-Content -Path '${successMarker.replace(/\\/g, '\\\\')}' -Value 'OK'`
    );
    fs.writeFileSync(scriptPath, scriptWithMarker);

    // Run PowerShell script directly
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000
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

        // Debug logging: show what type of update we received
        const updateKeys = Object.keys(update).filter(k => k !== 'update_id');
        console.error(`[DEBUG] Update ${update.update_id}: keys=${updateKeys.join(',')}`);
        if (update.message) {
          console.error(`[DEBUG]   message.text="${update.message.text || '(none)'}", chat_id=${update.message.chat?.id}`);
        }

        if (update.message && update.message.text) {
          const text = update.message.text.trim();
          const chatId = update.message.chat.id.toString();

          // Only process messages from authorized chat
          if (CHAT_ID && chatId !== CHAT_ID) continue;

          // Skip empty/whitespace-only messages
          if (!text) continue;

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
    version: '1.5.0',
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
        name: 'telegram_send_video',
        description: 'Send a video file to the configured Telegram chat. Supports mp4, mov, avi and other video formats. Max file size: 50MB.',
        inputSchema: {
          type: 'object',
          properties: {
            video_path: {
              type: 'string',
              description: 'Absolute path to the video file'
            },
            caption: {
              type: 'string',
              description: 'Optional caption for the video'
            }
          },
          required: ['video_path']
        }
      },
      {
        name: 'telegram_send_document',
        description: 'Send any file/document to the configured Telegram chat. Use this for files that are not photos or videos (e.g., zip, pdf, txt, etc.). Max file size: 50MB.',
        inputSchema: {
          type: 'object',
          properties: {
            document_path: {
              type: 'string',
              description: 'Absolute path to the file'
            },
            caption: {
              type: 'string',
              description: 'Optional caption for the document'
            }
          },
          required: ['document_path']
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

      case 'telegram_send_video': {
        const result = await sendVideo(args.video_path, args.caption || '');
        return {
          content: [
            {
              type: 'text',
              text: `Video sent successfully. Message ID: ${result.result.message_id}`
            }
          ]
        };
      }

      case 'telegram_send_document': {
        const result = await sendDocument(args.document_path, args.caption || '');
        return {
          content: [
            {
              type: 'text',
              text: `Document sent successfully. Message ID: ${result.result.message_id}`
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
  console.error('Telegram Claude MCP server running (v1.5.0)');

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
