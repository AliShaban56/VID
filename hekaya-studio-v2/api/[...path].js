import authStatus from '../server/routes/auth-status.js';
import changePassword from '../server/routes/change-password.js';
import createStory from '../server/routes/create-story.js';
import dbInit from '../server/routes/db-init.js';
import finalVideoStatus from '../server/routes/final-video-status.js';
import generateImage from '../server/routes/generate-image.js';
import library from '../server/routes/library.js';
import login from '../server/routes/login.js';
import mcp from '../server/routes/mcp.js';
import projects from '../server/routes/projects.js';
import providerStatus from '../server/routes/provider-status.js';
import renderFinalVideo from '../server/routes/render-final-video.js';
import scenes from '../server/routes/scenes.js';

const routes = {
  'auth-status': authStatus, 'change-password': changePassword, 'create-story': createStory,
  'db-init': dbInit, 'final-video-status': finalVideoStatus, 'generate-image': generateImage,
  library, login, mcp, projects, 'provider-status': providerStatus,
  'render-final-video': renderFinalVideo, scenes
};

export default async function handler(req,res) {
  const pathname = new URL(req.url || '/', 'https://hekaya.invalid').pathname;
  const path = pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const route = routes[path];
  if (!route) return res.status(404).json({error:'API route not found'});
  try { return await route(req,res); }
  catch (error) { console.error('Hekaya router error:', error?.message); return res.status(500).json({error:'Internal server error'}); }
}