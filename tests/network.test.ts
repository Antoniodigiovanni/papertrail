import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type https from 'node:https';
import type dns from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { safeFetch } from '../server/providers.js';
// Deterministic transport doubles: no provider responses are used by the application.
function transport(responses: {
    status: number;
    headers?: Record<string, string>;
    bytes?: string;
}[], seen: string[]) {
    return ((url: URL, _options: unknown, respond: (response: IncomingMessage) => void) => {
        seen.push(url.href);
        const request = new EventEmitter() as ClientRequest;
        request.destroy = (error?: Error) => { queueMicrotask(() => { if (error)
            request.emit('error', error); request.emit('close'); }); return request; };
        queueMicrotask(() => {
            const fixture = responses.shift();
            if (!fixture) {
                request.destroy(new Error('No fixture'));
                return;
            }
            const stream = new PassThrough();
            const response = stream as unknown as IncomingMessage;
            response.statusCode = fixture.status;
            response.headers = fixture.headers || {};
            response.on('end', () => request.emit('close'));
            response.on('close', () => request.emit('close'));
            respond(response);
            stream.end(fixture.bytes || '');
        });
        return request;
    }) as unknown as typeof https.get;
}
test('every redirect destination is allowlisted before transport; private redirect is never requested', async () => {
    const seen: string[] = [];
    const request = transport([{ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }], seen);
    await assert.rejects(safeFetch('https://arxiv.org/pdf/2401.12345', 1000, undefined, Date.now() + 1000, 0, request), /approved provider/);
    assert.deepEqual(seen, ['https://arxiv.org/pdf/2401.12345']);
});
test('redirect loops, malformed redirects, download limits and encodings fail closed', async () => {
    const loops = Array.from({ length: 5 }, () => ({ status: 302, headers: { location: 'https://arxiv.org/again' } }));
    const seen: string[] = [];
    await assert.rejects(safeFetch('https://arxiv.org/start', 1000, undefined, Date.now() + 1000, 0, transport(loops, seen)), /redirect or time limit/);
    assert.equal(seen.length, 4);
    await assert.rejects(safeFetch('https://arxiv.org/start', 1000, undefined, Date.now() + 1000, 0, transport([{ status: 302, headers: { location: 'https://[bad' } }], [])), /invalid redirect/);
    await assert.rejects(safeFetch('https://arxiv.org/pdf/x', 10, undefined, Date.now() + 1000, 0, transport([{ status: 200, bytes: 'This is over ten bytes' }], [])), /exceeded its limit/);
    await assert.rejects(safeFetch('https://arxiv.org/pdf/x', 10, undefined, Date.now() + 1000, 0, transport([{ status: 200, headers: { 'content-length': '200' } }], [])), /download limit/);
    await assert.rejects(safeFetch('https://arxiv.org/pdf/x', 1000, undefined, Date.now() + 1000, 0, transport([{ status: 200, headers: { 'content-encoding': 'gzip' } }], [])), /compressed/);
});
test('private DNS answer is rejected at the socket lookup boundary', async () => {
    const lookup = ((_host: unknown, _options: unknown, callback: (error: Error | null, addresses: {
        address: string;
        family: number;
    }[]) => void) => callback(null, [{ address: '127.0.0.1', family: 4 }])) as unknown as typeof dns.lookup;
    const request = ((_url: URL, options: {
        lookup: (host: string, options: unknown, cb: (error: Error | null, address: string, family: number) => void) => void;
    }) => {
        const req = new EventEmitter() as ClientRequest;
        req.destroy = (error?: Error) => { queueMicrotask(() => { if (error)
            req.emit('error', error); req.emit('close'); }); return req; };
        queueMicrotask(() => options.lookup('arxiv.org', {}, error => { assert.match(error!.message, /private or reserved/); req.destroy(error!); }));
        return req;
    }) as unknown as typeof https.get;
    await assert.rejects(safeFetch('https://arxiv.org/pdf/x', 1000, undefined, Date.now() + 1000, 0, request, lookup), /Could not reach/);
});
test('provider timeouts abort the request and an approved redirect returns bounded bytes', async () => {
    let aborted = false;
    const hanging = (() => { const req = new EventEmitter() as ClientRequest; req.destroy = (error?: Error) => { aborted = true; queueMicrotask(() => { req.emit('error', error); req.emit('close'); }); return req; }; return req; }) as unknown as typeof https.get;
    await assert.rejects(safeFetch('https://arxiv.org/pdf/x', 1000, undefined, Date.now() + 20, 0, hanging), /Could not reach/);
    assert.equal(aborted, true);
    const seen: string[] = [];
    const bytes = await safeFetch('https://arxiv.org/start', 1000, undefined, Date.now() + 1000, 0, transport([{ status: 302, headers: { location: '/final' } }, { status: 200, bytes: 'approved content' }], seen));
    assert.equal(bytes.toString(), 'approved content');
    assert.deepEqual(seen, ['https://arxiv.org/start', 'https://arxiv.org/final']);
});
