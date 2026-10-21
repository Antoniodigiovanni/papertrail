type StreamOptions = { preventCancel?: boolean };
type StreamIterator = AsyncIterableIterator<unknown>;
type StreamValues = (this: ReadableStream, options?: StreamOptions | null) => StreamIterator;

// Streams Standard §4.2.5: lock at creation, serialize operations, cancel on
// early return unless preventCancel, and release on close/error/return.
function values(this: ReadableStream, options?: StreamOptions | null): StreamIterator {
    const preventCancel = Boolean(options?.preventCancel);
    const reader = this.getReader();
    let finished = false;
    let pending: Promise<unknown> = Promise.resolve();
    const enqueue = (operation: () => Promise<IteratorResult<unknown>>) => {
        const result = pending.then(operation);
        // A rejected read/return must not poison subsequent iterator operations.
        pending = result.then(() => undefined, () => undefined);
        return result;
    };
    return {
        [Symbol.asyncIterator]() { return this; },
        next() {
            return enqueue(async () => {
                if (finished) return { done: true, value: undefined };
                try {
                    const result = await reader.read();
                    if (result.done) { finished = true; reader.releaseLock(); }
                    return result;
                } catch (error) {
                    finished = true;
                    reader.releaseLock();
                    throw error;
                }
            });
        },
        return(value?: unknown) {
            return enqueue(async () => {
                if (!finished) {
                    finished = true;
                    // Release before awaiting the underlying cancel algorithm,
                    // including when cancellation rejects or remains pending.
                    let cancellation: Promise<void> | undefined;
                    try { if (!preventCancel) cancellation = reader.cancel(value); }
                    finally { reader.releaseLock(); }
                    await cancellation;
                }
                return { done: true, value };
            });
        },
    };
}

export function ensureStreamAsyncIteration(Stream: { prototype: ReadableStream } = globalThis.ReadableStream): void {
    if (!Stream || typeof Stream.prototype?.getReader !== 'function') {
        throw new Error('PDF reading requires browser ReadableStream support. Update your browser and reload the PDF.');
    }
    const prototype = Stream.prototype as ReadableStream & {
        values?: StreamValues;
        [Symbol.asyncIterator]?: StreamValues;
    };
    // Leave native implementations untouched. A partial implementation can use
    // its existing values method for the missing symbol alias.
    if (typeof prototype[Symbol.asyncIterator] === 'function') return;
    const iterate = typeof prototype.values === 'function' ? prototype.values : values;
    try {
        if (typeof prototype.values !== 'function') {
            Object.defineProperty(prototype, 'values', { value: iterate, configurable: true, writable: true });
        }
        Object.defineProperty(prototype, Symbol.asyncIterator, { value: iterate, configurable: true, writable: true });
    } catch {
        throw new Error('PDF stream compatibility could not be enabled. Update your browser and reload the PDF.');
    }
}
