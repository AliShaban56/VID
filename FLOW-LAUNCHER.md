# Hekaya Flow Profile Launcher

This local helper opens Google Flow in a separate Chrome profile per account. Sign into each Google account yourself the first time; sessions are kept separate by profile.

## Requirements
- Node.js 20+
- Google Chrome installed

## Commands
```bash
node flow-launcher.mjs add "Account 1" "email@example.com"
node flow-launcher.mjs add "Account 2" "other@example.com"
node flow-launcher.mjs list
node flow-launcher.mjs open-all
node flow-launcher.mjs open <account-id>
node flow-launcher.mjs remove <account-id>
```

Profiles and account labels are stored locally under `~/.hekaya-flow/` (on Windows this resolves under the user's home directory). Do not share that folder; it contains browser profile session data.

This helper only opens isolated browser profiles and Flow windows. It does not automate generation clicks, circumvent usage limits, or store Google passwords. Flow's built-in Agent may be used according to Google's official UI and settings.
