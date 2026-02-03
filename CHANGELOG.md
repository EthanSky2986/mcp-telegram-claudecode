# Changelog

All notable changes to this project will be documented in this file.

## [1.3.1] - 2026-02-04

### Fixed
- Added `pollingInProgress` lock to prevent race condition when multiple polls overlap
- Fixed message duplication issue caused by concurrent polling
- Added request timeouts (10s for messages, 30s for photos) to prevent hanging
- Moved FormData import to top level for better performance

### Changed
- Updated `telegram_send_message` tool description to emphasize always responding via Telegram
- Updated `telegram_start_polling` description to note auto-start behavior

### Added
- Auto-start polling when MCP server starts (if BOT_TOKEN and CHAT_ID are configured)

## [1.3.0] - 2026-02-04

### Added
- `telegram_send_photo` tool for sending images
- Proxy support via HTTP_PROXY/HTTPS_PROXY environment variables

### Changed
- Improved error handling in polling

## [1.2.0] - 2026-02-03

### Added
- `telegram_start_polling` and `telegram_stop_polling` tools
- Auto-injection of Telegram messages to terminal via SendKeys (Windows)

## [1.1.0] - 2026-02-02

### Added
- `telegram_check_new` tool for quick message check

### Changed
- Improved message filtering by chat ID

## [1.0.0] - 2026-02-01

### Added
- Initial release
- `telegram_send_message` tool
- `telegram_get_messages` tool
- Basic Telegram Bot API integration
- MCP server implementation using @modelcontextprotocol/sdk

---

## Known Issues

- **Multiple Claude Code instances**: Running multiple Claude Code windows will cause message duplication as each instance runs its own MCP server
- **SendKeys reliability**: Terminal injection depends on window focus and may fail occasionally
- **No message persistence**: Failed injections result in lost messages

## Planned Improvements

- Lock file mechanism to prevent multiple instance conflicts
- Retry logic for SendKeys injection
- Failure notifications via Telegram
- Message queue for failed injections
