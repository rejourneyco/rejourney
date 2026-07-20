export type ReplayEventPayloadNormalization = {
    payload: any;
    properties: any | null;
};

function parseObjectPayload(value: unknown): any | null {
    if (value !== null && typeof value === 'object') {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed);
        return parsed !== null && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Normalize the different payload shapes emitted by Rejourney SDKs.
 *
 * Browser events contain object-valued `payload` / `properties`, while native
 * and React Native SDKs serialize custom-event payloads as JSON strings.
 * Replay consumers expect an object in `properties`, so parse native payloads
 * here while retaining invalid or non-object payloads in their original form.
 */
export function normalizeReplayEventPayload(event: any): ReplayEventPayloadNormalization {
    const rawPayload =
        event?.payload ??
        event?.payloadInline ??
        event?.details ??
        event?.properties ??
        null;
    const parsedPayload = parseObjectPayload(rawPayload);
    const properties =
        parsedPayload ??
        parseObjectPayload(event?.details) ??
        parseObjectPayload(event?.properties);

    return {
        payload: parsedPayload ?? rawPayload,
        properties,
    };
}
