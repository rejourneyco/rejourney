import { getClickHouseClient, isClickHouseConfigured } from '../src/db/clickhouse.js';

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

async function countRows(query: string): Promise<number> {
    const result = await getClickHouseClient().query({
        query,
        format: 'JSONEachRow',
    });
    const rows = await result.json<{ count: string | number }[]>();
    return Number(rows[0]?.count ?? 0);
}

async function command(query: string): Promise<void> {
    await getClickHouseClient().command({ query });
}

async function main(): Promise<void> {
    if (!isClickHouseConfigured()) {
        console.log('[clickhouse-anonymize] ClickHouse disabled; skipping');
        return;
    }

    const apply = hasFlag('--apply');
    const apiRows = await countRows(`
        SELECT count() AS count
        FROM rejourney.api_endpoint_request_events
        WHERE session_id != '' OR artifact_id != ''
    `);
    const revenueRows = await countRows(`
        SELECT count() AS count
        FROM rejourney.revenue_events
        WHERE session_id != ''
           OR visitor_id != ''
           OR user_display_id != ''
           OR anonymous_hash != ''
           OR anonymous_display_id != ''
           OR device_id != ''
           OR external_source_id != ''
           OR metadata_json != '{}'
    `);

    console.log('[clickhouse-anonymize] identity-bearing rows', {
        api_endpoint_request_events: apiRows,
        revenue_events: revenueRows,
        apply,
    });

    if (!apply) {
        console.log('[clickhouse-anonymize] dry run only; pass --apply after backups are verified');
        return;
    }

    if (apiRows > 0) {
        await command(`
            ALTER TABLE rejourney.api_endpoint_request_events
            UPDATE session_id = '', artifact_id = ''
            WHERE session_id != '' OR artifact_id != ''
        `);
    }

    if (revenueRows > 0) {
        await command(`
            ALTER TABLE rejourney.revenue_events
            UPDATE
                session_id = '',
                visitor_id = '',
                user_display_id = '',
                anonymous_hash = '',
                anonymous_display_id = '',
                device_id = '',
                external_source_id = '',
                metadata_json = '{}'
            WHERE session_id != ''
               OR visitor_id != ''
               OR user_display_id != ''
               OR anonymous_hash != ''
               OR anonymous_display_id != ''
               OR device_id != ''
               OR external_source_id != ''
               OR metadata_json != '{}'
        `);
    }

    console.log('[clickhouse-anonymize] mutations submitted');
}

main().catch((err) => {
    console.error('[clickhouse-anonymize] failed', err instanceof Error ? err.message : err);
    process.exit(1);
});
