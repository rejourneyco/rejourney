const FRAME_REQUEST_TIMEOUT_MS = 6000;
const cleanups = new WeakMap<HTMLImageElement, () => void>();
export const screenshotImagesOnFallback = new WeakSet<HTMLImageElement>();

export function disposeScreenshotImage(image: HTMLImageElement): void {
    cleanups.get(image)?.();
    cleanups.delete(image);
}

/** Bound both signed-URL and proxy attempts, including requests that never emit an error. */
export function loadScreenshotImage(
    frame: { url: string; proxyUrl?: string | null },
    priority: 'high' | 'low' | 'auto',
    onLoad: () => void,
    onFailure: () => void,
): HTMLImageElement {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = priority;
    let timer: ReturnType<typeof setTimeout>;
    let usedFallback = false;
    const cleanup = () => {
        clearTimeout(timer);
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
        screenshotImagesOnFallback.delete(image);
    };
    const start = (url: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => image.dispatchEvent(new Event('error')), FRAME_REQUEST_TIMEOUT_MS);
        image.src = url;
    };
    const loaded = () => {
        disposeScreenshotImage(image);
        onLoad();
    };
    const failed = () => {
        if (!usedFallback && frame.proxyUrl && frame.proxyUrl !== frame.url) {
            usedFallback = true;
            screenshotImagesOnFallback.add(image);
            start(frame.proxyUrl);
            return;
        }
        disposeScreenshotImage(image);
        image.removeAttribute('src');
        onFailure();
    };
    cleanups.set(image, cleanup);
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    start(frame.url);
    return image;
}
