/**
 * Email Service
 * 
 * Sends OTP and notification emails
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config, isDevelopment, isTest } from '../config.js';
import { logger } from '../logger.js';
import type { StabilityTrend } from './stabilityTrends.js';

let transporter: Transporter | null = null;

export function getTransporter(): Transporter | null {
  if (!transporter) {
    if (!config.SMTP_HOST) {
      // Use stream transport for development/local testing
      if (isDevelopment) {
        logger.warn('SMTP not configured, using console output in development');
        transporter = nodemailer.createTransport({
          streamTransport: true,
          newline: 'unix',
        });
      } else {
        // In production without SMTP, log warning but don't fail
        // This allows local docker dev (which runs as production) to work
        logger.warn('SMTP not configured - email alerts will be skipped');
        return null;
      }
    } else {
      transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT || 587,
        secure: config.SMTP_SECURE || false,
        auth: config.SMTP_USER
          ? {
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          }
          : undefined,
      });
    }
  }

  return transporter;
}

// =============================================================================
// Email Templates
//
// Use the product's neutral typography in a simple letter-like reading column.
// Keep essential information in one reading column without decorative cards.
// Inline styles and presentation tables work without remote images or web fonts.
// =============================================================================

type SemanticTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

type EmailRouteKey =
  | 'security'
  | 'invite'
  | 'developer'
  | 'billing'
  | 'leak_scan'
  | 'stability_digest'
  | 'general';

interface EmailAction {
  label: string;
  url: string;
  /**
   * Retained for caller compatibility; primary actions use one consistent style.
   */
  emphasis?: 'neutral' | 'accent';
}

interface EmailSection {
  /** A sentence-case heading above the block. */
  label?: string;
  content: string; // HTML content
  /** Secondary notes and separated notices use neutral typography. */
  variant?: 'body' | 'quiet' | 'callout';
  tone?: SemanticTone;
}

interface EmailStatus {
  tone: SemanticTone;
  /** Inline HTML with no badge or status decoration. */
  html: string;
}

interface EmailTemplateProps {
  title: string;
  /** Replaces the timestamp line under the headline when supplied. */
  subtitle?: string | null;
  previewText: string;
  sections: EmailSection[];
  /** Rendered after the action row — for policy notes and reassurances. */
  trailingSections?: EmailSection[];
  action?: EmailAction;
  secondaryAction?: EmailAction;
  footerText?: string;
  projectName?: string;
  projectUrl?: string;
  route?: EmailRouteKey;
  status?: EmailStatus;
  timestamp?: Date;
  timeZone?: string | null;
}

export interface AlertEmailRecipient {
  email: string;
  name?: string | null;
  timeZone?: string | null;
}

type AlertEmailRecipientInput = string | AlertEmailRecipient;

/** Neutral foundation. These four carry almost every pixel in every email. */
const BRAND = {
  accent: '#1a73e8',
  canvas: '#f8fafd',
  surface: '#ffffff',
  border: '#dadce0',
  divider: '#e8eaed',
  text: '#202124',
  body: '#3c4043',
  muted: '#5f6368',
};

/** Production dashboard SPA base — not read from PUBLIC_DASHBOARD_URL (that env is for API/CORS only). */
const PRODUCTION_DASHBOARD_BASE = 'https://rejourney.co/dashboard';
const DEV_APP_ORIGIN = 'http://localhost:8080';

function emailUseLocalOrigins(): boolean {
  return isDevelopment || isTest;
}

function emailDashboardHomeUrl(): string {
  if (emailUseLocalOrigins()) {
    return `${DEV_APP_ORIGIN}/dashboard`;
  }
  return PRODUCTION_DASHBOARD_BASE;
}

/** Routes under the dashboard app, e.g. /billing, /general/:id */
export function emailDashboardAppPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (emailUseLocalOrigins()) {
    return `${DEV_APP_ORIGIN}/dashboard${p}`;
  }
  return `${PRODUCTION_DASHBOARD_BASE}${p}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveEmailTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

function normalizeAlertRecipients(recipients: AlertEmailRecipientInput[]): AlertEmailRecipient[] {
  return recipients
    .map((recipient) => typeof recipient === 'string' ? { email: recipient } : recipient)
    .filter((recipient) => recipient.email.trim().length > 0)
    .map((recipient) => ({
      ...recipient,
      email: recipient.email.trim(),
      timeZone: resolveEmailTimeZone(recipient.timeZone),
    }));
}

function groupAlertRecipientsByTimeZone(recipients: AlertEmailRecipientInput[]): Array<{ timeZone: string; recipients: AlertEmailRecipient[] }> {
  const groups = new Map<string, AlertEmailRecipient[]>();
  for (const recipient of normalizeAlertRecipients(recipients)) {
    const timeZone = resolveEmailTimeZone(recipient.timeZone);
    const group = groups.get(timeZone) || [];
    group.push(recipient);
    groups.set(timeZone, group);
  }
  return Array.from(groups.entries()).map(([timeZone, groupedRecipients]) => ({
    timeZone,
    recipients: groupedRecipients,
  }));
}

function formatCountWithLabel(value: number | undefined | null, singular: string, plural: string): string {
  const count = Math.max(0, Number(value || 0));
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function truncateForSubject(value: string, maxLength = 150): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatCurrencyFromCents(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function emailBillingUrl(query?: string): string {
  const base = emailDashboardAppPath('/billing');
  if (!query) return base;
  const q = query.startsWith('?') ? query : `?${query}`;
  return `${base}${q}`;
}

function emailInviteAcceptUrl(token: string): string {
  if (emailUseLocalOrigins()) {
    return `${DEV_APP_ORIGIN}/invite/accept/${token}`;
  }
  return `https://rejourney.co/invite/accept/${token}`;
}

/**
 * Format a date for email display
 */
function formatEmailDate(date: Date, timeZone?: string | null): string {
  const resolvedTimeZone = resolveEmailTimeZone(timeZone);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: resolvedTimeZone,
    timeZoneName: 'short',
  });
}

/** Acronyms that must not be title-cased into "Ux" or "Api". */
const LABEL_ACRONYMS = new Set(['ux', 'ui', 'api', 'anr', 'sdk', 'ios', 'cpu', 'url', 'id']);

function formatIssueType(value: string | null | undefined): string {
  if (!value) return 'Leak';
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => LABEL_ACRONYMS.has(part.toLowerCase())
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// =============================================================================
// Shared components
//
// Shared typography and spacing keep transactional and alert emails consistent.
// =============================================================================

export interface EmailKpi {
  label: string;
  value: string | number | null | undefined;
  /** The comparison line under the value. Never restate the value here. */
  comparison?: string | null;
  /** Applied to the value only, when the number itself reports a state. */
  tone?: SemanticTone;
}

/** A short factual summary rather than a miniature dashboard. */
function renderKpiStrip(kpis: EmailKpi[]): string {
  const visible = kpis.filter(kpi => kpi.value !== null && kpi.value !== undefined && String(kpi.value).trim());
  return `<div style="font-size: 15px; line-height: 1.8; color: ${BRAND.body};">${visible.map(kpi =>
    `<div><strong style="color: ${BRAND.text};">${escapeHtml(kpi.value)}</strong> ${escapeHtml(kpi.label.toLowerCase())}${kpi.comparison ? ` <span style="color: ${BRAND.muted};">— ${escapeHtml(kpi.comparison)}</span>` : ''}</div>`
  ).join('')}</div>`;
}

export interface EmailDefRow {
  key?: string;
  value: string;
  /** Identifiers, keys, and paths get columnar mono treatment. */
  mono?: boolean;
}

/** A keyed detail table. Replaces prose that buries the values a reader copies. */
function renderDefList(rows: EmailDefRow[]): string {
  const visible = rows.filter((row) => row.value && String(row.value).trim().length > 0);
  if (visible.length === 0) return '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">${visible.map(row => `
    <tr>${row.key ? `<td width="32%" style="padding: 5px 16px 5px 0; font-size: 14px; line-height: 1.6; color: ${BRAND.muted}; vertical-align: top;">${escapeHtml(row.key)}</td>` : ''}
    <td style="padding: 5px 0; font-size: 14px; line-height: 1.6; color: ${BRAND.text}; vertical-align: top; word-break: break-word; ${row.mono ? 'font-family: monospace;' : ''}">${escapeHtml(row.value)}</td></tr>`).join('')}</table>`;
}

export interface EmailTableColumn {
  label: string;
  align?: 'left' | 'right';
}

export interface EmailTableCell {
  html: string;
  align?: 'left' | 'right';
}

// =============================================================================
// Shell
// =============================================================================

/** A single reading column, without dashboard chrome or external assets. */
function generateEmailHtml({
  title, subtitle, previewText, sections, trailingSections, action,
  secondaryAction, footerText, projectName, projectUrl, status, timestamp, timeZone,
}: EmailTemplateProps): string {
  const homeUrl = escapeHtml(emailDashboardHomeUrl());
  const renderSection = (section: EmailSection): string => `<tr><td style="padding-top: 24px;">
    ${section.label ? `<h2 style="margin: 0 0 10px; font-size: 16px; line-height: 1.5; font-weight: 700; color: ${BRAND.text};">${escapeHtml(section.label)}</h2>` : ''}
    <div style="font-size: ${section.variant === 'quiet' ? '13' : '15'}px; line-height: 1.7; color: ${section.variant === 'quiet' ? BRAND.muted : BRAND.body}; overflow-wrap: anywhere;">${section.content}</div>
  </td></tr>`;
  const metaLine = subtitle || (timestamp ? formatEmailDate(timestamp, timeZone) : null);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title>
<style>@media only screen and (max-width: 580px) { .rj-container { width: 100% !important; } .rj-outer { padding: 32px 24px !important; } .rj-heading { font-size: 28px !important; } }</style></head>
<body style="margin: 0; padding: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; color: ${BRAND.body}; -webkit-font-smoothing: antialiased;">
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(previewText)}${'&nbsp;'.repeat(100)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; background: #ffffff;"><tr><td align="center" class="rj-outer" style="padding: 48px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="520" class="rj-container" style="width: 520px; max-width: 520px; border-collapse: collapse; text-align: left; font-family: Arial, Helvetica, sans-serif;">
<tr><td><a href="${homeUrl}" style="font-size: 20px; line-height: 1.3; font-weight: 700; letter-spacing: -0.7px; text-decoration: none; color: ${BRAND.accent};">Rejourney</a></td></tr>
<tr><td style="padding-top: 48px;">
${projectName ? `<div style="font-size: 13px; line-height: 1.5; color: ${BRAND.muted}; margin-bottom: 12px;">${projectUrl ? `<a href="${escapeHtml(projectUrl)}" style="color: ${BRAND.muted}; text-decoration: none;">${escapeHtml(projectName)}</a>` : escapeHtml(projectName)}</div>` : ''}
<h1 class="rj-heading" style="margin: 0; font-size: 32px; line-height: 1.2; font-weight: 700; letter-spacing: -0.8px; color: ${BRAND.text};">${escapeHtml(title)}</h1>
${metaLine ? `<p style="margin: 16px 0 0; font-size: 15px; line-height: 1.7; color: ${BRAND.body};">${escapeHtml(metaLine)}</p>` : ''}</td></tr>
${status ? `<tr><td style="padding-top: 24px; font-size: 15px; line-height: 1.7;">${status.html}</td></tr>` : ''}
${sections.map(renderSection).join('')}
${action ? `<tr><td style="padding-top: 32px;"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse;"><tr><td bgcolor="${BRAND.accent}" style="background: ${BRAND.accent};"><a href="${escapeHtml(action.url)}" style="display: inline-block; border: 1px solid ${BRAND.accent}; padding: 13px 22px; font-size: 14px; line-height: 20px; font-weight: 700; color: #ffffff; text-decoration: none;">${escapeHtml(action.label)}</a></td></tr></table></td></tr>` : ''}
${secondaryAction ? `<tr><td style="padding-top: ${action ? '16' : '28'}px;"><a href="${escapeHtml(secondaryAction.url)}" style="font-size: 14px; line-height: 1.6; color: ${BRAND.accent}; text-decoration: underline;">${escapeHtml(secondaryAction.label)}</a></td></tr>` : ''}
${(trailingSections || []).map(renderSection).join('')}
<tr><td style="padding-top: 48px;"><div style="border-top: 1px solid ${BRAND.divider}; padding-top: 20px; font-size: 12px; line-height: 1.7; color: ${BRAND.muted};">${escapeHtml(footerText || 'You received this email because you are registered on Rejourney.')}<br><a href="mailto:contact@rejourney.co" style="color: ${BRAND.accent}; text-decoration: underline;">Contact support</a></div></td></tr>
</table></td></tr></table></body></html>`;
}

// =============================================================================
// Email Functions
// =============================================================================

/** Send an accessible, copyable sign-in code and its safety notice. */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) throw new Error('SMTP is not configured; OTP email was not sent');

  const html = generateEmailHtml({
    title: 'Your sign-in code',
    previewText: `Your verification code is ${code}`,
    route: 'security',
    subtitle: 'Enter this code to sign in to Rejourney.',
    sections: [
      {
        content: `
          <div style="font-family: monospace; font-size: 44px; line-height: 1.2; font-weight: 700; letter-spacing: 0.12em; color: ${BRAND.accent}; padding: 8px 0;">${escapeHtml(code)}</div>
          <div style="font-size: 14px; line-height: 1.55; color: ${BRAND.body}; margin-top: 14px;">This code expires in 10 minutes.</div>
        `,
      },
      {
        variant: 'quiet',
        content: `<strong style="color: ${BRAND.text}; font-weight: 600;">Never share this code.</strong> Rejourney support will never ask you for it. If you didn't request it, you can safely ignore this message.`,
      },
    ],
    footerText: 'Sent because someone requested a sign-in code for this address.',
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: email,
    subject: `Your verification code: ${code}`,
    text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Never share it — Rejourney support will never ask you for it.`,
    html,
  });

  logger.info({ email }, 'OTP email sent');
}

/**
 * Send billing usage warning email.
 *
 * Usage and consequences are stated explicitly in the content.
 */
export async function sendBillingWarningEmail(
  email: string | string[],
  teamName: string,
  usagePercent: number,
  currentUsage: number,
  cap: number
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const billingUrl = emailBillingUrl('action=setup');
  const remaining = Math.max(0, cap - currentUsage);
  const isCritical = usagePercent >= 95;

  const nextBlock = isCritical
    ? {
      variant: 'callout' as const,
      tone: 'danger' as const,
      content: `<strong style="color: ${BRAND.text}; font-weight: 600;">Replay capture will pause soon.</strong> Analytics sessions keep recording and existing replays stay available. Upgrading resumes capture immediately.`,
    }
    : {
      variant: 'quiet' as const,
      label: 'What happens at 100%',
      content: 'Session replay capture pauses. Analytics sessions keep recording, and any replays already captured stay available. Upgrading resumes capture immediately.',
    };

  const html = generateEmailHtml({
    title: isCritical ? 'Your replay limit is almost reached' : 'You’re approaching your replay limit',
    previewText: `${remaining.toLocaleString()} ${remaining === 1 ? 'replay' : 'replays'} remaining this month`,
    route: 'billing',
    projectName: teamName,
    sections: [
      { content: `<strong style="color: ${BRAND.text};">${remaining.toLocaleString()} ${remaining === 1 ? 'replay' : 'replays'} remaining</strong> this month. You’ve recorded ${currentUsage.toLocaleString()} of ${cap.toLocaleString()} replays.` },
      nextBlock,
    ],
    action: { label: 'Upgrade plan', url: billingUrl },
    secondaryAction: { label: 'View usage', url: emailBillingUrl() },
    footerText: `Sent to admins of ${teamName}.`,
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `${teamName} has used ${usagePercent}% of its replay limit`,
    text: `${teamName} has used ${usagePercent}% of its monthly session replay limit (${currentUsage.toLocaleString()} of ${cap.toLocaleString()}). ${remaining.toLocaleString()} remaining. Replay capture pauses at 100%; analytics sessions keep recording. Upgrade: ${billingUrl}`,
    html,
  });

  logger.info({ email: recipients, teamName, usagePercent }, 'Billing warning email sent');
}

/**
 * Send plan change notification email.
 *
 * Nothing is required of the reader, so the action stays secondary and the
 * change itself is explained in one short paragraph.
 */
export async function sendPlanChangeEmail(
  email: string | string[],
  teamName: string,
  changeType: 'upgrade' | 'downgrade' | 'new',
  oldPlanName: string,
  newPlanName: string,
  effectiveDate: Date | null,
  isImmediate: boolean
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const billingUrl = emailBillingUrl();
  const effectiveLabel = effectiveDate
    ? effectiveDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const statusMessage = isImmediate
    ? 'Your plan change is now active.'
    : effectiveLabel
      ? `You keep access to your current plan features until ${effectiveLabel}. Nothing needs to be done between now and then.`
      : 'Your plan change has been scheduled.';

  const html = generateEmailHtml({
    title: isImmediate ? `You’re now on ${newPlanName}` : `Your move to ${newPlanName} is scheduled`,
    previewText: `Plan changed from ${oldPlanName} to ${newPlanName}`,
    route: 'billing',
    projectName: teamName,
    timestamp: new Date(),
    sections: [{ content: `Your plan is changing from <strong>${escapeHtml(oldPlanName)}</strong> to <strong>${escapeHtml(newPlanName)}</strong>. ${escapeHtml(statusMessage)}` }],
    secondaryAction: { label: 'View billing settings', url: billingUrl },
    footerText: `Sent to billing admins of ${teamName}.`,
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `${teamName} is now on ${newPlanName}`,
    text: `Your billing plan for ${teamName} changed from ${oldPlanName} to ${newPlanName}. ${statusMessage} View billing settings: ${billingUrl}`,
    html,
  });

  logger.info({ email: recipients, teamName, changeType, oldPlanName, newPlanName }, 'Plan change email sent');
}

/**
 * Send subscription payment expired email.
 *
 * "You have not been charged" is the reader's first question, so it leads as
 * the status line and appears in the subject. Nothing here is styled as an
 * error: the outcome is neutral and recoverable.
 */
export async function sendSubscriptionExpiredEmail(
  email: string | string[],
  teamName: string,
  planName: string
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const billingUrl = emailBillingUrl();

  const html = generateEmailHtml({
    title: `Your ${planName} subscription wasn't activated`,
    previewText: `Payment verification wasn't completed in time. You have not been charged.`,
    route: 'billing',
    projectName: teamName,
    timestamp: new Date(),
    status: {
      tone: 'success',
      html: `<strong style="color: ${BRAND.text}; font-weight: 600;">You have not been charged.</strong> ${escapeHtml(teamName)} is back on the Free plan.`,
    },
    sections: [
      {
        content: `
          <p style="margin: 0 0 14px;">Your subscription attempt needed extra payment verification from your bank, and it wasn't completed in time. The attempt was cancelled and nothing was taken.</p>
          <p style="margin: 0;">To subscribe to <strong style="color: ${BRAND.text}; font-weight: 600;">${escapeHtml(planName)}</strong>, start again from the billing page and complete every verification step your bank asks for.</p>
        `,
      },
      {
        variant: 'quiet',
        label: 'If it keeps happening',
        content: 'Try a different payment method, or ask your bank to pre-authorise the payment before you retry.',
      },
    ],
    action: { label: 'Subscribe again', url: billingUrl },
    footerText: `Sent to billing admins of ${teamName}.`,
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `${teamName} was not moved to ${planName} — no charge was made`,
    text: `Your subscription to ${planName} for ${teamName} was not activated because payment verification was not completed in time. You have not been charged, and the team is back on the Free plan. Subscribe again: ${billingUrl}`,
    html,
  });

  logger.info({ email: recipients, teamName, planName }, 'Subscription expired email sent');
}

export interface PaymentActionRequiredEmailParams {
  teamName: string;
  planName: string;
  amountDueCents: number;
  currency: string;
  invoiceUrl: string;
}

/**
 * Send payment authentication required email.
 *
 * Explain the amount and the bank verification needed to complete payment.
 */
export async function sendPaymentActionRequiredEmail(
  email: string | string[],
  params: PaymentActionRequiredEmailParams
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const amount = formatCurrencyFromCents(params.amountDueCents, params.currency);
  const recipients = Array.isArray(email) ? email.join(',') : email;
  const planLabel = params.planName || 'your selected plan';

  const html = generateEmailHtml({
    title: `Finish your ${planLabel} payment`,
    previewText: `Your bank needs one more verification step for ${amount}`,
    route: 'billing',
    projectName: params.teamName,
    sections: [{ content: `Your bank needs you to verify the <strong>${escapeHtml(amount)}</strong> payment for ${escapeHtml(planLabel)} before your billing change can complete.` }],
    action: { label: 'Complete payment', url: params.invoiceUrl, emphasis: 'accent' },
    secondaryAction: { label: 'Billing settings', url: emailBillingUrl() },
    trailingSections: [
      {
        variant: 'callout',
        tone: 'info',
        content: `<strong style="color: ${BRAND.text}; font-weight: 600;">Already finished it?</strong> Ignore this email. Rejourney updates automatically once the payment clears &mdash; usually within a minute.`,
      },
    ],
    footerText: `Sent to billing admins of ${params.teamName}.`,
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `Finish your ${params.teamName} payment`,
    text: `Your bank needs one more verification step before your ${planLabel} payment for ${params.teamName} can clear. Amount due: ${amount}. Complete payment: ${params.invoiceUrl}`,
    html,
  });

  logger.info({ email: recipients, teamName: params.teamName, amountDueCents: params.amountDueCents, currency: params.currency }, 'Payment action required email sent');
}

export interface DeveloperSetupEmailProject {
  id: string;
  name: string;
  publicKey: string;
  platforms?: string[];
  bundleId?: string | null;
  packageName?: string | null;
  webDomain?: string | null;
  webAllowedDomains?: string[] | null;
}

export interface DeveloperSetupEmailParams {
  email: string;
  project: DeveloperSetupEmailProject;
  teamName?: string | null;
  requesterName?: string | null;
  aiPrompt: string;
}

function formatProjectPlatformsForEmail(project: DeveloperSetupEmailProject): string {
  const platforms = project.platforms ?? [];
  if (platforms.length === 0) return 'No platform selected';
  return platforms.map((platform) => {
    if (platform === 'ios') return 'iOS';
    if (platform === 'android') return 'Android';
    if (platform === 'web') return 'Web';
    if (platform === 'react-native') return 'React Native';
    return platform;
  }).join(' · ');
}

/** The plain-text alternative. Also what a developer pastes to an assistant. */
function buildDeveloperSetupEmailBody(params: DeveloperSetupEmailParams): string {
  const { project, teamName, aiPrompt, requesterName } = params;
  const requester = requesterName?.trim() || 'Your teammate';
  return [
    `${requester} asked you to add Rejourney to ${project.name || 'this app'}.`,
    '',
    'Project details:',
    teamName ? `- Team: ${teamName}` : null,
    project.name ? `- Project: ${project.name}` : null,
    `- Public key: ${project.publicKey}`,
    `- Platforms: ${formatProjectPlatformsForEmail(project)}`,
    project.webAllowedDomains?.length
      ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
      : project.webDomain
        ? `- Web allowed domain: ${project.webDomain}`
        : null,
    project.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
    project.packageName ? `- Android package name: ${project.packageName}` : null,
    '',
    'Setup instructions (written for an AI coding assistant, and usable as a checklist):',
    '',
    aiPrompt,
    '',
    'Before you mark this done:',
    '- Confirm the production domains, bundle ID, and package name in the repo match the details above.',
    '- Add route or screen tracking and the privacy controls from the instructions.',
    '- Run a local or staging session and check it appears in Rejourney.',
    '- Never send personal data in custom events or metadata.',
  ].filter((line): line is string => line !== null).join('\n');
}

/**
 * Send project setup instructions directly to a developer.
 *
 * The recipient may have no dashboard access, so every identifier they need is
 * in the email itself — keyed and monospaced, because those are the values they
 * copy.
 */
export async function sendDeveloperSetupEmail(params: DeveloperSetupEmailParams): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const requester = params.requesterName?.trim() || 'Your teammate';
  const projectName = params.project.name || 'Rejourney project';
  const setupUrl = emailDashboardAppPath('/setup');
  const text = buildDeveloperSetupEmailBody(params);
  const project = params.project;

  const domainRow: EmailDefRow | null = project.webAllowedDomains?.length
    ? { key: 'Web domains', value: project.webAllowedDomains.join(', '), mono: true }
    : project.webDomain
      ? { key: 'Web domain', value: project.webDomain, mono: true }
      : null;

  const detailRows: EmailDefRow[] = ([
    params.teamName ? { key: 'Team', value: params.teamName } : null,
    { key: 'Project', value: projectName },
    { key: 'Public key', value: project.publicKey, mono: true },
    { key: 'Platforms', value: formatProjectPlatformsForEmail(project) },
    domainRow,
    project.bundleId ? { key: 'iOS bundle ID', value: project.bundleId, mono: true } : null,
    project.packageName ? { key: 'Android package', value: project.packageName, mono: true } : null,
  ] as Array<EmailDefRow | null>).filter((row): row is EmailDefRow => row !== null);

  const html = generateEmailHtml({
    title: `${requester} asked you to add Rejourney to ${projectName}`,
    subtitle: 'Everything you need is in this email — no dashboard access required.',
    previewText: `Project keys and setup instructions for ${projectName}`,
    route: 'developer',
    projectName,
    projectUrl: setupUrl,
    sections: [
      { label: 'Project details', content: renderDefList(detailRows) },
      {
        label: 'Setup instructions',
        content: `
          <p style="margin: 0 0 10px; font-size: 14px; line-height: 1.55; color: ${BRAND.body};">Written for an AI coding assistant, but they work as a checklist if you're reviewing the code yourself.</p>
          <pre style="background: ${BRAND.canvas}; border: 1px solid ${BRAND.divider}; padding: 13px 15px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px; line-height: 1.6; color: ${BRAND.text}; white-space: pre-wrap; word-break: break-word; margin: 0; overflow-x: auto;">${escapeHtml(params.aiPrompt)}</pre>
        `,
      },
      {
        label: 'Before you mark this done',
        content: renderDefList([
          { value: 'Confirm the bundle ID, package name, and production domains in the repo match the details above.' },
          { value: 'Add route or screen tracking and the privacy controls from the instructions.' },
          { value: 'Run a local or staging session and check it appears in Rejourney.' },
          { value: 'Never send personal data in custom events or metadata.' },
        ]),
      },
    ],
    action: { label: 'Open setup guide', url: setupUrl },
    footerText: `${requester} sent this from the Rejourney dashboard for ${projectName}.`,
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: params.email,
    subject: `${requester} asked you to add Rejourney to ${projectName}`,
    text,
    html,
  });

  logger.info({ email: params.email, projectId: params.project.id }, 'Developer setup email sent');
}

/**
 * Send team invitation email.
 *
 * Role, team, inviter, and expiry become one scannable table rather than a
 * capsule floating under a sentence.
 */
export async function sendTeamInviteEmail(
  email: string,
  teamName: string,
  inviterName: string,
  role: string,
  token: string
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const inviteUrl = emailInviteAcceptUrl(token);
  const roleLabel = formatIssueType(role);

  const html = generateEmailHtml({
    title: `Join ${teamName}`,
    subtitle: `${inviterName} invited you to join ${teamName} as ${roleLabel}. You’ll have access to the team’s session replays and analytics.`,
    previewText: `${inviterName} invited you to join ${teamName}`,
    route: 'invite',
    sections: [{ content: 'This invitation expires in 7 days.' }],
    trailingSections: [{ variant: 'quiet', content: 'If you weren’t expecting this invitation, you can ignore this email.' }],
    action: { label: 'Accept invitation', url: inviteUrl },
    footerText: `Sent to you because ${inviterName} added this address to ${teamName}.`,
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: email,
    subject: `${inviterName} invited you to ${teamName} on Rejourney`,
    text: `${inviterName} invited you to join ${teamName} on Rejourney as ${roleLabel}. The link expires in 7 days. Accept here: ${inviteUrl}`,
    html,
  });

  logger.info({ email, teamName, role }, 'Team invitation email sent');
}

// =============================================================================
// Alert Email Functions
// =============================================================================

export interface LeakScanEmailIssue {
  id: string;
  shortId?: string | null;
  title: string;
  issueType?: string | null;
  severity?: string | null;
  status?: string | null;
  whyItMatters?: string | null;
  estimatedAffectedUsers: number;
  affectedSessions?: number | null;
  firstSeen?: Date | null;
  lastSeen?: Date | null;
  contextStatus?: string | null;
  topSignals?: string[] | null;
}

export interface LeakScanEmailData {
  projectId: string;
  projectName: string;
  dashboardUrl: string;
  issues: LeakScanEmailIssue[];
  completedAt: Date;
  admittedSessions?: number | null;
}

export interface StabilityDigestEmailData {
  projectId: string;
  projectName: string;
  trends: StabilityTrend[];
  detectedAt: Date;
}

export function stabilityDigestSubject(data: { projectName: string; trendCount: number }): string {
  return truncateForSubject(`${data.projectName}: ${formatCountWithLabel(data.trendCount, 'issue', 'issues')} rising fast`);
}

function stabilityTrendKindLabel(trend: StabilityTrend): string {
  switch (trend.kind) {
    case 'crash':
      return 'Crash';
    case 'anr':
      return 'ANR';
    case 'error':
      return 'Error';
    case 'api_error_rate':
      return 'API errors';
    case 'api_latency':
      return 'API latency';
  }
}

function stabilityTrendPrimaryMetric(trend: StabilityTrend): { value: string; label: string } {
  if (trend.kind === 'api_error_rate') {
    return { value: `${trend.currentValue.toFixed(1)}%`, label: 'error rate' };
  }
  if (trend.kind === 'api_latency') {
    return { value: `${Math.round(trend.currentValue).toLocaleString()} ms`, label: 'latency' };
  }
  return {
    value: Math.max(0, trend.occurrences || trend.currentValue).toLocaleString(),
    label: trend.kind === 'crash' ? 'crashes' : trend.kind === 'anr' ? 'ANRs' : 'errors',
  };
}

export async function sendLeakScanEmail(
  recipients: AlertEmailRecipientInput[],
  data: LeakScanEmailData
): Promise<void> {
  if (recipients.length === 0 || data.issues.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const sortedIssues = data.issues
    .slice()
    .sort((a, b) =>
      (b.estimatedAffectedUsers || 0) - (a.estimatedAffectedUsers || 0) ||
      (b.affectedSessions || 0) - (a.affectedSessions || 0)
    );
  const totalUsers = sortedIssues.reduce((sum, issue) => sum + Math.max(0, Number(issue.estimatedAffectedUsers || 0)), 0);
  const leakLabel = formatCountWithLabel(sortedIssues.length, 'leak', 'leaks');
  const subject = truncateForSubject(`${data.projectName}: ${leakLabel} affecting ~${totalUsers.toLocaleString()} ${totalUsers === 1 ? 'user' : 'users'}`);
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);

  const sections: EmailSection[] = [
    { content: 'Your scan found issues to review. Open the dashboard to check the replay evidence before acting.' },
    { content: sortedIssues.map(issue => {
      const users = Math.max(0, Number(issue.estimatedAffectedUsers || 0));
      const details = [issue.shortId, issue.severity ? `${formatIssueType(issue.severity)} severity` : null,
        `~${users.toLocaleString()} estimated affected ${users === 1 ? 'user' : 'users'}`,
        issue.affectedSessions ? `${issue.affectedSessions.toLocaleString()} sessions` : null].filter(Boolean).join(' · ');
      return `<div style="padding: 20px 0; border-top: 1px solid ${BRAND.divider};">
        <div style="font-size: 16px; line-height: 1.5; font-weight: 700; color: ${BRAND.text};">${escapeHtml(issue.title)}</div>
        ${issue.whyItMatters ? `<div style="font-size: 14px; line-height: 1.7; margin-top: 8px;">${escapeHtml(issue.whyItMatters)}</div>` : ''}
        <div style="font-size: 12px; line-height: 1.7; color: ${BRAND.muted}; margin-top: 8px;">${escapeHtml(details)}</div>
      </div>`;
    }).join('') },
  ];

  for (const group of recipientGroups) {
    const completedAtText = formatEmailDate(data.completedAt, group.timeZone);
    const textLines = [
      `${data.projectName} leak scan summary: ${leakLabel}, ~${totalUsers.toLocaleString()} estimated affected users`,
      '',
      ...sortedIssues.map((issue, index) =>
        `${index + 1}. ${issue.title} — ${Math.max(0, Number(issue.estimatedAffectedUsers || 0)).toLocaleString()} estimated affected users${issue.affectedSessions ? `, ${issue.affectedSessions.toLocaleString()} affected sessions` : ''}${issue.severity ? `, ${issue.severity} severity` : ''}${issue.whyItMatters ? `\n   Why it matters: ${issue.whyItMatters}` : ''}`
      ),
      '',
      `Open dashboard: ${data.dashboardUrl}`,
    ];

    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: textLines.join('\n'),
      html: generateEmailHtml({
        title: `${formatCountWithLabel(sortedIssues.length, 'issue', 'issues')} to review`,
        subtitle: `Scan completed ${completedAtText}`,
        previewText: `Top issue: ${sortedIssues[0]?.title || data.projectName}`,
        sections,
        action: { label: 'Review issues', url: data.dashboardUrl },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        route: 'leak_scan',
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      }),
    });
  }
}

export async function sendStabilityDigestEmail(
  recipients: AlertEmailRecipientInput[],
  data: StabilityDigestEmailData,
): Promise<void> {
  if (recipients.length === 0 || data.trends.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const dashboardUrl = emailDashboardAppPath('/general');
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);
  const subject = stabilityDigestSubject({ projectName: data.projectName, trendCount: data.trends.length });
  const affectedUsers = data.trends.reduce(
    (sum, trend) => sum + Math.max(0, trend.affectedUsers || 0),
    0,
  );
  const versions = Array.from(new Set(data.trends.map((trend) => trend.appVersion).filter(Boolean)));

  const trendEntries = data.trends.map((trend, index) => {
    const primary = stabilityTrendPrimaryMetric(trend);
    const growth = trend.baselineValue > 0 ? `${Math.round(trend.growthPercent).toLocaleString()}% above baseline` : 'New in this window';
    const detail = [trend.appVersion ? `v${trend.appVersion}` : trend.shortId || `#${index + 1}`,
      `${primary.value} ${primary.label}`, growth,
      trend.affectedUsers ? `${trend.affectedUsers.toLocaleString()} affected users` : null].filter(Boolean).join(' · ');
    return `<div style="padding: 20px 0; border-top: 1px solid ${BRAND.divider};">
      <a href="${escapeHtml(emailDashboardAppPath(trend.dashboardPath))}" style="font-size: 16px; line-height: 1.5; font-weight: 700; color: ${BRAND.accent}; text-decoration: none;">${escapeHtml(trend.title)}</a>
      ${trend.subtitle ? `<div style="font-size: 14px; line-height: 1.7; margin-top: 8px;">${escapeHtml(trend.subtitle)}</div>` : ''}
      <div style="font-size: 12px; line-height: 1.7; color: ${BRAND.muted}; margin-top: 8px;">${escapeHtml(detail)}</div>
    </div>`;
  }).join('');

  for (const group of recipientGroups) {
    const textLines = [
      `${data.projectName}: ${formatCountWithLabel(data.trends.length, 'issue', 'issues')} rising fast`,
      '',
      ...data.trends.map((trend, index) => {
        const primary = stabilityTrendPrimaryMetric(trend);
        const rise = trend.baselineValue > 0
          ? `+${Math.round(trend.growthPercent)}% versus the recent baseline`
          : 'new in the recent window';
        return `${index + 1}. ${trend.title} — ${primary.value} ${primary.label}, ${rise}. ${emailDashboardAppPath(trend.dashboardPath)}`;
      }),
      '',
      `View stability dashboard: ${dashboardUrl}`,
    ];

    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: textLines.join('\n'),
      html: generateEmailHtml({
        title: `${formatCountWithLabel(data.trends.length, 'issue is', 'issues are')} rising above baseline`,
        subtitle: formatEmailDate(data.detectedAt, group.timeZone),
        previewText: `Crashes, ANRs and API errors above baseline${affectedUsers > 0 ? ` — ${affectedUsers.toLocaleString()} ${affectedUsers === 1 ? 'user' : 'users'} affected` : ''}`,
        sections: [
          {
            content: renderKpiStrip([
              {
                label: 'Emerging issues',
                value: data.trends.length.toLocaleString(),
                comparison: Array.from(new Set(data.trends.map(stabilityTrendKindLabel))).join(', ').toLowerCase(),
              },
              {
                label: 'Users affected',
                value: affectedUsers > 0 ? affectedUsers.toLocaleString() : null,
                comparison: versions.length === 1 ? `all on v${versions[0]}` : null,
              },
            ]),
          },
          { content: trendEntries },
        ],
        action: { label: 'Open Stability dashboard', url: dashboardUrl },
        trailingSections: [
          {
            variant: 'quiet',
            content: 'This digest sends only when grouped stability signals rise materially above their recent baseline. Individual occurrences never send email, and a project receives at most three stability digests in any rolling seven-day window.',
          },
        ],
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        route: 'stability_digest',
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      }),
    });
  }
}
