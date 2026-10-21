// Isolated built HTTP-handler reproduction. No production storage or credentials.
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../dist/server/app.js';
import { Store } from '../dist/server/store.js';
await mkdir('test-results', { recursive: true });
const directory = await mkdtemp(path.resolve('test-results/import-route-'));
const store = new Store(directory);
try {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'isolated-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://isolated-test.cloudflareaccess.com', aud: ['isolated-library'], sub: 'synthetic-user', iat: now, exp: now + 300 })).toString('base64url');
  const token = `${header}.${body}.${sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')}`;
  const app = createApp({ store, publicOrigin: 'https://read.antovanni.com', auth: {
    mode: 'access', host: '127.0.0.1', teamDomain: 'isolated-test.cloudflareaccess.com', audience: 'isolated-library',
    jwks: async () => [{ ...publicKey.export({ format: 'jwk' }), kid: 'isolated-key', alg: 'RS256' }],
  } });
  const response = await app.request('http://127.0.0.1:8350/api/import', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://read.antovanni.com', 'Cf-Access-Jwt-Assertion': token },
    body: JSON.stringify({ reference: 'https://arxiv.org/abs/2608.12594' }) });
  const result = await response.json();
  console.log(JSON.stringify({ status: response.status, contentType: response.headers.get('content-type'),
    requestId: response.headers.get('x-request-id'), error: result.error, warning: result.warning,
    title: result.paper?.title, arxiv: result.paper?.arxiv, pages: result.paper?.pageCount,
    pdfBytes: result.paper?.pdfSha ? store.pdfBytes(result.paper.pdfSha).length : 0 }, null, 2));
  if (!response.ok) process.exitCode = 1;
} finally { store.close(); await rm(directory, { recursive: true, force: true }); }
