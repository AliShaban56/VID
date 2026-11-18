# Hekaya Studio social OAuth setup

Set these values in Vercel Project Settings → Environment Variables (Production):

- `APP_BASE_URL=https://vid-ali-b36b.vercel.app`
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 random bytes)
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`

OAuth redirect/callback URLs to register in each developer app:

- TikTok: `https://vid-ali-b36b.vercel.app/api/social/oauth/callback/tiktok`
- Google/YouTube: `https://vid-ali-b36b.vercel.app/api/social/oauth/callback/youtube`
- Meta/Facebook: `https://vid-ali-b36b.vercel.app/api/social/oauth/callback/facebook`

The app uses server-side OAuth callbacks and a single-use, 10-minute state token. Account tokens are encrypted at rest with AES-256-GCM using `SOCIAL_TOKEN_ENCRYPTION_KEY`. Do not place secrets in source code or send them in chat.

Scopes requested:
- TikTok Login Kit: `user.info.basic,video.publish` (the app must have access to the relevant products/scopes; TikTok may require review/approval).
- YouTube: `openid,email,youtube.upload,youtube.readonly`
- Facebook: `public_profile,pages_show_list,pages_read_engagement,pages_manage_posts`

Current OAuth code establishes account authorization and stores encrypted tokens. Publishing workflows, token refresh/revocation, selecting Facebook Pages and full page-token handling are still separate implementation work; do not enable auto-publish until those are complete and tested.

TikTok docs: https://developers.tiktok.com/docs/en/login-kit-web/
YouTube docs: https://developers.google.com/youtube/v3/guides/authentication
Meta docs: https://developers.facebook.com/docs/
