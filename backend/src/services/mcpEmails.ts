/**
 * MCP emails: a new app connected to your account, and allowance warnings.
 * Sent from the API (which has SMTP), never from the MCP server.
 */

import { config } from '../config.js';
import { logger } from '../logger.js';
import { emailDashboardAppPath, escapeHtml, generateEmailHtml, getTransporter } from './email.js';

export async function sendMcpConnectionEmail(params: {
    to: string;
    clientName: string;
    teamName: string;
    projectNames: string[];
    connectedAt: Date;
}): Promise<void> {
    const transport = getTransporter();
    if (!transport) return;
    const manageUrl = emailDashboardAppPath('/mcp');
    const projects = params.projectNames.length > 0 ? params.projectNames.join(', ') : 'no projects';
    const when = params.connectedAt.toISOString().replace('T', ' ').slice(0, 16);

    const html = generateEmailHtml({
        title: `${params.clientName} can now read ${params.teamName} on Rejourney`,
        previewText: `${params.clientName} was connected to your Rejourney account`,
        projectName: params.teamName,
        sections: [
            {
                content: `You connected <strong>${escapeHtml(params.clientName)}</strong> to Rejourney on ${escapeHtml(when)} UTC. It can read sessions, timelines, crashes, ANRs and errors in: ${escapeHtml(projects)}. It cannot change anything.`,
            },
            {
                variant: 'quiet',
                content: 'If this was not you, revoke the connection now and tell your team admin.',
            },
        ],
        action: { label: 'Review connections', url: manageUrl },
        footerText: 'Sent because an app was connected to your Rejourney account.',
    } as Parameters<typeof generateEmailHtml>[0]);

    await transport.sendMail({
        from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
        to: params.to,
        subject: `${params.clientName} was connected to your Rejourney account`,
        text: `You connected ${params.clientName} to Rejourney on ${when} UTC. It can read sessions, timelines, crashes, ANRs and errors in: ${projects}. It cannot change anything. If this was not you, revoke it at ${manageUrl}`,
        html,
    });
    logger.info({ teamName: params.teamName }, 'MCP connection email sent');
}

export async function sendMcpUsageWarningEmail(params: {
    to: string[];
    teamName: string;
    percent: 80 | 100;
    used: number;
    limit: number;
    resetsAt: Date;
}): Promise<void> {
    const transport = getTransporter();
    if (!transport || params.to.length === 0) return;
    const billingUrl = emailDashboardAppPath('/billing');
    const resets = params.resetsAt.toISOString().slice(0, 10);
    const reached = params.percent >= 100;
    const headline = reached ? 'MCP credits used up for this period' : 'You have used 80% of your MCP credits';
    const body = reached
        ? `${params.teamName} has used all ${params.limit.toLocaleString('en-US')} MCP credits for this billing period. Tools that cost credits are refused until ${resets}; Claude Code can still list projects and check usage.`
        : `${params.teamName} has used ${params.used.toLocaleString('en-US')} of ${params.limit.toLocaleString('en-US')} MCP credits for this billing period. The allowance resets on ${resets}.`;

    const html = generateEmailHtml({
        title: headline,
        previewText: body,
        projectName: params.teamName,
        sections: [{ content: escapeHtml(body) }],
        action: { label: 'View plans', url: billingUrl },
        footerText: `Sent to admins of ${params.teamName}.`,
    } as Parameters<typeof generateEmailHtml>[0]);

    await transport.sendMail({
        from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
        to: params.to.join(','),
        subject: reached ? `${params.teamName} has used all its MCP credits` : `${params.teamName} has used 80% of its MCP credits`,
        text: `${body} Plans: ${billingUrl}`,
        html,
    });
    logger.info({ teamName: params.teamName, percent: params.percent }, 'MCP usage email sent');
}
