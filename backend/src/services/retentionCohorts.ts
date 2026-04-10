export interface RetentionCohortActivity {
    userKey: string;
    weekStartKey: string;
}

export interface RetentionCohortRow {
    weekStartKey: string;
    users: number;
    retention: Array<number | null>;
}

interface BuildRetentionCohortRowsOptions {
    weeks?: number;
    maxRows?: number;
}

export function buildRetentionCohortRows(
    activities: RetentionCohortActivity[],
    options: BuildRetentionCohortRowsOptions = {}
): RetentionCohortRow[] {
    const weeks = Math.max(1, Math.floor(options.weeks ?? 6));
    const maxRows = Math.max(1, Math.floor(options.maxRows ?? 6));

    const weeklyActiveUsers = new Map<string, Set<string>>();
    const userFirstWeek = new Map<string, string>();

    for (const activity of activities) {
        const userKey = activity.userKey?.trim();
        const weekStartKey = activity.weekStartKey?.trim();
        if (!userKey || !weekStartKey) continue;

        if (!weeklyActiveUsers.has(weekStartKey)) {
            weeklyActiveUsers.set(weekStartKey, new Set<string>());
        }
        weeklyActiveUsers.get(weekStartKey)!.add(userKey);

        const existingFirstWeek = userFirstWeek.get(userKey);
        if (!existingFirstWeek || weekStartKey < existingFirstWeek) {
            userFirstWeek.set(userKey, weekStartKey);
        }
    }

    const weekKeys = Array.from(weeklyActiveUsers.keys()).sort((a, b) => a.localeCompare(b));
    if (weekKeys.length === 0) return [];

    const weekIndex = new Map<string, number>();
    weekKeys.forEach((key, index) => weekIndex.set(key, index));

    const cohortMembers = new Map<string, Set<string>>();
    for (const [userKey, firstWeek] of userFirstWeek.entries()) {
        if (!cohortMembers.has(firstWeek)) {
            cohortMembers.set(firstWeek, new Set<string>());
        }
        cohortMembers.get(firstWeek)!.add(userKey);
    }

    const rows = weekKeys
        .map((cohortWeek) => {
            const members = cohortMembers.get(cohortWeek);
            if (!members || members.size === 0) return null;

            const index = weekIndex.get(cohortWeek);
            if (index === undefined) return null;

            const retention = Array.from({ length: weeks }, (_, offset) => {
                const targetWeek = weekKeys[index + offset];
                if (!targetWeek) return null;
                if (offset === 0) return 100;

                const activeUsers = weeklyActiveUsers.get(targetWeek);
                if (!activeUsers) return 0;

                let retained = 0;
                for (const userKey of members) {
                    if (activeUsers.has(userKey)) retained += 1;
                }

                return (retained / members.size) * 100;
            });

            return {
                weekStartKey: cohortWeek,
                users: members.size,
                retention,
            };
        })
        .filter((row): row is RetentionCohortRow => Boolean(row));

    return rows.slice(-maxRows);
}
