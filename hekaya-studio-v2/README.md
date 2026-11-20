# Hekaya Studio v2

## Private studio access

Set these in Vercel → Project → Settings → Environment Variables. Never commit API keys to GitHub or put them in browser storage.

- `APP_ACCESS_PASSWORD` — required private studio login password.
- `AI_API_KEY` — required text-generation API key for story writing.
- `AI_BASE_URL` — optional OpenAI-compatible API base URL; defaults to `https://api.openai.com`.
- `AI_TEXT_MODEL` — optional text model; defaults to `gpt-4o-mini`.
- `SHOTSTACK_API_KEY` — required for final AI video production (video, voice, music and MP4 render).
- `SHOTSTACK_ENV` — `stage` for watermarked sandbox renders, or `v1` for production.
- `SHOTSTACK_VIDEO_MODEL` — optional; defaults to `seedance-2.0-text-to-video`.
- `SHOTSTACK_VIDEO_RESOLUTION` — optional; defaults to `720p`.
- `SHOTSTACK_TTS_MODEL` — optional; defaults to `elevenlabs-multilingual-v2`.
- `SHOTSTACK_TTS_VOICE` — optional voice name supported by the selected speech model.
- `SHOTSTACK_MUSIC_MODEL` — optional; defaults to `elevenlabs-music`.
- `SHOTSTACK_OUTPUT_RESOLUTION` — optional; defaults to `hd`.

After setting or changing variables, redeploy the Vercel project.

## AI production workflow

1. Sign into the private studio using the password from `APP_ACCESS_PASSWORD`.
2. Enter a story idea and choose genre, runtime, scene count, and visual style.
3. `POST /api/create-story` calls an OpenAI-compatible chat-completions API and returns the story, character/visual bible, narration, dialogue, camera notes, image prompts, video prompts, transitions, and sound design.
4. `POST /api/render-final-video` submits the scene prompts, generated voice-over, music, and video clips to Shotstack in one edit/render request.
5. `GET /api/final-video-status?id=...` polls the asynchronous render until the MP4 is ready.
6. When Turso is configured, projects, scenes, and final render jobs are saved.

Shotstack's stage renders are watermarked. AI media generation can still consume credits in stage and production; check the Shotstack usage/pricing for your account before rendering long films.

## Optional Turso database

1. Create a database in https://app.turso.tech/.
2. Generate a database auth token.
3. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to Vercel Environment Variables.
4. Redeploy, then use **اختبار قاعدة البيانات** to initialize the schema.

Tables: `projects`, `scenes`, `generation_jobs`, and `settings`.

## API routes

- `POST /api/login`, `GET /api/auth-status` — private session login.
- `POST /api/create-story` — write story and storyboard.
- `POST /api/render-final-video` — submit final MP4 render.
- `GET /api/final-video-status?id=...` — poll render status.
- `POST /api/generate-image` — optional standalone image generation using an OpenAI-compatible image API.
- `/api/projects`, `/api/scenes`, `POST /api/db-init` — Turso persistence.

All platform API routes require the private login session. Provider credentials stay in Vercel environment variables and are not sent to the browser.
