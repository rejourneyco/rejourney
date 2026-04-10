export function isAbortLikeError(err: unknown): boolean {
    const candidate = err as { code?: string; name?: string; message?: string } | null;
    const code = candidate?.code;
    const name = candidate?.name;
    const message = String(candidate?.message ?? err).toLowerCase();

    return (
        code === 'ECONNRESET' ||
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        code === 'ABORT_ERR' ||
        name === 'AbortError' ||
        message.includes('aborted') ||
        message.includes('premature close') ||
        message.includes('socket hang up') ||
        message.includes('client network socket disconnected')
    );
}
