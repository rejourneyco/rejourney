import { z } from 'zod';
import { outputMetaSchema } from '../output/emit.js';
import { out } from '../output/fields.js';
import { defineTool } from './types.js';

export const listProjectsTool = defineTool({
    name: 'list_projects',
    title: 'List projects',
    description: 'Lists the Rejourney projects this connection may read. Call this first: most other tools need a project id. Free.',
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({
        projects: z.array(
            z.strictObject({
                id: out.id(),
                name: out.text(255),
                platforms: z.array(out.text(50)),
            }),
        ),
        meta: outputMetaSchema,
    }),
    requiredScope: null,
    credits: () => 0,
    argKinds: {},
    maxDbRoundTrips: 2,
    async handler(_args, ctx, deps) {
        const projects = await deps.data.listProjects(ctx);
        return {
            data: { projects: projects.map((project) => ({ id: project.id, name: project.name, platforms: [...project.platforms] })) },
        };
    },
});
