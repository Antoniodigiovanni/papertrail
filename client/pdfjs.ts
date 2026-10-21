import { ensureStreamAsyncIteration } from './stream-compat.js';

export type TextContent = {
    items: ({
        str: string;
        hasEOL?: boolean;
    } | {
        type: string;
    })[];
    styles: Record<string, unknown>;
};
export type Viewport = {
    width: number;
    height: number;
    scale: number;
    rotation: number;
    rawDims: {
        pageWidth: number;
        pageHeight: number;
        pageX: number;
        pageY: number;
    };
};
export type RenderTask = {
    promise: Promise<void>;
    cancel: () => void;
};
export type PdfPage = {
    getViewport: (options: {
        scale: number;
    }) => Viewport;
    render: (options: {
        canvas: HTMLCanvasElement;
        canvasContext: CanvasRenderingContext2D;
        viewport: Viewport;
        transform?: number[];
    }) => RenderTask;
    getTextContent: () => Promise<TextContent>;
};
export type PdfDocument = {
    numPages: number;
    getPage: (page: number) => Promise<PdfPage>;
    destroy: () => Promise<void>;
};
export type PdfJs = {
    GlobalWorkerOptions: {
        workerSrc: string;
    };
    getDocument: (options: Record<string, unknown>) => {
        promise: Promise<PdfDocument>;
        destroy: () => Promise<void>;
    };
    TextLayer: new (options: {
        textContentSource: TextContent;
        container: HTMLElement;
        viewport: Viewport;
    }) => {
        render: () => Promise<void>;
        cancel: () => void;
        textDivs: HTMLElement[];
    };
};
let modulePromise: Promise<PdfJs> | undefined;
export function loadPdfJs(): Promise<PdfJs> {
    const moduleUrl = '/vendor/pdfjs/pdf.mjs';
    modulePromise ??= (async () => {
        ensureStreamAsyncIteration();
        const module: PdfJs = await import(/* @vite-ignore */ moduleUrl);
        module.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
        return module;
    })();
    return modulePromise;
}
