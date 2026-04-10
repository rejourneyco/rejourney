export function hasSuccessfulRecording(
    session: any,
    _metrics?: any,
    readyScreenshotArtifacts = false
): boolean {
    return Boolean(session?.replayAvailable) || readyScreenshotArtifacts;
}
