import { serve } from '@hono/node-server';
import { Store } from './store.js';
import { createApp } from './app.js';
import { Server } from 'node:http';
const mode = process.env.AUTH_MODE || 'access';
if (mode !== 'access' && mode !== 'development')
    throw new Error('AUTH_MODE must be access or development.');
const host = process.env.HOST || (mode === 'development' ? '127.0.0.1' : '0.0.0.0');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT.');
const store = new Store(process.env.DATA_DIR || 'data');
const app = createApp({ store, auth: { mode, host, teamDomain: process.env.ACCESS_TEAM_DOMAIN, audience: process.env.ACCESS_AUDIENCE }, publicOrigin: process.env.PUBLIC_ORIGIN, clientDirectory: 'dist/client' });
const server = serve({ fetch: app.fetch, hostname: host, port }, () => console.log(`Papertrail listening on ${host}:${port} (${mode})`));
if (server instanceof Server) {
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
}
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { server.close(() => { store.close(); process.exit(0); }); });
