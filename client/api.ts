import type { Paper, Annotation } from '../server/store.js';
import type { PaperPatch } from '../server/schema.js';
export type PaperDetail = Paper & {
    annotations: Annotation[];
    noteHtml: string;
};
export type PaperChanges = Omit<PaperPatch, 'revision'>;
export type SavePaper = (changes: PaperChanges | ((current: PaperDetail) => PaperChanges)) => Promise<void>;
export type Label = {
    id: string;
    name: string;
};
export type Library = {
    papers: Paper[];
    projects: Label[];
    tags: Label[];
    total: number;
};
export class ApiError extends Error {
    constructor(message: string, public status: number, public details?: unknown) { super(message); }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, { ...options, headers: { ...(options.body instanceof File || options.body instanceof Blob ? {} : options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    }
    catch {
        throw new ApiError('Connection lost. Your changes have not been confirmed saved. Reconnect and check the library before retrying an import.', 0);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    const isJson = contentType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(contentType);
    const nativeId = response.headers.get('x-request-id') || '';
    const ray = response.headers.get('cf-ray') || '';
    // Never echo response HTML, redirected URLs, statusText, or arbitrary headers.
    const reference = /^[a-f0-9-]{36}$/i.test(nativeId) ? nativeId : /^[a-f0-9]{16,32}-[A-Z]{3}$/i.test(ray) ? ray : '';
    const diagnostic = (format: string) => `HTTP ${response.status}; ${format} response${reference ? `; reference ${reference}` : ''}`;
    const unexpected = (format: string): never => {
        const advice = response.status === 401 || response.status === 403 || response.redirected || contentType === 'text/html'
            ? 'Check your Access session and connection.'
            : response.status >= 500 ? 'The server or proxy could not complete the request. Retry after checking the connection.' : 'The API did not return the expected JSON format.';
        throw new ApiError(`Unexpected server response (${diagnostic(format)}). ${advice} Your changes have not been confirmed saved. Check the library before retrying an import.`, response.status, { responseFormat: format, requestId: reference || undefined });
    };
    if (!isJson) unexpected(contentType === 'text/html' ? 'HTML' : !contentType ? 'unknown format' : contentType.startsWith('text/') ? 'text' : 'non-JSON');
    let result;
    try {
        result = await response.json();
    }
    catch {
        return unexpected('malformed JSON');
    }
    if (!result || typeof result !== 'object') unexpected('unexpected JSON');
    if (!response.ok) {
        const message = typeof result.error === 'string' ? result.error.slice(0, 2000) : 'Request failed.';
        throw new ApiError(`${message} (${diagnostic('JSON')})`, response.status, result.details);
    }
    return result;
}
export const patch = (fields: unknown) => ({ method: 'PATCH', body: JSON.stringify(fields) });
