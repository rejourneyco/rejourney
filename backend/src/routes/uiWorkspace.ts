import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, teamMembers, uiWorkspaces, projects } from '../db/client.js';
import { sessionAuth, asyncHandler, ApiError } from '../middleware/index.js';
import { validate } from '../middleware/validation.js';
import {
    workspaceQuerySchema,
    workspaceUpsertSchema,
    workspaceReopenSchema,
    workspaceReorderSchema,
    tabStateSchema,
} from '../validation/workspace.js';

const router = Router();

async function assertTeamAccess(teamId: string, userId: string) {
    const [membership] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);
    if (!membership) {
        throw ApiError.forbidden('No access to team');
    }
}

async function assertProjectAccess(projectId: string, teamId: string) {
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.teamId, teamId))).limit(1);
    if (!project) {
        throw ApiError.forbidden('Project not in team');
    }
}

function normalizeTabs(rawTabs: any[]) {
    // Ensure tabs match schema; invalid tabs are filtered out
    const safeTabs: any[] = [];
    for (const t of rawTabs || []) {
        const parsed = tabStateSchema.safeParse(t);
        if (parsed.success) {
            safeTabs.push(parsed.data);
        }
    }
    return safeTabs;
}

router.get(
    '/workspace',
    sessionAuth,
    validate(workspaceQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
        const { teamId, projectId, key = 'default' } = req.query as any;
        await assertTeamAccess(teamId, req.user!.id);
        await assertProjectAccess(projectId, teamId);

        const [workspace] = await db
            .select()
            .from(uiWorkspaces)
            .where(
                and(
                    eq(uiWorkspaces.userId, req.user!.id),
                    eq(uiWorkspaces.teamId, teamId),
                    eq(uiWorkspaces.projectId, projectId),
                    eq(uiWorkspaces.workspaceKey, key || 'default')
                )
            )
            .limit(1);

        if (!workspace) {
            res.json({
                tabs: [],
                activeTabId: null,
                recentlyClosed: [],
                workspaceKey: key || 'default',
            });
            return;
        }

        res.json({
            tabs: normalizeTabs(workspace.tabs as any[]),
            activeTabId: workspace.activeTabId,
            recentlyClosed: normalizeTabs(workspace.recentlyClosed as any[]),
            workspaceKey: workspace.workspaceKey,
        });
    })
);

router.put(
    '/workspace',
    sessionAuth,
    validate(workspaceUpsertSchema, 'body'),
    asyncHandler(async (req, res) => {
        const body = req.body;
        await assertTeamAccess(body.teamId, req.user!.id);
        await assertProjectAccess(body.projectId, body.teamId);

        const tabs = normalizeTabs(body.tabs);
        const recentlyClosed = normalizeTabs(body.recentlyClosed || []);

        const payload = {
            userId: req.user!.id,
            teamId: body.teamId,
            projectId: body.projectId,
            workspaceKey: body.workspaceKey || 'default',
            tabs,
            activeTabId: body.activeTabId,
            recentlyClosed,
            updatedAt: new Date(),
        };

        await db
            .insert(uiWorkspaces)
            .values(payload)
            .onConflictDoUpdate({
                target: [uiWorkspaces.userId, uiWorkspaces.teamId, uiWorkspaces.projectId, uiWorkspaces.workspaceKey],
                set: payload,
            });

        res.json({ ok: true, workspace: payload });
    })
);

router.post(
    '/workspace/reopen',
    sessionAuth,
    validate(workspaceReopenSchema, 'body'),
    asyncHandler(async (req, res) => {
        const body = req.body;
        await assertTeamAccess(body.teamId, req.user!.id);
        await assertProjectAccess(body.projectId, body.teamId);

        const [workspace] = await db
            .select()
            .from(uiWorkspaces)
            .where(
                and(
                    eq(uiWorkspaces.userId, req.user!.id),
                    eq(uiWorkspaces.teamId, body.teamId),
                    eq(uiWorkspaces.projectId, body.projectId),
                    eq(uiWorkspaces.workspaceKey, body.workspaceKey || 'default')
                )
            )
            .limit(1);

        const tabs = normalizeTabs(workspace?.tabs as any[]) || [];
        const recentlyClosed = normalizeTabs(workspace?.recentlyClosed as any[]) || [];

        const tabToRestore =
            body.tab && tabStateSchema.safeParse(body.tab).success
                ? body.tab
                : recentlyClosed.length > 0
                    ? { ...recentlyClosed[recentlyClosed.length - 1], id: uuidv4() }
                    : null;

        if (!tabToRestore) {
            res.json({ ok: false, reason: 'no_tab_available' });
            return;
        }

        const newTabs = [...tabs, tabToRestore];
        const newRecentlyClosed = recentlyClosed.filter((t) => t.id !== tabToRestore.id);

        await db
            .insert(uiWorkspaces)
            .values({
                userId: req.user!.id,
                teamId: body.teamId,
                projectId: body.projectId,
                workspaceKey: body.workspaceKey || 'default',
                tabs: newTabs,
                activeTabId: tabToRestore.id,
                recentlyClosed: newRecentlyClosed,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [uiWorkspaces.userId, uiWorkspaces.teamId, uiWorkspaces.projectId, uiWorkspaces.workspaceKey],
                set: {
                    tabs: newTabs,
                    activeTabId: tabToRestore.id,
                    recentlyClosed: newRecentlyClosed,
                    updatedAt: new Date(),
                },
            });

        res.json({ ok: true, tab: tabToRestore });
    })
);

router.delete(
    '/workspace/tab/:id',
    sessionAuth,
    validate(workspaceQuerySchema, 'query'),
    validate(tabStateSchema.pick({ id: true }), 'params'),
    asyncHandler(async (req, res) => {
        const { key = 'default', teamId, projectId } = req.query as any;
        const { id } = req.params as any;
        await assertTeamAccess(teamId, req.user!.id);
        await assertProjectAccess(projectId, teamId);

        const [workspace] = await db
            .select()
            .from(uiWorkspaces)
            .where(
                and(
                    eq(uiWorkspaces.userId, req.user!.id),
                    eq(uiWorkspaces.teamId, teamId),
                    eq(uiWorkspaces.projectId, projectId),
                    eq(uiWorkspaces.workspaceKey, key || 'default')
                )
            )
            .limit(1);

        if (!workspace) {
            throw ApiError.notFound('Workspace not found');
        }

        const tabs = normalizeTabs(workspace.tabs as any[]);
        const recentlyClosed = normalizeTabs(workspace.recentlyClosed as any[]);
        const remainingTabs = tabs.filter((t) => t.id !== id);
        const closed = tabs.find((t) => t.id === id);
        const newRecentlyClosed = closed ? [...recentlyClosed.slice(-9), closed] : recentlyClosed;
        const newActive = workspace.activeTabId === id && remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : workspace.activeTabId;

        await db
            .insert(uiWorkspaces)
            .values({
                userId: req.user!.id,
                teamId,
                projectId,
                workspaceKey: key || 'default',
                tabs: remainingTabs,
                activeTabId: newActive,
                recentlyClosed: newRecentlyClosed,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [uiWorkspaces.userId, uiWorkspaces.teamId, uiWorkspaces.projectId, uiWorkspaces.workspaceKey],
                set: {
                    tabs: remainingTabs,
                    activeTabId: newActive,
                    recentlyClosed: newRecentlyClosed,
                    updatedAt: new Date(),
                },
            });

        res.json({ ok: true, tabs: remainingTabs, activeTabId: newActive, recentlyClosed: newRecentlyClosed });
    })
);

router.post(
    '/workspace/reorder',
    sessionAuth,
    validate(workspaceReorderSchema, 'body'),
    asyncHandler(async (req, res) => {
        const body = req.body;
        await assertTeamAccess(body.teamId, req.user!.id);
        await assertProjectAccess(body.projectId, body.teamId);

        const [workspace] = await db
            .select()
            .from(uiWorkspaces)
            .where(
                and(
                    eq(uiWorkspaces.userId, req.user!.id),
                    eq(uiWorkspaces.teamId, body.teamId),
                    eq(uiWorkspaces.projectId, body.projectId),
                    eq(uiWorkspaces.workspaceKey, body.workspaceKey || 'default')
                )
            )
            .limit(1);

        if (!workspace) {
            throw ApiError.notFound('Workspace not found');
        }

        const tabMap = new Map(normalizeTabs(workspace.tabs as any[]).map((t) => [t.id, t]));
        const newOrder = body.orderedTabIds
            .map((id: string) => tabMap.get(id))
            .filter(Boolean) as any[];

        await db
            .insert(uiWorkspaces)
            .values({
                userId: req.user!.id,
                teamId: body.teamId,
                projectId: body.projectId,
                workspaceKey: body.workspaceKey || 'default',
                tabs: newOrder,
                activeTabId: workspace.activeTabId,
                recentlyClosed: workspace.recentlyClosed,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [uiWorkspaces.userId, uiWorkspaces.teamId, uiWorkspaces.projectId, uiWorkspaces.workspaceKey],
                set: {
                    tabs: newOrder,
                    updatedAt: new Date(),
                },
            });

        res.json({ ok: true, tabs: newOrder });
    })
);

export default router;
