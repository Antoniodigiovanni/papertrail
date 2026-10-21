// Reader zoom is relative to the available width, independent of screen density.
export const MIN_ZOOM = .5;
export const MAX_ZOOM = 3;
export const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
export function pinchZoom(startZoom: number, startDistance: number, distance: number) {
    return clampZoom(startZoom * distance / Math.max(1, startDistance));
}
export function canvasScale(width: number, height: number, density: number) {
    // Bound both dimensions AND area. Large canvases can silently fail on mobile.
    return Math.min(density || 1, 2, 4096 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
}
export function anchoredScroll(scroll: number, pageStart: number, pageSize: number, fraction: number, client: number) {
    return scroll + pageStart + pageSize * fraction - client;
}
