import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../client/api.js';
test('client reports connection loss and does not treat an HTML login page as a successful save', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await assert.rejects(api('/api/papers/id', { method: 'PATCH', body: '{}' }), e => e instanceof ApiError && e.status === 0 && /not been confirmed saved/.test(e.message));
        globalThis.fetch = async () => new Response('<html>Access login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
        await assert.rejects(api('/api/papers/id', { method: 'PATCH', body: '{}' }), e => e instanceof ApiError && /Access session/.test(e.message));
        globalThis.fetch = async () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } });
        await assert.rejects(api('/api/papers/id'), /not been confirmed saved/);
    }
    finally {
        globalThis.fetch = original;
    }
});
test('client exposes revision conflicts and retains actionable server messages', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async () => Response.json({ error: 'Changed on another device', details: { current: { revision: 7 } } }, { status: 409 });
        await assert.rejects(api('/api/papers/id'), e => e instanceof ApiError && e.status === 409 && e.message.includes('Changed on another device') && (e.details as {
            current: {
                revision: number;
            };
        }).current.revision === 7);
        globalThis.fetch = async () => Response.json({ error: 'Storage unavailable' }, { status: 500 });
        await assert.rejects(api('/api/papers/id'), /Storage unavailable/);
        globalThis.fetch = async () => Response.json({ revision: 8 });
        assert.deepEqual(await api('/api/papers/id'), { revision: 8 });
    }
    finally {
        globalThis.fetch = original;
    }
});

test('client diagnoses status and format without exposing login/proxy HTML, URLs or arbitrary headers', async () => {
    const original = globalThis.fetch;
    const requestId = '12345678-1234-1234-1234-123456789abc';
    try {
        for (const status of [200, 401, 403, 502, 504]) {
            globalThis.fetch = async () => new Response('<html>private email, token and cookie</html>', { status,
                headers: { 'Content-Type': 'text/html', 'X-Request-Id': requestId, 'Set-Cookie': 'private cookie' } });
            await assert.rejects(api('/api/import', { method: 'POST', body: '{}' }), e => {
                assert.ok(e instanceof ApiError);
                assert.equal(e.status, status);
                assert.match(e.message, new RegExp(`HTTP ${status}; HTML response`));
                assert.match(e.message, new RegExp(requestId));
                assert.match(e.message, /not been confirmed saved/);
                assert.doesNotMatch(e.message + JSON.stringify(e.details), /private|<html>|token|cookie/);
                return true;
            });
        }
        for (const [body, contentType, format] of [['bad gateway secret', 'text/plain', 'text'], ['', 'application/json', 'malformed JSON'], ['{broken', 'application/json', 'malformed JSON'], ['null', 'application/json', 'unexpected JSON'], ['"secret"', 'application/json', 'unexpected JSON'], ['{"ok":true}', 'text/html', 'HTML']]) {
            globalThis.fetch = async () => new Response(body, { status: 502, headers: { 'Content-Type': contentType, 'X-Request-Id': 'private-value' } });
            await assert.rejects(api('/api/import'), e => e instanceof ApiError && e.message.includes(`HTTP 502; ${format} response`) && !/private-value|secret/.test(e.message));
        }
        globalThis.fetch = async () => new Response('<html>secret</html>', { status: 502, headers: { 'Content-Type': 'text/html', 'CF-Ray': '1234567890abcdef-FCO' } });
        await assert.rejects(api('/api/import'), /reference 1234567890abcdef-FCO/);
        globalThis.fetch = async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/problem+json' } });
        assert.deepEqual(await api('/api/import'), { ok: true });
    } finally { globalThis.fetch = original; }
});
