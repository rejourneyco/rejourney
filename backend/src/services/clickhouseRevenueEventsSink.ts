import { config } from '../config.js';
import { getClickHouseClient, isClickHouseDualWriteEnabled } from '../db/clickhouse.js';
import { logger } from '../logger.js';

export type ClickHouseRevenueEventRow = {
    project_id: string;
    provider: string;
    event_date: string;
    event_time: string;
    external_transaction_id: string;
    external_source_id: string;
    session_id: string;
    visitor_id: string;
    user_display_id: string;
    anonymous_hash: string;
    anonymous_display_id: string;
    device_id: string;
    platform: string;
    app_version: string;
    event_name: string;
    currency: string;
    amount_cents: number;
    gross_amount_cents: number;
    refund_amount_cents: number;
    fee_cents: number;
    net_cents: number;
    type: string;
    reporting_category: string;
    metadata_json: string;
    is_deleted: number;
    schema_version: number;
};

function toClickHouseDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').replace('Z', '');
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function metadataJson(): string {
    return '{}';
}

export function buildClickHouseRevenueEventRow(input: {
    projectId: string;
    provider: string;
    occurredAt: Date;
    externalTransactionId: string;
    externalSourceId?: string | null;
    amountCents: number;
    grossAmountCents: number;
    refundAmountCents: number;
    feeCents: number;
    netCents: number;
    currency: string;
    type: string;
    reportingCategory?: string | null;
    metadata?: Record<string, unknown> | null;
    isDeleted?: boolean;
}): ClickHouseRevenueEventRow {
    const metadata = input.metadata ?? {};
    const eventName = stringValue(metadata.eventName) || input.reportingCategory || input.type;

    return {
        project_id: input.projectId,
        provider: input.provider,
        event_date: input.occurredAt.toISOString().slice(0, 10),
        event_time: toClickHouseDateTime(input.occurredAt),
        external_transaction_id: input.externalTransactionId,
        external_source_id: '',
        session_id: '',
        visitor_id: '',
        user_display_id: '',
        anonymous_hash: '',
        anonymous_display_id: '',
        device_id: '',
        platform: stringValue(metadata.platform) || 'unknown',
        app_version: stringValue(metadata.appVersion),
        event_name: eventName,
        currency: input.currency.toLowerCase(),
        amount_cents: input.amountCents,
        gross_amount_cents: input.grossAmountCents,
        refund_amount_cents: input.refundAmountCents,
        fee_cents: input.feeCents,
        net_cents: input.netCents,
        type: input.type,
        reporting_category: input.reportingCategory || input.type,
        metadata_json: metadataJson(),
        is_deleted: input.isDeleted ? 1 : 0,
        schema_version: 1,
    };
}

export async function writeRevenueEventsToClickHouse(params: {
    dedupeKey: string;
    rows: ClickHouseRevenueEventRow[];
}): Promise<void> {
    if (!isClickHouseDualWriteEnabled() || params.rows.length === 0) return;

    try {
        const settings = {
            ...(config.CLICKHOUSE_ASYNC_INSERT ? { async_insert: 1 as const, wait_for_async_insert: 1 as const } : {}),
            insert_deduplication_token: `revenue-events:${params.dedupeKey}:v1`,
        };

        await getClickHouseClient().insert({
            table: 'revenue_events',
            values: params.rows,
            format: 'JSONEachRow',
            clickhouse_settings: settings,
        });
    } catch (err) {
        logger.warn({
            err,
            dedupeKey: params.dedupeKey,
            rowCount: params.rows.length,
        }, 'ClickHouse revenue event insert failed');
    }
}
