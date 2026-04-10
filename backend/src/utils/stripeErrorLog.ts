/**
 * Structured fields for logs when Stripe SDK throws (helps debug 3DS / card errors).
 */
export function stripeErrorLogFields(err: unknown): Record<string, unknown> {
    if (!err || typeof err !== 'object') {
        return { nonObjectError: String(err) };
    }
    const e = err as Record<string, unknown>;
    const raw = e.raw as Record<string, unknown> | undefined;
    const pi = e.payment_intent;
    let paymentIntentId: string | undefined;
    let paymentIntentStatus: string | undefined;
    if (typeof pi === 'string') {
        paymentIntentId = pi;
    } else if (pi && typeof pi === 'object') {
        paymentIntentId = (pi as { id?: string }).id;
        paymentIntentStatus = (pi as { status?: string }).status;
    }
    return {
        stripeErrorName: e.name,
        stripeMessage: e.message,
        stripeType: e.type,
        stripeCode: e.code,
        stripeStatusCode: e.statusCode,
        declineCode: e.decline_code,
        docUrl: e.doc_url,
        stripeRequestId: e.requestId,
        paymentIntentId,
        paymentIntentStatus,
        charge: e.charge,
        rawType: raw?.type,
        rawCode: raw?.code,
        rawDeclineCode: raw?.decline_code,
        rawMessage: raw?.message,
    };
}
