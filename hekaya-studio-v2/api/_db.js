import { createClient } from '@libsql/client';
let client;
export function db(){if(!client){if(!process.env.TURSO_DATABASE_URL||!process.env.TURSO_AUTH_TOKEN)throw new Error('Turso database is not configured');client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});}return client;}
export async function init(){const d=db();await d.batch([
'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,story TEXT NOT NULL DEFAULT "",created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
'CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,position INTEGER NOT NULL,text TEXT NOT NULL DEFAULT "",image_prompt TEXT NOT NULL DEFAULT "",video_prompt TEXT NOT NULL DEFAULT "",image_url TEXT NOT NULL DEFAULT "",video_url TEXT NOT NULL DEFAULT "",status TEXT NOT NULL DEFAULT "draft",created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
'CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY,project_id TEXT,scene_id TEXT,kind TEXT NOT NULL,model TEXT,prompt TEXT,status TEXT NOT NULL DEFAULT "pending",result_url TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
'CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
], 'write');return d;}
