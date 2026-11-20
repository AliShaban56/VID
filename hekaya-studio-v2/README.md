# Hekaya Studio v2

## Turso database setup
1. Create a database in https://app.turso.tech/ (for example, hekaya-studio).
2. In Turso, generate a database auth token.
3. In Vercel project settings > Environment Variables, add:
   - TURSO_DATABASE_URL (the database URL, typically libsql://...)
   - TURSO_AUTH_TOKEN (secret token)
4. Redeploy.
5. In the app, use **اختبار قاعدة البيانات** to initialize schema.

Never commit credentials. Database API currently needs authentication/authorization added before exposing it to multiple users or storing sensitive data; endpoints are intended as a single-user MVP.

Tables: projects, scenes, generation_jobs, settings.

Image generation: POST /api/generate-image. The endpoint assumes OpenAI-style API formatting and should be validated with the actual provider.
