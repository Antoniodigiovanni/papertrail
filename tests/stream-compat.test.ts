import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureStreamAsyncIteration } from '../client/stream-compat.js';

type IterableStream<T> = Omit<ReadableStream<T>, 'values' | typeof Symbol.asyncIterator> & {
    values(options?: { preventCancel?: boolean }): AsyncIterableIterator<T>;
    [Symbol.asyncIterator](options?: { preventCancel?: boolean }): AsyncIterableIterator<T>;
};
function fallback<T>(source: UnderlyingDefaultSource<T> = {}, strategy?: QueuingStrategy<T>): IterableStream<T> {
    class Stream extends ReadableStream<T> {}
    Object.defineProperties(Stream.prototype, {
        values: { value: undefined, configurable: true },
        [Symbol.asyncIterator]: { value: undefined, configurable: true },
    });
    ensureStreamAsyncIteration(Stream);
    return new Stream(source, strategy) as IterableStream<T>;
}
const native = <T>(source: UnderlyingDefaultSource<T> = {}, strategy?: QueuingStrategy<T>) => new ReadableStream(source, strategy) as IterableStream<T>;

for (const [name, create] of [['native', native], ['fallback', fallback]] as const) {
    test(`${name}: eager exclusive lock, chunks, exhaustion and promise-valued chunks`, async () => {
        const chunk = Promise.resolve('chunk');
        let canceled = false;
        const stream = create({ start(c) { c.enqueue(chunk); c.enqueue(undefined); c.close(); }, cancel() { canceled = true; } });
        const it = stream[Symbol.asyncIterator]();
        assert.equal(it[Symbol.asyncIterator](), it);
        assert.equal(stream.locked, true);
        assert.throws(() => stream.getReader(), TypeError);
        assert.throws(() => stream.values(), TypeError);
        assert.deepEqual(await it.next(), { done: false, value: chunk });
        assert.deepEqual(await it.next(), { done: false, value: undefined });
        assert.deepEqual(await it.next(), { done: true, value: undefined });
        assert.equal(stream.locked, false);
        assert.deepEqual(await it.next(), { done: true, value: undefined });
        assert.deepEqual(await it.return!('finished'), { done: true, value: 'finished' });
        assert.equal(canceled, false);
    });
    for (const exit of ['break', 'throw', 'return-before-next'] as const) {
        test(`${name}: ${exit} cancels exactly once and releases`, async () => {
            const reasons: unknown[] = [];
            const stream = create({ start(c) { c.enqueue(1); }, cancel(reason) { reasons.push(reason); } });
            const marker = new Error('consumer error');
            if (exit === 'return-before-next') {
                const it = stream.values();
                assert.deepEqual(await it.return!(marker), { done: true, value: marker });
                await it.return!();
            } else {
                const run = async () => { for await (const value of stream) { assert.equal(value, 1); if (exit === 'throw') throw marker; break; } };
                if (exit === 'throw') await assert.rejects(run(), error => error === marker);
                else await run();
            }
            assert.deepEqual(reasons, [exit === 'return-before-next' ? marker : undefined]);
            assert.equal(stream.locked, false);
        });
    }
    test(`${name}: preventCancel leaves unread data available`, async () => {
        const stream = create({ start(c) { c.enqueue(1); c.enqueue(2); c.close(); }, cancel() { assert.fail('must not cancel'); } });
        for await (const value of stream.values({ preventCancel: true })) { assert.equal(value, 1); break; }
        assert.equal(stream.locked, false);
        const reader = stream.getReader();
        assert.deepEqual(await reader.read(), { value: 2, done: false });
        reader.releaseLock();
        const untouched = create();
        await untouched.values({ preventCancel: true }).return!();
        assert.equal(untouched.locked, false);
    });
    test(`${name}: stream errors propagate unchanged, unlock and finish queued calls`, async () => {
        let controller!: ReadableStreamDefaultController;
        const stream = create({ start(c) { controller = c; }, cancel() { assert.fail('errored stream must not cancel'); } });
        const it = stream.values(), marker = new Error('read failure');
        const first = it.next(), second = it.next(), returned = it.return!('after error');
        controller.error(marker);
        await assert.rejects(first, error => error === marker);
        assert.deepEqual(await second, { done: true, value: undefined });
        assert.deepEqual(await returned, { done: true, value: 'after error' });
        assert.equal(stream.locked, false);
    });
    test(`${name}: cancellation rejection propagates but still unlocks and finishes`, async () => {
        const marker = new Error('cancel failure');
        const stream = create({ cancel() { throw marker; } });
        const it = stream.values();
        await assert.rejects(it.return!('reason'), error => error === marker);
        assert.equal(stream.locked, false);
        assert.deepEqual(await it.next(), { done: true, value: undefined });
    });
    test(`${name}: pending cancellation releases lock before it settles`, async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let canceled!: () => void;
        const started = new Promise<void>(resolve => { canceled = resolve; });
        const stream = create({ cancel() { canceled(); return gate; } });
        const result = stream.values().return!();
        await started;
        assert.equal(stream.locked, false);
        release(); await result;
    });
    test(`${name}: concurrent next and return serialize without dropping pending reads`, async () => {
        let controller!: ReadableStreamDefaultController<number>;
        const reasons: unknown[] = [];
        const stream = create<number>({ start(c) { controller = c; }, cancel(reason) { reasons.push(reason); } }, { highWaterMark: 0 });
        const it = stream.values();
        const first = it.next(), second = it.next(), returned = it.return!('stop'), last = it.next();
        assert.deepEqual(reasons, []);
        controller.enqueue(1);
        assert.deepEqual(await first, { done: false, value: 1 });
        assert.deepEqual(reasons, []);
        controller.enqueue(2);
        assert.deepEqual(await second, { done: false, value: 2 });
        assert.deepEqual(await returned, { done: true, value: 'stop' });
        assert.deepEqual(await last, { done: true, value: undefined });
        assert.deepEqual(reasons, ['stop']);
        assert.equal(stream.locked, false);
    });
}

test('feature detection preserves native APIs and is idempotent', () => {
    const symbol = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator);
    const values = Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'values');
    ensureStreamAsyncIteration(); ensureStreamAsyncIteration();
    assert.deepEqual(Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator), symbol);
    assert.deepEqual(Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'values'), values);
    class PartialStream extends ReadableStream<unknown> {}
    Object.defineProperty(PartialStream.prototype, Symbol.asyncIterator, { value: undefined, configurable: true });
    ensureStreamAsyncIteration(PartialStream);
    assert.equal(PartialStream.prototype[Symbol.asyncIterator], values!.value);
});

test('missing/immutable stream support fails with actionable messages', () => {
    assert.throws(() => ensureStreamAsyncIteration(null as unknown as typeof ReadableStream), /Update your browser/);
    class FrozenStream extends ReadableStream<unknown> {}
    Object.defineProperty(FrozenStream.prototype, Symbol.asyncIterator, { value: undefined });
    Object.freeze(FrozenStream.prototype);
    assert.throws(() => ensureStreamAsyncIteration(FrozenStream), /Update your browser/);
});
