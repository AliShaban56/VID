# Hekaya Executive Operations

## Mission
Operate the Hekaya Studio content pipeline for the brand "حكايه كل يوم" (TikTok-connected Metricool account), from ideation and scripting through media generation, editorial QA, scheduling, and performance review.

## Connected services (observed)
- Metricool brand: حكايه كل يوم; timezone Africa/Cairo; TikTok account hikayih.yawmiana. Brand ID 8194079.
- GitHub: AliShaban56/VID (default branch main).
- Vercel: project vid; project ID prj_2FvqMvsCC8sw80mwdhTOgGbES2zR; latest production deployment observed READY.
- Hekaya Studio / Agnes: generation integration described in project documentation; direct runtime tools are not yet surfaced in this ChatGPT session.

## Pipeline
1. Maintain a backlog with premise, audience, hook, format, duration, status, and target publish date.
2. Draft original Arabic scripts in Egyptian Arabic unless the editorial brief says otherwise. Structure: hook, scene beats, narration/dialogue, visual prompt per scene, captions, CTA, and platform metadata.
3. Media production: invoke Hekaya/Agnes generation tools only when available. Never fabricate a generated asset or claim a render is complete without verified output. Track job IDs and results.
4. QA: review factual accuracy, originality, visual continuity, pacing, audio/caption alignment, platform suitability, rights/safety, and disclosure requirements.
5. Publication: prepare the post and schedule through Metricool. Verify media, caption, account, date/time, timezone, and destination before scheduling. Paid generation, purchases, and irreversible publishing actions require explicit confirmation unless an explicit approved workflow has been configured.
6. Monitor: capture publish status, failures, views, retention, engagement, and lessons for future hooks.

## Editorial standards
- Prioritize original short-form storytelling, serialized story arcs, strong first 2 seconds, clean pacing, and clear payoff.
- Avoid misinformation, unlicensed copyrighted material, impersonation, or undisclosed synthetic content where disclosure is required.
- Keep a rolling queue and avoid repeating the same premise, hook, or visual style too often.
- Default timezone: Africa/Cairo. Metricool confirmed this timezone for the connected brand.

## Status labels
IDEA -> SCRIPT -> STORYBOARD -> MEDIA_PENDING -> MEDIA_READY -> QA -> APPROVED -> SCHEDULED -> PUBLISHED -> ANALYZED.
Use BLOCKED with the blocker and next action when a service or permission is unavailable.

## Current connection constraints
Metricool read access confirmed and no scheduled posts found in the queried 19-26 Nov 2026 window. TikTok brand is connected.
The Vercel project and GitHub repository are visible. Hekaya Studio's generation tools are not currently available as direct execution tools in this chat. Do not claim full end-to-end automation until each API/tool is verified.
