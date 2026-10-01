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
// Match the dashboard's neutral surfaces, square edges and blue primary action.
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
   * Retained for caller compatibility; primary actions share dashboard blue.
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
  /** Inline HTML. Rendered beside a 6px semantic dot, with no container. */
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
  canvas: '#f8fafd',
  surface: '#ffffff',
  border: '#dadce0',
  divider: '#e8eaed',
  text: '#202124',
  body: '#3c4043',
  muted: '#5f6368',
};

/**
 * Semantic colors are limited to small indicators of actual state.
 */
const SEMANTIC: Record<SemanticTone, { strong: string; soft: string }> = {
  info: { strong: '#1a73e8', soft: '#eff6ff' },
  success: { strong: '#059669', soft: '#ecfdf5' },
  warning: { strong: '#9a6700', soft: '#fdf2f8' },
  danger: { strong: '#dc2626', soft: '#fef2f2' },
  neutral: { strong: '#5f6368', soft: '#f8fafd' },
};

/** Quiet context labels; email types share one visual identity. */
const EMAIL_ROUTES: Record<EmailRouteKey, { label: string }> = {
  security: { label: 'Security' },
  invite: { label: 'Invitation' },
  developer: { label: 'Developer setup' },
  billing: { label: 'Billing' },
  leak_scan: { label: 'Issue scan' },
  stability_digest: { label: 'Stability' },
  general: { label: 'Notification' },
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

/** Inline status: 6px semantic dot, then plain neutral text. No container. */
function renderStatusLine(tone: SemanticTone, html: string): string {
  const color = SEMANTIC[tone].strong;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
      <tr>
        <td width="14" style="vertical-align: middle; padding-right: 8px; line-height: 0;">
          <div style="width: 6px; height: 6px; background: ${color}; border-radius: 50%; font-size: 0; line-height: 0;">&nbsp;</div>
        </td>
        <td style="vertical-align: middle; font-size: 13px; line-height: 1.5; color: ${BRAND.body};">${html}</td>
      </tr>
    </table>
  `;
}

/** Compact comparison text, without a badge or container. */
function renderDelta(text: string, tone: SemanticTone): string {
  return `<span style="font-size: 12px; font-weight: 600; color: ${SEMANTIC[tone].strong};">${escapeHtml(text)}</span>`;
}

export interface EmailKpi {
  label: string;
  value: string | number | null | undefined;
  /** The comparison line under the value. Never restate the value here. */
  comparison?: string | null;
  /** Applied to the value only, when the number itself reports a state. */
  tone?: SemanticTone;
}

/** Unboxed summary values; mobile readers see one measure per line. */
function renderKpiStrip(kpis: EmailKpi[]): string {
  const visible = kpis.filter(kpi => kpi.value !== null && kpi.value !== undefined && String(kpi.value).trim());
  if (!visible.length) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-bottom: 1px solid ${BRAND.divider};"><tr>${visible.map(kpi => `
    <td class="rj-kpi-cell" width="${Math.floor(100 / visible.length)}%" style="vertical-align: top; padding: 0 16px 20px 0;">
      <div style="font-size: 26px; line-height: 1.2; font-weight: 600; color: ${BRAND.text};">${escapeHtml(kpi.value)}</div>
      <div style="font-size: 13px; color: ${BRAND.body}; margin-top: 4px;">${escapeHtml(kpi.label)}</div>
      ${kpi.comparison ? `<div style="font-size: 12px; line-height: 1.5; color: ${BRAND.muted}; margin-top: 4px;">${escapeHtml(kpi.comparison)}</div>` : ''}
    </td>`).join('')}</tr></table>`;
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

  const body = visible.map((row, index) => {
    const isLast = index === visible.length - 1;
    const border = isLast ? '' : `border-bottom: 1px solid ${BRAND.divider};`;
    const background = '';
    const valueStyle = row.mono
      ? `font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px;`
      : `font-size: 13px;`;
    if (!row.key) {
      return `
        <tr>
          <td colspan="2" style="${border} ${background} padding: 10px 0; ${valueStyle} line-height: 1.5; color: ${BRAND.text}; font-weight: 500;">${escapeHtml(row.value)}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td width="38%" style="${border} ${background} padding: 10px 0; font-size: 12px; line-height: 1.5; color: ${BRAND.muted}; font-weight: 600; vertical-align: top;">${escapeHtml(row.key)}</td>
        <td style="${border} ${background} padding: 10px 0; ${valueStyle} line-height: 1.5; color: ${BRAND.text}; font-weight: 500; vertical-align: top; word-break: break-word;">${escapeHtml(row.value)}</td>
      </tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      ${body}
    </table>
  `;
}

/** Secondary information uses typography rather than another card. */
function renderQuiet(label: string | null, html: string): string {
  return `${label ? `<div style="font-size: 14px; font-weight: 600; color: ${BRAND.text}; margin-bottom: 8px;">${escapeHtml(label)}</div>` : ''}
    <div style="font-size: 13px; line-height: 1.65; color: ${BRAND.muted}; overflow-wrap: anywhere;">${html}</div>`;
}

/** Keep safety and billing notices readable without broad color fills. */
function renderCallout(_tone: SemanticTone, html: string): string {
  return `<div style="border-top: 1px solid ${BRAND.divider}; padding-top: 16px; font-size: 13px; line-height: 1.65; color: ${BRAND.body};">${html}</div>`;
}

export interface EmailTableColumn {
  label: string;
  align?: 'left' | 'right';
}

export interface EmailTableCell {
  html: string;
  align?: 'left' | 'right';
}

/**
 * Neutral evidence rows with sentence-case headers and aligned counts.
 */
function renderEvidenceTable(columns: EmailTableColumn[], rows: EmailTableCell[][]): string {
  if (rows.length === 0) return '';

  const head = columns.map((column) => `
    <th style="font-size: 12px; font-weight: 500; color: ${BRAND.muted}; padding: 9px 6px; border-bottom: 1px solid ${BRAND.border}; text-align: ${column.align || 'left'};">${escapeHtml(column.label)}</th>
  `).join('');

  const body = rows.map((row, rowIndex) => {
    const isLast = rowIndex === rows.length - 1;
    const border = isLast ? '' : `border-bottom: 1px solid ${BRAND.divider};`;
    const cells = row.map((cell) => {
      const align = cell.align || 'left';
      const numeric = align === 'right'
        ? `color: ${BRAND.text}; font-weight: 600; white-space: nowrap;`
        : `color: ${BRAND.body};`;
      return `<td style="${border} padding: 16px 6px; font-size: 13px; line-height: 1.5; vertical-align: top; text-align: ${align}; ${numeric}">${cell.html}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      <tr>${head}</tr>
      ${body}
    </table>
  `;
}

/** Title line inside a table cell. */
function evidenceTitle(text: string): string {
  return `<div style="font-size: 13.5px; line-height: 1.4; font-weight: 600; color: ${BRAND.text}; word-break: normal;">${escapeHtml(text)}</div>`;
}

/** Supporting line inside a table cell. */
function evidenceSub(text: string, marginTop = 3): string {
  return `<div style="font-size: 12px; line-height: 1.45; color: ${BRAND.muted}; margin-top: ${marginTop}px; word-break: normal;">${escapeHtml(text)}</div>`;
}

/** Severity inside a table cell: dot plus plain text, never a capsule. */
function evidenceStatus(tone: SemanticTone, text: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-top: 6px;">
      <tr>
        <td width="13" style="vertical-align: middle; padding-right: 7px; line-height: 0;">
          <div style="width: 6px; height: 6px; background: ${SEMANTIC[tone].strong}; border-radius: 50%; font-size: 0; line-height: 0;">&nbsp;</div>
        </td>
        <td style="vertical-align: middle; font-size: 12px; line-height: 1.45; color: ${BRAND.muted};">${escapeHtml(text)}</td>
      </tr>
    </table>
  `;
}

// =============================================================================
// Shell
// =============================================================================

/** One restrained shell for every email, with no external image dependencies. */
function generateEmailHtml({
  title,
  subtitle,
  previewText,
  sections,
  trailingSections,
  action,
  secondaryAction,
  footerText,
  projectName,
  projectUrl,
  route = 'general',
  status,
  timestamp,
  timeZone,
}: EmailTemplateProps): string {
  const baseUrl = emailDashboardHomeUrl();
  const safeTitle = escapeHtml(title);
  const safePreviewText = escapeHtml(previewText);
  const safeBaseUrl = escapeHtml(baseUrl);
  const identity = EMAIL_ROUTES[route] || EMAIL_ROUTES.general;

  const kicker = [identity.label, projectName].filter(Boolean).join(' · ');
  const metaLine = subtitle || (timestamp ? formatEmailDate(timestamp, timeZone) : null);

  const bodyFont = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

  const renderSection = (section: EmailSection): string => {
    const inner =
      section.variant === 'quiet' ? renderQuiet(section.label || null, section.content) :
        section.variant === 'callout' ? renderCallout(section.tone || 'info', section.content) :
          `${section.label ? `<div style="font-size: 14px; font-weight: 600; color: ${BRAND.text}; margin-bottom: 12px;">${escapeHtml(section.label)}</div>` : ''}
           <div style="font-size: 14px; line-height: 1.55; color: ${BRAND.body};">${section.content}</div>`;

    return `
      <tr><td style="height: 20px; line-height: 20px; font-size: 0;">&nbsp;</td></tr>
      <tr><td>${inner}</td></tr>
    `;
  };

  const divider = `<tr><td style="padding: 20px 0 0;"><div style="height: 1px; line-height: 1px; font-size: 0; background: ${BRAND.divider};">&nbsp;</div></td></tr>`;

  const renderActions = (): string => {
    if (!action && !secondaryAction) return '';
    const primaryBg = SEMANTIC.info.strong;
    const primaryBorder = primaryBg;
    return `
      <tr><td style="height: 22px; line-height: 22px; font-size: 0;">&nbsp;</td></tr>
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              ${action ? `<td style="padding: 0 10px 0 0;"><a href="${escapeHtml(action.url)}" style="display: inline-block; background: ${primaryBg}; border: 1px solid ${primaryBorder}; color: ${BRAND.surface}; padding: 11px 20px; font-size: 14px; font-weight: 600; line-height: 1.3; text-decoration: none;">${escapeHtml(action.label)}</a></td>` : ''}
              ${secondaryAction ? `<td style="padding: 0;"><a href="${escapeHtml(secondaryAction.url)}" style="display: inline-block; color: ${SEMANTIC.info.strong}; padding: 11px 0; font-size: 14px; font-weight: 600; line-height: 1.3; text-decoration: none;">${escapeHtml(secondaryAction.label)}</a></td>` : ''}
            </tr>
          </table>
        </td>
      </tr>
    `;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeTitle}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .rj-outer { padding-left: 10px !important; padding-right: 10px !important; }
      .rj-container { width: 100% !important; max-width: 100% !important; }
      .rj-pad { padding-left: 18px !important; padding-right: 18px !important; }
      .rj-kpi-cell { padding: 0 8px 16px 0 !important; }
    }
  </style>
</head>
<body style="font-family: ${bodyFont}; background-color: ${BRAND.canvas}; margin: 0; padding: 0; color: ${BRAND.body}; line-height: 1.45; -webkit-font-smoothing: antialiased;">
  <div style="display:none;font-size:1px;color:${BRAND.canvas};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${safePreviewText}
    ${'&nbsp;'.repeat(100)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; background: ${BRAND.canvas};">
    <tr>
      <td align="center" class="rj-outer" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="rj-container" style="border-collapse: separate; border-spacing: 0; width: 600px; max-width: 600px; background: ${BRAND.surface}; border: 1px solid ${BRAND.border}; overflow: hidden;">



          <tr>
            <td class="rj-pad" style="padding: 24px 32px; border-bottom: 1px solid ${BRAND.divider};">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="vertical-align: middle;">
                    <a href="${safeBaseUrl}" style="font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: ${BRAND.text}; text-decoration: none;">Rejourney</a>
                  </td>
                  <td align="right" style="vertical-align: middle; text-align: right; padding-left: 16px;">
                    ${projectUrl
                      ? `<a href="${escapeHtml(projectUrl)}" style="font-size: 12px; font-weight: 400; color: ${BRAND.muted}; text-decoration: none;">${escapeHtml(kicker)}</a>`
                      : `<span style="font-size: 12px; font-weight: 400; color: ${BRAND.muted};">${escapeHtml(kicker)}</span>`}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="rj-pad" style="padding: 28px 32px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">

                <tr>
                  <td>
                    <h1 style="font-size: 24px; line-height: 1.3; font-weight: 600; letter-spacing: -0.4px; color: ${BRAND.text}; margin: 0;">${safeTitle}</h1>
                    ${metaLine ? `<div style="font-size: 14px; line-height: 1.6; color: ${BRAND.muted}; margin-top: 10px;">${escapeHtml(metaLine)}</div>` : ''}
                  </td>
                </tr>

                ${status ? `
                  ${divider}
                  <tr><td style="height: 18px; line-height: 18px; font-size: 0;">&nbsp;</td></tr>
                  <tr><td>${renderStatusLine(status.tone, status.html)}</td></tr>
                ` : ''}

                ${sections.map(renderSection).join('')}
                ${renderActions()}
                ${trailingSections && trailingSections.length > 0
                  ? `${divider}${trailingSections.map(renderSection).join('')}`
                  : ''}

              </table>
            </td>
          </tr>

          <tr>
            <td class="rj-pad" style="padding: 20px 32px; border-top: 1px solid ${BRAND.divider};">
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: ${BRAND.muted};">
                ${escapeHtml(footerText || 'You received this email because you are registered on Rejourney.')}
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.5;">
                <a href="${safeBaseUrl}" style="color: ${SEMANTIC.info.strong}; text-decoration: none; font-weight: 500;">Dashboard</a>
                <span style="color: ${BRAND.border}; padding: 0 6px;">&middot;</span>
                <a href="https://rejourney.co/docs" style="color: ${SEMANTIC.info.strong}; text-decoration: none; font-weight: 500;">Docs</a>
                <span style="color: ${BRAND.border}; padding: 0 6px;">&middot;</span>
                <a href="mailto:contact@rejourney.co" style="color: ${SEMANTIC.info.strong}; text-decoration: none; font-weight: 500;">Support</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// =============================================================================
// Email Functions
// =============================================================================

/** Send an accessible, copyable sign-in code and its safety notice. */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) throw new Error('SMTP is not configured; OTP email was not sent');

  const html = generateEmailHtml({
    title: 'Verify your email',
    previewText: `Your verification code is ${code}`,
    route: 'security',
    subtitle: 'Enter this code to sign in to Rejourney.',
    sections: [
      {
        content: `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: separate; border-spacing: 0; background: ${BRAND.canvas}; border: 1px solid ${BRAND.border}; ">
            <tr>
              <td align="center" style="padding: 20px 16px; text-align: center;">
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; line-height: 1.2; font-weight: 700; letter-spacing: 0.22em; color: ${BRAND.text}; text-indent: 0.22em;">${escapeHtml(code)}</div>
              </td>
            </tr>
          </table>
          <div style="font-size: 14px; line-height: 1.55; color: ${BRAND.body}; margin-top: 14px;">This code expires in 10 minutes.</div>
        `,
      },
      {
        variant: 'callout',
        tone: 'info',
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
    title: `${teamName} has used ${usagePercent}% of its replay limit`,
    previewText: `${remaining.toLocaleString()} ${remaining === 1 ? 'replay' : 'replays'} remaining this month`,
    route: 'billing',
    projectName: teamName,
    status: {
      tone: isCritical ? 'danger' : 'warning',
      html: isCritical
        ? `Capture pauses at 100% &mdash; <strong style="color: ${BRAND.text}; font-weight: 600;">${remaining.toLocaleString()} ${remaining === 1 ? 'replay' : 'replays'} remaining</strong>`
        : `Approaching limit &mdash; <strong style="color: ${BRAND.text}; font-weight: 600;">${remaining.toLocaleString()} ${remaining === 1 ? 'replay' : 'replays'} remaining</strong>`,
    },
    sections: [
      {
        content: renderKpiStrip([
          { label: 'Used', value: currentUsage.toLocaleString(), comparison: `of ${cap.toLocaleString()} replays` },
          { label: 'Remaining', value: remaining.toLocaleString(), tone: isCritical ? 'danger' : undefined, comparison: `${usagePercent}% of the monthly cap used` },
          { label: 'Monthly cap', value: cap.toLocaleString(), comparison: 'this billing period' },
        ]),
      },
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
 * change itself is presented as structured data rather than prose.
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

  // The comparison describes the plan change. An upgrade reads as
  // success; a downgrade is a neutral fact and gets no semantic colour.
  const deltaTone: SemanticTone = changeType === 'upgrade' ? 'success' : 'neutral';
  const deltaArrow = changeType === 'upgrade' ? '↑' : changeType === 'downgrade' ? '↓' : '→';
  const changeLabel = changeType === 'upgrade' ? 'Upgrade confirmed'
    : changeType === 'downgrade' ? 'Downgrade scheduled'
      : 'Subscription confirmed';

  const html = generateEmailHtml({
    title: `${teamName} is now on ${newPlanName}`,
    previewText: `Plan changed from ${oldPlanName} to ${newPlanName}`,
    route: 'billing',
    projectName: teamName,
    timestamp: new Date(),
    status: {
      tone: deltaTone,
      html: `${escapeHtml(changeLabel)} <span style="padding-left: 6px;">${renderDelta(`${deltaArrow} ${oldPlanName} → ${newPlanName}`, deltaTone)}</span>`,
    },
    sections: [
      {
        content: renderDefList([
          { key: 'Previous plan', value: oldPlanName },
          { key: 'New plan', value: newPlanName },
          { key: 'Takes effect', value: isImmediate ? 'Immediately' : (effectiveLabel || 'Scheduled') },
          { key: 'Team', value: teamName },
        ]),
      },
      { content: escapeHtml(statusMessage) },
    ],
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
 * This is the one billing email that genuinely needs a click, so its primary
 * action uses action blue rather than the dark neutral. Copy speaks about the
 * reader's bank rather than naming our payment processor.
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
    subtitle: 'Your bank needs one more verification step',
    previewText: `Your bank needs one more verification step for ${amount}`,
    route: 'billing',
    projectName: params.teamName,
    status: {
      tone: 'warning',
      html: `Awaiting verification &mdash; <strong style="color: ${BRAND.text}; font-weight: 600;">${escapeHtml(amount)} outstanding</strong>`,
    },
    sections: [
      {
        content: renderKpiStrip([
          { label: 'Amount due', value: amount, comparison: `${planLabel} · ${params.teamName}` },
        ]),
      },
      {
        content: 'Your billing change is almost complete. Your bank has asked for one more authentication step before the payment can clear.',
      },
    ],
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
    title: `${inviterName} invited you to join ${teamName}`,
    subtitle: 'You’ll be able to view session replays and analytics for this team.',
    previewText: `${inviterName} invited you to join ${teamName}`,
    route: 'invite',
    sections: [
      {
        content: renderDefList([
          { key: 'Team', value: teamName },
          { key: 'Invited by', value: inviterName },
          { key: 'Your role', value: roleLabel },
          { key: 'Link expires', value: 'In 7 days' },
        ]),
      },
      {
        content: `<span style="font-size: 13px; color: ${BRAND.muted};">If you weren’t expecting this invitation, no action is needed &mdash; the link expires on its own.</span>`,
      },
    ],
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

/** Map a severity string onto the semantic scale. */
function severityTone(severity: string | null | undefined): SemanticTone {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical' || value === 'high') return 'danger';
  if (value === 'medium') return 'warning';
  return 'neutral';
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
  const totalSessions = sortedIssues.reduce((sum, issue) => sum + Math.max(0, Number(issue.affectedSessions || 0)), 0);
  const highSeverityCount = sortedIssues.filter((issue) => ['high', 'critical'].includes(String(issue.severity || '').toLowerCase())).length;
  const leakLabel = formatCountWithLabel(sortedIssues.length, 'leak', 'leaks');
  const subject = truncateForSubject(`${data.projectName}: ${leakLabel} affecting ~${totalUsers.toLocaleString()} ${totalUsers === 1 ? 'user' : 'users'}`);
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);

  // Ranked by estimated impact — which the ordering and the user column already
  // say, so the rows carry no numbered markers.
  const buildIssueTable = (): string => {
    const rows = sortedIssues.map((issue, index) => {
      const affectedUsers = Math.max(0, Number(issue.estimatedAffectedUsers || 0));
      const affectedSessions = Math.max(0, Number(issue.affectedSessions || 0));
      const meta = [
        issue.shortId || `#${index + 1}`,
        formatIssueType(issue.issueType),
      ].filter((item): item is string => Boolean(item)).join(' · ');
      const severityLine = [
        issue.severity ? `${formatIssueType(issue.severity)} severity` : null,
        issue.contextStatus ? `context ${formatIssueType(issue.contextStatus).toLowerCase()}` : null,
      ].filter(Boolean).join(' · ');

      return [
        {
          html: `
            ${evidenceTitle(issue.title)}
            ${evidenceSub(meta)}
            ${issue.whyItMatters ? `<div style="font-size: 12px; line-height: 1.45; color: ${BRAND.muted}; margin-top: 5px;"><span style="font-weight: 600;">Why it matters:</span> ${escapeHtml(issue.whyItMatters)}</div>` : ''}
            ${severityLine ? evidenceStatus(severityTone(issue.severity), severityLine) : ''}
          `,
        },
        { html: affectedUsers.toLocaleString(), align: 'right' as const },
        { html: affectedSessions > 0 ? affectedSessions.toLocaleString() : '—', align: 'right' as const },
      ];
    });

    return renderEvidenceTable(
      [{ label: 'Leak' }, { label: 'Users', align: 'right' }, { label: 'Sessions', align: 'right' }],
      rows
    );
  };

  const sections: EmailSection[] = [
    {
      content: renderKpiStrip([
        {
          label: 'Leaks',
          value: sortedIssues.length.toLocaleString(),
          comparison: highSeverityCount > 0 ? `${highSeverityCount.toLocaleString()} high severity` : 'none high severity',
        },
        { label: 'Est. users', value: totalUsers.toLocaleString(), comparison: 'across all platforms' },
        {
          label: 'Sessions',
          value: totalSessions > 0 ? totalSessions.toLocaleString() : null,
          comparison: data.admittedSessions !== null && data.admittedSessions !== undefined
            ? `${data.admittedSessions.toLocaleString()} admitted to analysis`
            : null,
        },
      ]),
    },
    {
      content: 'Review the issues below and their replay evidence in the dashboard.',
    },
    {
      label: 'Issues to review',
      content: buildIssueTable(),
    },
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
        title: `${leakLabel.charAt(0).toUpperCase()}${leakLabel.slice(1)} found in ${data.projectName}`,
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

  // Growth becomes a delta column so three issues can be ranked at a glance,
  // instead of hiding the percentage in a caption above each title.
  const trendRows = data.trends.map((trend, index) => {
    const primary = stabilityTrendPrimaryMetric(trend);
    const growth = trend.baselineValue > 0
      ? `↑ ${Math.round(trend.growthPercent).toLocaleString()}%`
      : 'New';
    const detail = [
      trend.appVersion ? `v${trend.appVersion}` : trend.shortId || `#${index + 1}`,
      `${primary.value} ${primary.label}`,
    ].filter(Boolean).join(' · ');
    const users = Math.max(0, trend.affectedUsers || 0);
    const trendUrl = emailDashboardAppPath(trend.dashboardPath);

    return [
      {
        html: `
          <a href="${escapeHtml(trendUrl)}" style="font-size: 13.5px; line-height: 1.4; font-weight: 600; color: ${BRAND.text}; text-decoration: none; word-break: break-word;">${escapeHtml(trend.title)}</a>
          ${evidenceSub(`${stabilityTrendKindLabel(trend)}${trend.subtitle ? ` · ${trend.subtitle}` : ''}`)}
          ${evidenceSub(detail, 5)}
        `,
      },
      { html: renderDelta(growth, 'danger'), align: 'right' as const },
      { html: users > 0 ? users.toLocaleString() : '—', align: 'right' as const },
    ];
  });

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
        title: `${formatCountWithLabel(data.trends.length, 'issue is', 'issues are')} rising fast in ${data.projectName}`,
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
          {
            label: 'Rising above baseline',
            content: renderEvidenceTable(
              [{ label: 'Issue' }, { label: 'Trend', align: 'right' }, { label: 'Users', align: 'right' }],
              trendRows
            ),
          },
        ],
        action: { label: 'Open Stability dashboard', url: dashboardUrl },
        trailingSections: [
          {
            variant: 'quiet',
            label: 'Why you got this',
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
