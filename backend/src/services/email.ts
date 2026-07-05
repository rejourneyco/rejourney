/**
 * Email Service
 * 
 * Sends OTP and notification emails
 */

import nodemailer from 'nodemailer';
import { config, isDevelopment, isTest } from '../config.js';
import { logger } from '../logger.js';

let transporter: nodemailer.Transporter | null = null;

export function getTransporter(): nodemailer.Transporter | null {
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
// =============================================================================

interface EmailAction {
  label: string;
  url: string;
  secondary?: boolean;
}

interface EmailSection {
  title?: string;
  content: string; // HTML content
  style?: 'default' | 'highlight' | 'warning' | 'error' | 'success' | 'info';
}

interface EmailMetaBadge {
  label: string;
  value: string;
  color?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
}

interface EmailTemplateProps {
  title: string;
  previewText: string;
  sections: EmailSection[];
  action?: EmailAction;
  secondaryAction?: EmailAction;
  footerText?: string;
  projectName?: string;
  projectUrl?: string;
  alertType?: 'crash' | 'anr' | 'error_spike' | 'api_degradation' | 'billing' | 'general' | 'leak_scan';
  metaBadges?: EmailMetaBadge[];
  timestamp?: Date;
  timeZone?: string | null;
}

export interface AlertEmailRecipient {
  email: string;
  name?: string | null;
  timeZone?: string | null;
}

type AlertEmailRecipientInput = string | AlertEmailRecipient;

// Rejourney email design tokens. Kept inline-friendly because most clients strip
// stylesheets and many still render layout most reliably with presentation tables.
const BRAND = {
  text: '#202124',
  textSecondary: '#3c4043',
  muted: '#5f6368',
  subtle: '#6f7785',
  border: '#dadce0',
  borderSoft: '#edf0f3',
  row: '#f8fafd',
  white: '#ffffff',
  accent: '#1a73e8',
  accentDark: '#185abc',
  accentSoft: '#eef4ff',
  success: '#188038',
  successSoft: '#f1f8f4',
  warning: '#b06000',
  warningSoft: '#fff8e1',
  error: '#b3261e',
  errorSoft: '#fce8e6',
  info: '#1a73e8',
  infoSoft: '#eef4ff',
  purple: '#7b1fa2',
  purpleSoft: '#f7f2fa',
  surface: '#ffffff',
  canvas: '#f8fafd',
  code: '#0f172a',
  codeSoft: '#f8fafd',
};

const ALERT_LABELS: Record<string, string> = {
  crash: 'Crash alert',
  anr: 'ANR alert',
  error_spike: 'API error spike',
  api_degradation: 'API degradation',
  billing: 'Billing notice',
  leak_scan: 'Leak scan',
  general: 'Notification',
};

const ALERT_TONES: Record<string, { color: string; soft: string; border: string }> = {
  crash: { color: BRAND.error, soft: BRAND.errorSoft, border: '#fecdd3' },
  anr: { color: BRAND.warning, soft: BRAND.warningSoft, border: '#fed7aa' },
  error_spike: { color: BRAND.warning, soft: BRAND.warningSoft, border: '#fed7aa' },
  api_degradation: { color: BRAND.info, soft: BRAND.infoSoft, border: '#bfdbfe' },
  billing: { color: BRAND.purple, soft: BRAND.purpleSoft, border: '#ddd6fe' },
  leak_scan: { color: BRAND.accentDark, soft: BRAND.accentSoft, border: '#bfdbfe' },
  general: { color: BRAND.text, soft: BRAND.row, border: BRAND.border },
};

const BADGE_COLORS: Record<NonNullable<EmailMetaBadge['color']>, { color: string; soft: string; border: string }> = {
  red: { color: BRAND.error, soft: BRAND.errorSoft, border: '#fecdd3' },
  orange: { color: BRAND.warning, soft: BRAND.warningSoft, border: '#fed7aa' },
  yellow: { color: '#a16207', soft: '#fefce8', border: '#fef08a' },
  green: { color: BRAND.success, soft: BRAND.successSoft, border: '#bbf7d0' },
  blue: { color: BRAND.info, soft: BRAND.infoSoft, border: '#bfdbfe' },
  purple: { color: BRAND.purple, soft: BRAND.purpleSoft, border: '#ddd6fe' },
  gray: { color: BRAND.muted, soft: BRAND.row, border: BRAND.border },
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

function formatCount(value: number | undefined | null): string {
  return Math.max(0, Number(value || 0)).toLocaleString();
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

function renderKeyValueTable(rows: Array<[string, string | number | null | undefined]>): string {
  const visibleRows = rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0);
  if (visibleRows.length === 0) return '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px;">
      ${visibleRows.map(([label, value]) => `
        <tr>
          <td style="border-bottom: 1px solid ${BRAND.borderSoft}; padding: 10px 0; color: ${BRAND.muted}; font-weight: 600; width: 38%; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="border-bottom: 1px solid ${BRAND.borderSoft}; padding: 10px 0 10px 16px; color: ${BRAND.text}; font-weight: 650; text-align: right; word-break: break-word; vertical-align: top;">${escapeHtml(value)}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function renderMetricGrid(metrics: Array<{ label: string; value: string | number | null | undefined; detail?: string | null; tone?: 'default' | 'success' | 'warning' | 'error' | 'info' }>): string {
  const visible = metrics.filter((metric) => metric.value !== null && metric.value !== undefined && String(metric.value).trim().length > 0);
  if (visible.length === 0) return '';

  const toneColor = (tone: NonNullable<typeof visible[number]['tone']> | undefined) => {
    if (tone === 'success') return BRAND.success;
    if (tone === 'warning') return BRAND.warning;
    if (tone === 'error') return BRAND.error;
    if (tone === 'info') return BRAND.info;
    return BRAND.text;
  };

  const rows: string[] = [];
  for (let i = 0; i < visible.length; i += 3) {
    const rowMetrics = visible.slice(i, i + 3);
    rows.push(`
      <tr>
        ${rowMetrics.map((metric) => `
          <td width="${Math.floor(100 / rowMetrics.length)}%" style="border-top: 1px solid ${BRAND.borderSoft}; border-bottom: 1px solid ${BRAND.borderSoft}; ${metric === rowMetrics[rowMetrics.length - 1] ? '' : `border-right: 1px solid ${BRAND.borderSoft};`} padding: 12px 14px; vertical-align: top;">
            <div style="font-size: 20px; line-height: 1.2; font-weight: 750; color: ${toneColor(metric.tone)}; letter-spacing: 0;">${escapeHtml(metric.value)}</div>
            <div style="font-size: 11px; line-height: 1.35; color: ${BRAND.subtle}; font-weight: 700; margin-top: 5px;">${escapeHtml(metric.label)}</div>
            ${metric.detail ? `<div style="font-size: 12px; line-height: 1.45; color: ${BRAND.muted}; margin-top: 6px;">${escapeHtml(metric.detail)}</div>` : ''}
          </td>
        `).join('')}
        ${rowMetrics.length < 3 ? '<td></td>'.repeat(3 - rowMetrics.length) : ''}
      </tr>
    `);
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
      ${rows.join('')}
    </table>
  `;
}

function renderTopCountBadges(
  counts: Record<string, number> | undefined,
  options: { prefix?: string; limit?: number } = {},
): string {
  if (!counts || Object.keys(counts).length === 0) return '';
  const limit = options.limit ?? 5;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => `<span style="display: inline-block; color: ${BRAND.text}; margin: 0 12px 8px 0; font-size: 12px; line-height: 1.4; font-weight: 700;">${escapeHtml(options.prefix || '')}${escapeHtml(label)} <span style="color: ${BRAND.muted}; font-weight: 700;">${formatCount(count)}</span></span>`)
    .join('');
}

function renderPills(values: Array<string | null | undefined>): string {
  const visible = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  if (visible.length === 0) return '';

  return visible
    .slice(0, 8)
    .map((value) => `<span style="display: inline-block; color: ${BRAND.muted}; margin: 0 10px 6px 0; font-size: 12px; line-height: 1.4; font-weight: 700;">${escapeHtml(formatIssueType(value))}</span>`)
    .join('');
}

function renderNumberDelta(current: number, previous: number, unit = ''): string {
  return `${formatCount(previous)}${unit} -> ${formatCount(current)}${unit}`;
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

/**
 * Shared Email Template - clean, dense, and readable in common email clients.
 */
function generateEmailHtml({
  title,
  previewText,
  sections,
  action,
  secondaryAction,
  footerText,
  projectName,
  projectUrl,
  alertType = 'general',
  metaBadges,
  timestamp,
  timeZone,
}: EmailTemplateProps): string {
  const baseUrl = emailDashboardHomeUrl();
  const safeTitle = escapeHtml(title);
  const safePreviewText = escapeHtml(previewText);
  const safeProjectName = projectName ? escapeHtml(projectName) : null;
  const safeProjectUrl = projectUrl ? escapeHtml(projectUrl) : null;
  const safeBaseUrl = escapeHtml(baseUrl);
  const tone = ALERT_TONES[alertType] || ALERT_TONES.general;

  const styles = {
    body: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: ${BRAND.canvas}; margin: 0; padding: 0; color: ${BRAND.text}; line-height: 1.5; -webkit-font-smoothing: antialiased;`,
    outerCell: `padding: 24px 18px 34px;`,
    container: `max-width: 760px; margin: 0 auto; background-color: ${BRAND.surface}; border: 1px solid ${BRAND.border}; width: 100%;`,
    topStrip: `height: 4px; line-height: 4px; background: ${tone.color};`,
    header: `background-color: ${BRAND.white}; padding: 30px 38px 26px; border-bottom: 1px solid ${BRAND.border};`,
    navTable: `width: 100%; border-collapse: collapse; margin-bottom: 26px;`,
    navCell: `vertical-align: middle;`,
    navProjectCell: `vertical-align: middle; text-align: right;`,
    logo: `font-size: 20px; font-weight: 800; color: ${BRAND.text}; text-decoration: none; letter-spacing: 0;`,
    logoMark: `display: inline-block; width: 8px; height: 8px; background: ${BRAND.accent}; margin-right: 8px; vertical-align: 1px;`,
    projectBadge: `color: ${BRAND.muted}; font-size: 12px; font-weight: 700; text-decoration: none; display: inline-block;`,
    content: `padding: 6px 38px 36px;`,
    h1: `font-size: 28px; font-weight: 750; line-height: 1.2; margin: 0 0 12px; letter-spacing: 0; color: ${BRAND.text};`,
    subtitle: `font-size: 13px; font-weight: 600; color: ${BRAND.muted}; margin: 0 0 18px;`,
    alertLabel: `display: inline-block; color: ${tone.color}; font-size: 12px; line-height: 1.2; font-weight: 800; margin-bottom: 14px;`,
    section: `border-bottom: 1px solid ${BRAND.borderSoft}; padding: 24px 0;`,
    sectionTitle: `font-size: 12px; font-weight: 800; color: ${BRAND.subtle}; margin: 0 0 12px; letter-spacing: 0.02em;`,
    text: `font-size: 15px; line-height: 1.65; color: ${BRAND.text}; padding: 0; margin: 0;`,
    highlightBox: `border-top: 1px solid ${BRAND.border}; border-bottom: 1px solid ${BRAND.border}; padding: 14px 0; background: ${BRAND.white}; color: ${BRAND.code}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.55; overflow-x: auto;`,
    toneBox: `border-left: 3px solid ${tone.color}; padding: 0 0 0 16px; background: ${BRAND.white};`,
    buttonTable: `margin-top: 28px; border-collapse: collapse;`,
    button: `background-color: ${BRAND.accent}; color: ${BRAND.white}; display: inline-block; padding: 12px 16px; font-weight: 800; text-decoration: none; border-radius: 6px; font-size: 14px; line-height: 1.25;`,
    buttonSecondary: `background-color: ${BRAND.white}; color: ${BRAND.text}; display: inline-block; padding: 11px 15px; font-weight: 800; text-decoration: none; border: 1px solid ${BRAND.border}; border-radius: 6px; font-size: 14px; line-height: 1.25;`,
    badgesContainer: `margin-top: 20px; padding-top: 16px; border-top: 1px solid ${BRAND.borderSoft};`,
    badge: `display: inline-block; font-size: 12px; line-height: 1.35; font-weight: 750; margin: 0 14px 7px 0;`,
    badgeLabel: `font-weight: 700; opacity: 0.78; margin-right: 4px;`,
    footer: `background-color: ${BRAND.row}; padding: 24px 38px 28px; border-top: 1px solid ${BRAND.border};`,
    footerText: `font-size: 12px; color: ${BRAND.muted}; margin: 0; line-height: 1.65;`,
    footerLink: `color: ${BRAND.accentDark}; text-decoration: none; font-weight: 800;`,
  };

  const renderSection = (section: EmailSection) => {
    const sectionTone =
      section.style === 'error' ? { color: BRAND.error, soft: BRAND.errorSoft, border: '#fecdd3' } :
        section.style === 'warning' ? { color: BRAND.warning, soft: BRAND.warningSoft, border: '#fed7aa' } :
          section.style === 'success' ? { color: BRAND.success, soft: BRAND.successSoft, border: '#bbf7d0' } :
            section.style === 'info' ? { color: BRAND.info, soft: BRAND.infoSoft, border: '#bfdbfe' } :
              null;

    const contentHtml = section.style === 'highlight'
      ? `<div style="${styles.highlightBox}">${section.content}</div>`
      : sectionTone
        ? `<div style="${styles.toneBox} border-left-color: ${sectionTone.color};">${section.content}</div>`
        : `<div style="${styles.text}">${section.content}</div>`;

    return `
      <div style="${styles.section}">
        ${section.title ? `<h2 style="${styles.sectionTitle}">${escapeHtml(section.title)}</h2>` : ''}
        ${contentHtml}
      </div>
    `;
  };

  const renderMetaBadge = (badge: EmailMetaBadge) => {
    const badgeTone = badge.color ? BADGE_COLORS[badge.color] : { color: BRAND.text, soft: '#ffffff', border: BRAND.border };
    return `
      <span style="${styles.badge} color: ${badgeTone.color};">
        <span style="${styles.badgeLabel}">${escapeHtml(badge.label)}:</span>
        <span>${escapeHtml(badge.value)}</span>
      </span>
    `;
  };

  const renderActions = () => {
    if (!action && !secondaryAction) return '';

    return `
      <table role="presentation" cellpadding="0" cellspacing="0" style="${styles.buttonTable}">
        <tr>
          ${action ? `<td style="padding: 0 10px 10px 0;"><a href="${escapeHtml(action.url)}" style="${styles.button}">${escapeHtml(action.label)}</a></td>` : ''}
          ${secondaryAction ? `<td style="padding: 0 0 10px 0;"><a href="${escapeHtml(secondaryAction.url)}" style="${styles.buttonSecondary}">${escapeHtml(secondaryAction.label)}</a></td>` : ''}
        </tr>
      </table>
    `;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    @media only screen and (max-width: 680px) {
      .rj-outer { padding-left: 12px !important; padding-right: 12px !important; }
      .rj-container { width: 100% !important; max-width: 100% !important; }
      .rj-shell-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .rj-leak-index { width: 30px !important; padding-right: 10px !important; }
      .rj-leak-body { margin-left: 0 !important; }
      .rj-leak-impact-cell { display: block !important; width: 100% !important; border-right: 0 !important; padding-right: 0 !important; padding-left: 0 !important; }
    }
  </style>
</head>
<body style="${styles.body}">
  <!-- Preheader -->
  <div style="display:none;font-size:1px;color:${BRAND.canvas};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${safePreviewText}
    ${'&nbsp;'.repeat(100)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" class="rj-outer" style="${styles.outerCell}">
        <div class="rj-container" style="${styles.container}">
          <div style="${styles.topStrip}">&nbsp;</div>
          
          <!-- Header -->
          <div class="rj-shell-pad" style="${styles.header}">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${styles.navTable}">
              <tr>
                <td style="${styles.navCell}">
                  <a href="${safeBaseUrl}" style="${styles.logo}"><span style="${styles.logoMark}"></span>Rejourney</a>
                </td>
                <td align="right" style="${styles.navProjectCell}">
                  ${safeProjectName && safeProjectUrl ? `
                    <a href="${safeProjectUrl}" style="${styles.projectBadge}">${safeProjectName}</a>
                  ` : safeProjectName ? `<span style="${styles.projectBadge}">${safeProjectName}</span>` : ''}
                </td>
              </tr>
            </table>

            ${alertType ? `
              <div style="${styles.alertLabel}">
                ${ALERT_LABELS[alertType] || 'NOTIFICATION'}
              </div>
            ` : ''}
            
            <h1 style="${styles.h1}">${safeTitle}</h1>
            
            ${timestamp ? `
              <div style="${styles.subtitle}">
                ${formatEmailDate(timestamp, timeZone)}
              </div>
            ` : ''}

            ${metaBadges && metaBadges.length > 0 ? `
              <div style="${styles.badgesContainer}">
                ${metaBadges.map(renderMetaBadge).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Content -->
          <div class="rj-shell-pad" style="${styles.content}">
            ${sections.map(renderSection).join('')}
            ${renderActions()}
          </div>

          <!-- Footer -->
          <div class="rj-shell-pad" style="${styles.footer}">
            <p style="${styles.footerText}">
              ${escapeHtml(footerText || 'You received this email because you are registered on Rejourney.')}
            </p>
            <div style="margin-top: 16px; font-size: 12px;">
              <a href="${safeBaseUrl}" style="${styles.footerLink}">Dashboard</a> &bull;
              <a href="https://rejourney.co/docs" style="${styles.footerLink}">Docs</a> &bull;
              <a href="mailto:contact@rejourney.co" style="${styles.footerLink}">Support</a>
            </div>
            <p style="${styles.footerText}; margin-top: 16px; font-weight: 700; color: ${BRAND.text};">
              Rejourney
            </p>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// =============================================================================
// Email Functions
// =============================================================================

/**
 * Send OTP verification email
 */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const html = generateEmailHtml({
    title: 'Verify Email',
    previewText: `Your verification code is ${code}`,
    sections: [
      {
        content: `
          <div style="border-top: 1px solid ${BRAND.borderSoft}; border-bottom: 1px solid ${BRAND.borderSoft}; padding: 26px 0; text-align: center; background: ${BRAND.white};">
            <div style="color: ${BRAND.muted}; margin-bottom: 12px; font-size: 13px; font-weight: 800;">Verification code</div>
            <div style="font-size: 42px; font-weight: 800; letter-spacing: 3px; color: ${BRAND.text}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(code)}</div>
          </div>
        `
      },
      {
        style: 'info',
        content: `
          <strong>Security check:</strong> Never share this code. Rejourney support will never ask for it.
        `
      }
    ],
    footerText: 'If you didn\'t request this code, you can safely ignore this message.',
    timestamp: new Date()
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: email,
    subject: `Your verification code: ${code}`,
    text: `Your verification code is: ${code}`,
    html
  });

  logger.info({ email }, 'OTP email sent');
}

/**
 * Send billing warning email
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

  // Determine urgency
  let urgencyLabel = 'WARNING';

  if (usagePercent >= 95) {
    urgencyLabel = 'CRITICAL';
  }

  const remaining = Math.max(0, cap - currentUsage);

  const metaBadges: EmailMetaBadge[] = [
    { label: 'Usage', value: `${usagePercent}%`, color: usagePercent >= 95 ? 'red' : 'orange' },
    { label: 'Status', value: urgencyLabel, color: usagePercent >= 95 ? 'red' : 'orange' },
    { label: 'Remaining', value: `${remaining.toLocaleString()} replays`, color: 'gray' },
  ];

  const html = generateEmailHtml({
    title: 'Usage Limit Warning',
    previewText: `${teamName} has used ${usagePercent}% of monthly session replay usage`,
    sections: [
      {
        style: 'warning',
        content: `
          <div style="font-size: 16px; line-height: 1.65; color: ${BRAND.text};">
            <strong>${escapeHtml(teamName)}</strong> has used <strong>${usagePercent}%</strong> of its monthly session replay limit.
          </div>
          <div style="margin-top: 16px;">
            ${renderMetricGrid([
              { label: 'Used replays', value: currentUsage.toLocaleString(), tone: usagePercent >= 95 ? 'error' : 'warning' },
              { label: 'Monthly cap', value: cap.toLocaleString() },
              { label: 'Remaining', value: remaining.toLocaleString(), tone: remaining === 0 ? 'error' : 'info' },
            ])}
          </div>
        `
      },
      {
        title: 'What Happens Next?',
        content: `
          Session replay capture will pause when you hit 100%.
          Analytics sessions will continue, and you can upgrade to record more replays.
        `
      }
    ],
    action: {
      label: 'Add Payment Method',
      url: billingUrl
    },
    alertType: 'billing',
    metaBadges,
    footerText: `Sent to admins of ${teamName}.`
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `Billing Alert: ${teamName} at ${usagePercent}% replay usage`,
    text: `Team ${teamName} has used ${usagePercent}% of monthly session replay usage. Add payment method: ${billingUrl}`,
    html
  });

  logger.info({ email: recipients, teamName, usagePercent }, 'Billing warning email sent');
}

/**
 * Send plan change notification email
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

  const changeTypeLabel = changeType === 'upgrade' ? 'Upgrade' : changeType === 'downgrade' ? 'Downgrade' : 'Subscription';
  const statusMessage = isImmediate
    ? 'Your plan change is now active.'
    : effectiveDate
      ? `Your plan change will take effect on ${effectiveDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. You'll continue to have access to your current plan features until then.`
      : 'Your plan change has been scheduled.';

  const sections: EmailSection[] = [
    {
      style: 'default',
      content: `
        <p style="margin-bottom: 16px;">
          Your billing plan for <strong>${escapeHtml(teamName)}</strong> has been changed from <strong>${escapeHtml(oldPlanName)}</strong> to <strong>${escapeHtml(newPlanName)}</strong>.
        </p>
        <p style="margin-bottom: 0;">
          ${escapeHtml(statusMessage)}
        </p>
      `
    }
  ];

  const html = generateEmailHtml({
    title: `Plan ${changeTypeLabel} Confirmation`,
    previewText: `${teamName} plan changed from ${oldPlanName} to ${newPlanName}`,
    sections,
    action: {
      label: 'View Billing Settings',
      url: billingUrl
    },
    alertType: 'billing',
    footerText: `Sent to billing admins of ${teamName}.`
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `Plan ${changeTypeLabel}: ${teamName}`,
    text: `Your billing plan for ${teamName} has been changed from ${oldPlanName} to ${newPlanName}. ${statusMessage} View billing settings: ${billingUrl}`,
    html
  });

  logger.info({ email: recipients, teamName, changeType, oldPlanName, newPlanName }, 'Plan change email sent');
}

/**
 * Send subscription payment expired email
 * Sent when a subscription's initial payment was never completed (e.g. 3DS not finished)
 * and the subscription moved to incomplete_expired.
 */
export async function sendSubscriptionExpiredEmail(
  email: string | string[],
  teamName: string,
  planName: string
): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const billingUrl = emailBillingUrl();

  const sections: EmailSection[] = [
    {
      style: 'error',
      content: `
        <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.error}; font-weight: 800;">Payment not completed</div>
        <div style="font-weight: 800; font-size: 18px; color: ${BRAND.text};">Your subscription to ${escapeHtml(planName)} was not activated</div>
      `
    },
    {
      style: 'default',
      content: `
        <p style="margin-bottom: 16px;">
          Your recent subscription attempt for <strong>${escapeHtml(teamName)}</strong> required additional payment verification, which was not completed in time.
        </p>
        <p style="margin-bottom: 16px;">
          <strong>You have not been charged.</strong> Your team has been moved back to the Free plan.
        </p>
        <p style="margin-bottom: 0;">
          To subscribe to the <strong>${escapeHtml(planName)}</strong> plan, please try again from the billing page and complete all payment verification steps.
        </p>
      `
    },
    {
      style: 'info',
      content: `
        <strong>Tip:</strong> If your card keeps requiring verification, try using a different payment method or contact your bank to pre-authorize the payment.
      `
    }
  ];

  const html = generateEmailHtml({
    title: 'Payment Not Completed',
    previewText: `Your ${planName} subscription for ${teamName} was not activated — no charge was made`,
    sections,
    action: {
      label: 'Resubscribe Now',
      url: billingUrl
    },
    alertType: 'billing',
    footerText: `Sent to billing admins of ${teamName}.`,
    timestamp: new Date()
  });

  const recipients = Array.isArray(email) ? email.join(',') : email;

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `Action Required: ${teamName} subscription payment not completed`,
    text: `Your subscription to ${planName} for ${teamName} was not activated because payment verification was not completed. You have not been charged. Please resubscribe: ${billingUrl}`,
    html
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
 * Sent when Stripe has an open invoice that needs customer action, such as 3DS.
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

  const sections: EmailSection[] = [
    {
      style: 'warning',
      content: `
        <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.warning}; font-weight: 800;">Payment authentication needed</div>
        <div style="font-weight: 800; font-size: 18px; color: ${BRAND.text};">Complete your ${escapeHtml(planLabel)} payment</div>
      `
    },
    {
      style: 'default',
      content: `
        <p style="margin-bottom: 16px;">
          Your recent billing change for <strong>${escapeHtml(params.teamName)}</strong> is almost complete, but Stripe needs one more payment authentication step.
        </p>
        <p style="margin-bottom: 16px;">
          The open invoice amount is <strong>${escapeHtml(amount)}</strong>.
        </p>
        <p style="margin-bottom: 0;">
          Please complete the secure payment step so your Rejourney billing stays active.
        </p>
      `
    },
    {
      style: 'info',
      content: `
        <strong>Already completed it?</strong> You can ignore this email. Stripe will update Rejourney automatically when the payment succeeds.
      `
    }
  ];

  const html = generateEmailHtml({
    title: 'Complete Your Payment',
    previewText: `Stripe needs one more payment step for ${params.teamName}`,
    sections,
    action: {
      label: 'Complete Payment',
      url: params.invoiceUrl
    },
    secondaryAction: {
      label: 'View Billing Settings',
      url: emailBillingUrl()
    },
    alertType: 'billing',
    metaBadges: [
      { label: 'Amount', value: amount, color: 'orange' },
      { label: 'Status', value: 'Action needed', color: 'orange' },
    ],
    footerText: `Sent to billing admins of ${params.teamName}.`,
    timestamp: new Date()
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Billing <billing@rejourney.co>',
    to: recipients,
    subject: `Action Required: Complete payment for ${params.teamName}`,
    text: `Stripe needs one more payment authentication step for ${params.teamName}. Open invoice amount: ${amount}. Complete payment: ${params.invoiceUrl}`,
    html
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
  }).join(', ');
}

function buildDeveloperSetupEmailBody(params: DeveloperSetupEmailParams): string {
  const { project, teamName, aiPrompt } = params;
  return [
    'Hi,',
    '',
    `Please integrate Rejourney into ${project.name || 'this app'}. You may not have Rejourney dashboard context, so this email includes the project details and setup instructions you need.`,
    '',
    'Project context:',
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
    'Implementation goal:',
    '- Install the matching Rejourney SDK for the app stack you find in the repo.',
    '- Initialize Rejourney with the public key above.',
    '- Add the route/screen tracking and privacy controls described in the instructions.',
    '- Run a local or staging test session when finished.',
    '',
    'Use the AI setup instructions below as the source of truth. They are written for an AI coding assistant, but they also work as the implementation checklist for a developer reviewing the code directly.',
    '',
    'AI setup instructions:',
    '--------------------------------------------------',
    aiPrompt,
    '--------------------------------------------------',
    '',
    'Before you mark this complete:',
    '- Confirm the production domains, bundle ID, and package name in the repo match the project context above.',
    '- Do not send PII in custom events or metadata.',
    '- Reply with what changed and whether a test session appeared in Rejourney.',
    '',
    'Thank you!',
  ].filter((line): line is string => line !== null).join('\n');
}

/**
 * Send project setup instructions directly to a developer.
 */
export async function sendDeveloperSetupEmail(params: DeveloperSetupEmailParams): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;

  const requester = params.requesterName?.trim() || 'Your teammate';
  const projectName = params.project.name || 'Rejourney project';
  const setupUrl = emailDashboardAppPath('/setup');
  const text = buildDeveloperSetupEmailBody(params);

  const html = generateEmailHtml({
    title: 'Rejourney Setup Instructions',
    previewText: `${requester} sent Rejourney SDK setup instructions for ${projectName}`,
    projectName,
    projectUrl: setupUrl,
    sections: [
      {
        content: `
          <div style="font-size: 16px; font-weight: 600;">
            <strong>${escapeHtml(requester)}</strong> sent setup instructions for <strong>${escapeHtml(projectName)}</strong>.
          </div>
        `,
      },
      {
        title: 'Setup Email',
        style: 'highlight',
        content: `<pre style="white-space: pre-wrap; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.55;">${escapeHtml(text)}</pre>`,
      },
    ],
    action: {
      label: 'Open Rejourney Setup',
      url: setupUrl,
    },
    alertType: 'general',
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: params.email,
    subject: `Rejourney SDK integration for ${projectName}`,
    text,
    html,
  });

  logger.info({ email: params.email, projectId: params.project.id }, 'Developer setup email sent');
}

/**
 * Send team invitation email
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

  const html = generateEmailHtml({
    title: 'Team Invitation',
    previewText: `${inviterName} invited you to join ${teamName}`,
    sections: [
      {
        content: `
          <div style="font-size: 16px; line-height: 1.65;">
            <strong>${escapeHtml(inviterName)}</strong> invited you to join <strong>${escapeHtml(teamName)}</strong> on Rejourney.
          </div>
        `
      },
      {
        style: 'success',
        content: `
          <div style="font-size: 14px;">
            <div style="margin-bottom: 5px; color: ${BRAND.muted}; font-weight: 700;">Assigned role</div>
            <div style="font-size: 22px; font-weight: 800; color: ${BRAND.text};">${escapeHtml(role)}</div>
          </div>
        `
      },
      {
        style: 'info',
        content: `Link expires in <strong>7 days</strong>.`
      }
    ],
    action: {
      label: 'Accept Invitation',
      url: inviteUrl
    },
    alertType: 'general',
  });

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney <noreply@rejourney.co>',
    to: email,
    subject: `${inviterName} invited you to ${teamName} on Rejourney`,
    text: `Join ${teamName} as a ${role}. Accept here: ${inviteUrl}`,
    html
  });

  logger.info({ email, teamName, role }, 'Team invitation email sent');
}

// =============================================================================
// Alert Email Functions
// =============================================================================

export interface CrashAlertData {
  projectId: string;
  projectName: string;
  crashTitle: string;
  subtitle?: string;
  shortId?: string;
  issueId?: string;
  affectedUsers: number;
  eventCount?: number;
  events24h?: number;
  events90d?: number;
  issueUrl: string;
  stackTrace?: string;
  affectedVersions?: Record<string, number>;
  affectedDevices?: Record<string, number>;
  screenName?: string;
  componentName?: string;
  culprit?: string;
  environment?: string;
  status?: string;
  priority?: string;
  firstSeen?: Date;
  lastSeen?: Date;
  isHandled?: boolean;
  sampleSessionId?: string;
  sampleAppVersion?: string;
  sampleOsVersion?: string;
  sampleDeviceModel?: string;
}

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

function formatIssueType(value: string | null | undefined): string {
  if (!value) return 'Leak';
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderLeakScanIssueTable(issues: LeakScanEmailIssue[], timeZone: string): string {
  const rows = issues.map((issue, index) => {
    const affectedUsers = Math.max(0, Number(issue.estimatedAffectedUsers || 0));
    const affectedSessions = Math.max(0, Number(issue.affectedSessions || 0));
    const firstSeen = issue.firstSeen ? formatEmailDate(issue.firstSeen, timeZone) : null;
    const lastSeen = issue.lastSeen ? formatEmailDate(issue.lastSeen, timeZone) : null;
    const dateLine = [
      firstSeen ? `First seen ${firstSeen}` : null,
      lastSeen ? `Last seen ${lastSeen}` : null,
      issue.contextStatus ? `Context ${formatIssueType(issue.contextStatus)}` : null,
    ].filter(Boolean).map((value) => escapeHtml(value)).join(' · ');
    const meta = [
      issue.shortId || `#${index + 1}`,
      formatIssueType(issue.issueType),
      issue.severity ? `${formatIssueType(issue.severity)} severity` : null,
      issue.status ? formatIssueType(issue.status) : null,
    ].filter((item): item is string => Boolean(item));
    const signals = renderPills(issue.topSignals ?? []);
    const impactItems = [
      {
        label: 'Est. users',
        value: affectedUsers.toLocaleString(),
        color: affectedUsers > 0 ? BRAND.warning : BRAND.text,
      },
      affectedSessions > 0 ? {
        label: 'Sessions',
        value: affectedSessions.toLocaleString(),
        color: BRAND.text,
      } : null,
    ].filter((item): item is { label: string; value: string; color: string } => Boolean(item));
    const impactWidth = Math.floor(100 / impactItems.length);
    const impactStrip = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid ${BRAND.borderSoft}; border-bottom: 1px solid ${BRAND.borderSoft}; margin-top: 14px;">
        <tr>
          ${impactItems.map((item, itemIndex) => `
            <td class="rj-leak-impact-cell" width="${impactWidth}%" style="${itemIndex === impactItems.length - 1 ? '' : `border-right: 1px solid ${BRAND.borderSoft};`} padding: 11px 14px 10px ${itemIndex === 0 ? '0' : '14px'}; vertical-align: top;">
              <div style="font-size: 18px; line-height: 1.2; font-weight: 750; color: ${item.color};">${escapeHtml(item.value)}</div>
              <div style="font-size: 11px; line-height: 1.35; color: ${BRAND.subtle}; font-weight: 700; margin-top: 4px;">${escapeHtml(item.label)}</div>
            </td>
          `).join('')}
        </tr>
      </table>
    `;

    return `
      <tr>
        <td style="border-bottom: 1px solid ${BRAND.borderSoft}; padding: 18px 0 20px; vertical-align: top;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
            <tr>
              <td class="rj-leak-index" width="42" style="padding: 2px 16px 0 0; vertical-align: top; color: ${BRAND.subtle}; font-size: 12px; line-height: 1.4; font-weight: 800;">${String(index + 1).padStart(2, '0')}</td>
              <td style="vertical-align: top;">
                <div style="font-weight: 750; font-size: 17px; line-height: 1.35; color: ${BRAND.text}; word-break: normal;">${escapeHtml(issue.title)}</div>
                <div style="font-size: 12px; line-height: 1.5; color: ${BRAND.muted}; margin-top: 5px; font-weight: 700;">
                  ${escapeHtml(meta.join(' · '))}
                </div>
              </td>
            </tr>
          </table>
          ${issue.whyItMatters ? `
            <div class="rj-leak-body" style="font-size: 14px; line-height: 1.58; color: ${BRAND.textSecondary}; margin-top: 12px; margin-left: 58px; word-break: normal;">
              <span style="font-size: 12px; color: ${BRAND.subtle}; font-weight: 800;">Why it matters:</span>
              ${escapeHtml(issue.whyItMatters)}
            </div>
          ` : ''}
          ${dateLine ? `<div class="rj-leak-body" style="font-size: 12px; line-height: 1.55; color: ${BRAND.muted}; margin-top: 11px; margin-left: 58px;">${dateLine}</div>` : ''}
          <div class="rj-leak-body" style="margin-left: 58px;">${impactStrip}</div>
          ${signals ? `<div class="rj-leak-body" style="font-size: 12px; margin-top: 9px; margin-left: 58px;">${signals}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid ${BRAND.borderSoft};">
      ${rows}
    </table>
  `;
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
  const issueLabel = formatCountWithLabel(sortedIssues.length, 'issue', 'issues');
  const userLabel = formatCountWithLabel(totalUsers, 'estimated affected user', 'estimated affected users');
  const subject = truncateForSubject(`Leak scan for ${data.projectName}: ${issueLabel}, ${userLabel}`);
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);

  const metaBadges: EmailMetaBadge[] = [
    { label: 'Issues', value: sortedIssues.length.toLocaleString(), color: sortedIssues.length > 0 ? 'blue' : 'gray' },
    { label: 'Est. users', value: totalUsers.toLocaleString(), color: totalUsers > 0 ? 'orange' : 'gray' },
  ];
  if (totalSessions > 0) metaBadges.push({ label: 'Sessions', value: totalSessions.toLocaleString(), color: 'purple' });
  if (highSeverityCount > 0) metaBadges.push({ label: 'High severity', value: highSeverityCount.toLocaleString(), color: 'red' });

  const buildSections = (timeZone: string): EmailSection[] => [
    {
      title: 'Scan Summary',
      content: `
        ${renderMetricGrid([
          { label: 'Inbox issues', value: sortedIssues.length.toLocaleString(), tone: 'info' },
          { label: 'Est. affected users', value: totalUsers.toLocaleString(), tone: totalUsers > 0 ? 'warning' : 'default' },
          { label: 'Affected sessions', value: totalSessions > 0 ? totalSessions.toLocaleString() : null },
          { label: 'Admitted sessions', value: data.admittedSessions !== null && data.admittedSessions !== undefined ? data.admittedSessions.toLocaleString() : null },
          { label: 'High severity', value: highSeverityCount > 0 ? highSeverityCount.toLocaleString() : null, tone: 'error' },
        ])}
      `,
    },
    {
      style: 'info',
      content: `
        Rejourney grouped repeated replay signals into product leaks that are ready for triage. Start with the first item; it has the largest estimated user impact in this scan.
      `,
    },
    {
      title: 'Highest-Risk Leaks',
      content: renderLeakScanIssueTable(sortedIssues, timeZone),
    },
    {
      title: 'Recommended Next Steps',
      style: 'info',
      content: `
        Open the Leaks dashboard, review the replay evidence for the top issue, then generate the IDE handoff once the context status is ready.
      `,
    },
  ];

  for (const group of recipientGroups) {
    const completedAtText = formatEmailDate(data.completedAt, group.timeZone);
    const textLines = [
      `${data.projectName} leak scan summary: ${issueLabel}, ${userLabel}`,
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
        title: subject,
        previewText: `${data.projectName}: ${issueLabel}, ${userLabel}`,
        sections: buildSections(group.timeZone),
        action: {
          label: 'Open Dashboard',
          url: data.dashboardUrl,
        },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        alertType: 'leak_scan',
        metaBadges,
        timestamp: data.completedAt,
        timeZone: group.timeZone,
        footerText: `Scan completed ${completedAtText}. Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      })
    });
  }
}

export async function sendCrashAlertEmail(
  recipients: AlertEmailRecipientInput[],
  data: CrashAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const issueLink = emailDashboardAppPath(data.issueId ? `/general/${data.issueId}` : '/general');
  const allIssuesLink = emailDashboardAppPath('/general');
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);
  const alertTitle = data.isHandled === false ? 'Unhandled Crash' : 'Crash Alert';
  const eventLabel = formatCountWithLabel(data.eventCount, 'event', 'events');
  const userLabel = formatCountWithLabel(data.affectedUsers, 'user', 'users');
  const subject = truncateForSubject(`${alertTitle} in ${data.projectName}: ${data.crashTitle} (${userLabel})`);

  const metaBadges: EmailMetaBadge[] = [
    { label: 'Users', value: data.affectedUsers.toLocaleString(), color: data.affectedUsers > 0 ? 'red' : 'gray' },
    { label: 'Status', value: data.isHandled === false ? 'Unhandled' : formatIssueType(data.status || 'reported'), color: data.isHandled === false ? 'red' : 'gray' },
  ];

  if (data.shortId) {
    metaBadges.unshift({ label: 'ID', value: data.shortId, color: 'gray' });
  }
  if (data.priority) {
    metaBadges.push({ label: 'Priority', value: formatIssueType(data.priority), color: ['high', 'critical'].includes(data.priority.toLowerCase()) ? 'red' : 'orange' });
  }
  if (data.environment) {
    metaBadges.push({ label: 'Env', value: formatIssueType(data.environment), color: 'gray' });
  }
  if (data.eventCount !== undefined) {
    metaBadges.push({ label: 'Events', value: formatCount(data.eventCount), color: 'purple' });
  }
  if (data.events24h !== undefined) {
    metaBadges.push({ label: '24h', value: formatCount(data.events24h), color: data.events24h > 0 ? 'orange' : 'gray' });
  }

  const buildSections = (timeZone: string): EmailSection[] => {
    const sections: EmailSection[] = [];
    const lastSeenLabel = data.lastSeen ? formatEmailDate(data.lastSeen, timeZone) : 'Just now';
    const firstSeenLabel = data.firstSeen ? formatEmailDate(data.firstSeen, timeZone) : null;

    sections.push({
      style: 'error',
      content: `
        <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.error}; font-weight: 800;">${escapeHtml(data.isHandled === false ? 'Unhandled exception' : 'Exception')}</div>
        <div style="font-weight: 800; font-size: 20px; line-height: 1.35; margin-bottom: 8px; color: ${BRAND.text};">${escapeHtml(data.crashTitle)}</div>
        ${data.subtitle ? `<div style="border-top: 1px solid ${BRAND.borderSoft}; border-bottom: 1px solid ${BRAND.borderSoft}; padding: 9px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.5; color: ${BRAND.code};">${escapeHtml(data.subtitle)}</div>` : ''}
        <div style="margin-top: 15px; font-size: 14px; line-height: 1.65; color: ${BRAND.text};">
          Rejourney grouped this crash in <strong>${escapeHtml(data.projectName)}</strong>. It has affected <strong>${escapeHtml(userLabel)}</strong>${data.eventCount !== undefined ? ` across <strong>${escapeHtml(eventLabel)}</strong>` : ''}. Last seen <strong>${escapeHtml(lastSeenLabel)}</strong>.
        </div>
        <div style="margin-top: 16px;">
          ${renderMetricGrid([
            { label: 'Affected users', value: data.affectedUsers.toLocaleString(), tone: 'error' },
            { label: 'Total events', value: data.eventCount !== undefined ? formatCount(data.eventCount) : null, tone: 'warning' },
            { label: 'Events in last 24h', value: data.events24h !== undefined ? formatCount(data.events24h) : null, tone: data.events24h ? 'warning' : 'default' },
            { label: 'Events in 90d', value: data.events90d !== undefined ? formatCount(data.events90d) : null },
            { label: 'Priority', value: data.priority ? formatIssueType(data.priority) : null, tone: data.priority && ['high', 'critical'].includes(data.priority.toLowerCase()) ? 'error' : 'default' },
            { label: 'Status', value: data.status ? formatIssueType(data.status) : null },
          ])}
        </div>
      `
    });

    sections.push({
      title: 'Triage Context',
      content: renderKeyValueTable([
        ['Issue ID', data.shortId || data.issueId],
        ['Status', data.status ? formatIssueType(data.status) : null],
        ['Priority', data.priority ? formatIssueType(data.priority) : null],
        ['Handled', data.isHandled === undefined ? null : data.isHandled ? 'Handled' : 'Unhandled'],
        ['First seen', firstSeenLabel],
        ['Last seen', lastSeenLabel],
        ['Screen', data.screenName],
        ['Component', data.componentName],
        ['Culprit', data.culprit],
        ['Environment', data.environment],
        ['Sample session', data.sampleSessionId],
        ['Sample app version', data.sampleAppVersion ? `v${data.sampleAppVersion}` : null],
        ['Sample OS', data.sampleOsVersion],
        ['Sample device', data.sampleDeviceModel],
      ]),
    });

    const versionBadges = renderTopCountBadges(data.affectedVersions, { prefix: 'v' });
    if (versionBadges) {
      sections.push({
        title: 'Affected Versions',
        content: versionBadges,
      });
    }

    const deviceBadges = renderTopCountBadges(data.affectedDevices);
    if (deviceBadges) {
      sections.push({
        title: 'Affected Devices',
        content: deviceBadges,
      });
    }

    if (data.stackTrace) {
      const stackLines = data.stackTrace.split('\n').slice(0, 12);
      sections.push({
        title: 'Stack Trace',
        style: 'highlight',
        content: `<pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(stackLines.join('\n'))}</pre>`
      });
    }

    sections.push({
      title: 'Suggested Investigation',
      content: `
        <ol style="margin: 0; padding-left: 20px; color: ${BRAND.text}; font-size: 15px; line-height: 1.7;">
          <li>Open the issue and start with the sample session${data.sampleSessionId ? ` <strong>${escapeHtml(data.sampleSessionId)}</strong>` : ''}.</li>
          <li>Check the top affected version and device concentration before rolling back or patching.</li>
          <li>Use the first app frame in the stack trace${data.culprit ? `, especially <strong>${escapeHtml(data.culprit)}</strong>` : ''}, as the initial owner hint.</li>
        </ol>
      `,
    });

    sections.push({
      title: 'Why You Got This',
      style: 'info',
      content: `
        This matched your crash email alert rules for ${escapeHtml(data.projectName)}. Rejourney suppresses duplicate emails for the same issue for one hour and caps project alert emails per day.
      `,
    });

    return sections;
  };

  for (const group of recipientGroups) {
    const lastSeenText = data.lastSeen ? formatEmailDate(data.lastSeen, group.timeZone) : 'just now';
    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: `${alertTitle} in ${data.projectName}: ${data.crashTitle}. Affected users: ${data.affectedUsers}. Last seen: ${lastSeenText}. View issue: ${issueLink}`,
      html: generateEmailHtml({
        title: alertTitle,
        previewText: `${data.crashTitle} in ${data.projectName} affected ${userLabel}; last seen ${lastSeenText}`,
        sections: buildSections(group.timeZone),
        action: {
          label: 'View Issue',
          url: issueLink
        },
        secondaryAction: {
          label: 'All Issues',
          url: allIssuesLink,
        },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        alertType: 'crash',
        metaBadges,
        timestamp: data.lastSeen || new Date(),
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      })
    });
  }
}

// =============================================================================
// ANR Alert Email
// =============================================================================

export interface AnrAlertData {
  projectId: string;
  projectName: string;
  durationMs: number;
  affectedUsers: number;
  eventCount?: number;
  events24h?: number;
  events90d?: number;
  shortId?: string;
  issueId?: string;
  issueUrl: string;
  stackTrace?: string;
  affectedVersions?: Record<string, number>;
  affectedDevices?: Record<string, number>;
  screenName?: string;
  componentName?: string;
  culprit?: string;
  environment?: string;
  status?: string;
  priority?: string;
  firstSeen?: Date;
  lastSeen?: Date;
  sampleSessionId?: string;
  sampleAppVersion?: string;
  sampleOsVersion?: string;
  sampleDeviceModel?: string;
}

export async function sendAnrAlertEmail(
  recipients: AlertEmailRecipientInput[],
  data: AnrAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const issueLink = emailDashboardAppPath(data.issueId ? `/general/${data.issueId}` : '/general');
  const allIssuesLink = emailDashboardAppPath('/general');
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);

  const durationSecs = Math.round(data.durationMs / 1000);
  const userLabel = formatCountWithLabel(data.affectedUsers, 'user', 'users');
  const eventLabel = formatCountWithLabel(data.eventCount, 'event', 'events');
  const subject = truncateForSubject(`ANR in ${data.projectName}: app frozen for ${durationSecs}s (${userLabel})`);
  const metaBadges: EmailMetaBadge[] = [
    { label: 'Duration', value: `${durationSecs}s`, color: durationSecs >= 10 ? 'red' : 'orange' },
    { label: 'Users', value: data.affectedUsers.toLocaleString(), color: data.affectedUsers > 0 ? 'orange' : 'gray' },
  ];

  if (data.shortId) {
    metaBadges.unshift({ label: 'ID', value: data.shortId, color: 'gray' });
  }
  if (data.priority) {
    metaBadges.push({ label: 'Priority', value: formatIssueType(data.priority), color: ['high', 'critical'].includes(data.priority.toLowerCase()) ? 'red' : 'orange' });
  }
  if (data.eventCount !== undefined) {
    metaBadges.push({ label: 'Events', value: formatCount(data.eventCount), color: 'purple' });
  }
  if (data.events24h !== undefined) {
    metaBadges.push({ label: '24h', value: formatCount(data.events24h), color: data.events24h > 0 ? 'orange' : 'gray' });
  }

  const buildSections = (timeZone: string): EmailSection[] => {
    const sections: EmailSection[] = [];
    const lastSeenLabel = data.lastSeen ? formatEmailDate(data.lastSeen, timeZone) : 'Just now';
    const firstSeenLabel = data.firstSeen ? formatEmailDate(data.firstSeen, timeZone) : null;

    sections.push({
      style: 'warning',
      content: `
        <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.warning}; font-weight: 800;">App not responding</div>
        <div style="font-weight: 800; font-size: 20px; line-height: 1.35; margin-bottom: 8px; color: ${BRAND.text};">Main thread frozen for ${durationSecs} seconds</div>
        <div style="margin-top: 12px; font-size: 14px; line-height: 1.65; color: ${BRAND.text};">
          Rejourney detected an ANR in <strong>${escapeHtml(data.projectName)}</strong> affecting <strong>${escapeHtml(userLabel)}</strong>${data.eventCount !== undefined ? ` across <strong>${escapeHtml(eventLabel)}</strong>` : ''}. Last seen <strong>${escapeHtml(lastSeenLabel)}</strong>.
        </div>
        <div style="margin-top: 16px;">
          ${renderMetricGrid([
            { label: 'Freeze duration', value: `${durationSecs}s`, tone: durationSecs >= 10 ? 'error' : 'warning' },
            { label: 'Affected users', value: data.affectedUsers.toLocaleString(), tone: 'warning' },
            { label: 'Total events', value: data.eventCount !== undefined ? formatCount(data.eventCount) : null, tone: 'warning' },
            { label: 'Events in last 24h', value: data.events24h !== undefined ? formatCount(data.events24h) : null, tone: data.events24h ? 'warning' : 'default' },
            { label: 'Priority', value: data.priority ? formatIssueType(data.priority) : null, tone: data.priority && ['high', 'critical'].includes(data.priority.toLowerCase()) ? 'error' : 'default' },
            { label: 'Status', value: data.status ? formatIssueType(data.status) : null },
          ])}
        </div>
      `
    });

    sections.push({
      title: 'Triage Context',
      content: renderKeyValueTable([
        ['Issue ID', data.shortId || data.issueId],
        ['Status', data.status ? formatIssueType(data.status) : null],
        ['Priority', data.priority ? formatIssueType(data.priority) : null],
        ['First seen', firstSeenLabel],
        ['Last seen', lastSeenLabel],
        ['Screen', data.screenName],
        ['Component', data.componentName],
        ['Culprit', data.culprit],
        ['Environment', data.environment],
        ['Sample session', data.sampleSessionId],
        ['Sample app version', data.sampleAppVersion ? `v${data.sampleAppVersion}` : null],
        ['Sample OS', data.sampleOsVersion],
        ['Sample device', data.sampleDeviceModel],
      ]),
    });

    const versionBadges = renderTopCountBadges(data.affectedVersions, { prefix: 'v' });
    if (versionBadges) {
      sections.push({ title: 'Affected Versions', content: versionBadges });
    }

    const deviceBadges = renderTopCountBadges(data.affectedDevices);
    if (deviceBadges) {
      sections.push({ title: 'Affected Devices', content: deviceBadges });
    }

    if (data.stackTrace) {
      const stackLines = data.stackTrace.split('\n').slice(0, 12);
      sections.push({
        title: 'Thread State',
        style: 'highlight',
        content: `<pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(stackLines.join('\n'))}</pre>`
      });
    }

    sections.push({
      title: 'Suggested Investigation',
      content: `
        <ol style="margin: 0; padding-left: 20px; color: ${BRAND.text}; font-size: 15px; line-height: 1.7;">
          <li>Open the issue and inspect the replay around the frozen interval.</li>
          <li>Compare the top affected app versions and devices to see if this is release-specific.</li>
          <li>Use the thread state${data.culprit ? ` and <strong>${escapeHtml(data.culprit)}</strong>` : ''} to find the blocking operation.</li>
        </ol>
      `,
    });

    sections.push({
      title: 'Why You Got This',
      style: 'info',
      content: `
        This matched your ANR email alert rules for ${escapeHtml(data.projectName)}. Rejourney suppresses duplicate emails for the same issue for one hour and caps project alert emails per day.
      `,
    });

    return sections;
  };

  for (const group of recipientGroups) {
    const lastSeenText = data.lastSeen ? formatEmailDate(data.lastSeen, group.timeZone) : 'just now';
    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: `ANR in ${data.projectName}: app frozen for ${durationSecs}s. Affected users: ${data.affectedUsers}. Last seen: ${lastSeenText}. View issue: ${issueLink}`,
      html: generateEmailHtml({
        title: 'ANR Alert',
        previewText: `ANR in ${data.projectName} affected ${userLabel}; last seen ${lastSeenText}`,
        sections: buildSections(group.timeZone),
        action: { label: 'View Issue', url: issueLink },
        secondaryAction: { label: 'All Issues', url: allIssuesLink },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        alertType: 'anr',
        metaBadges,
        timestamp: data.lastSeen || new Date(),
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      })
    });
  }
}

// =============================================================================
// Error Spike Alert Email
// =============================================================================

export interface ErrorSpikeAlertData {
  projectId: string;
  projectName: string;
  currentRate: number;
  previousRate: number;
  percentIncrease: number;
  issueUrl: string;
  topErrors?: Array<{ name: string; count: number }>;
  detectedAt?: Date;
}

export async function sendErrorSpikeAlertEmail(
  recipients: AlertEmailRecipientInput[],
  data: ErrorSpikeAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const issueLink = data.issueUrl || emailDashboardAppPath('/sessions');
  const apiLink = emailDashboardAppPath('/api');
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);
  const subject = truncateForSubject(`API error spike in ${data.projectName}: +${data.percentIncrease.toFixed(0)}% (${data.previousRate.toFixed(1)}% -> ${data.currentRate.toFixed(1)}%)`);

  const metaBadges: EmailMetaBadge[] = [
    { label: 'Spike', value: `+${data.percentIncrease.toFixed(0)}%`, color: data.percentIncrease >= 100 ? 'red' : 'orange' },
    { label: 'Current', value: `${data.currentRate.toFixed(1)}%`, color: 'orange' },
    { label: 'Previous', value: `${data.previousRate.toFixed(1)}%`, color: 'gray' },
  ];

  const buildSections = (timeZone: string): EmailSection[] => {
    const detectedAtLabel = data.detectedAt ? formatEmailDate(data.detectedAt, timeZone) : 'Just now';
    const sections: EmailSection[] = [
      {
        style: 'warning',
        content: `
          <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.warning}; font-weight: 800;">API error rate spike</div>
          <div style="font-weight: 800; font-size: 20px; line-height: 1.35; margin-bottom: 8px; color: ${BRAND.text};">Error rate increased ${data.percentIncrease.toFixed(0)}%</div>
          <div style="font-size: 14px; line-height: 1.65; color: ${BRAND.text};">This measures HTTP 4xx/5xx responses from your app's API calls. It is separate from crash and ANR alerts.</div>
          <div style="margin-top: 16px;">
            ${renderMetricGrid([
              { label: 'Previous error rate', value: `${data.previousRate.toFixed(1)}%` },
              { label: 'Current error rate', value: `${data.currentRate.toFixed(1)}%`, tone: 'warning' },
              { label: 'Increase', value: `+${data.percentIncrease.toFixed(0)}%`, tone: data.percentIncrease >= 100 ? 'error' : 'warning' },
              { label: 'Detected', value: detectedAtLabel },
              { label: 'Direction', value: `${data.previousRate.toFixed(1)}% -> ${data.currentRate.toFixed(1)}%`, tone: 'warning' },
            ])}
          </div>
        `
      },
      {
        title: 'Triage Context',
        content: renderKeyValueTable([
          ['Project', data.projectName],
          ['Detected at', detectedAtLabel],
          ['Previous API error rate', `${data.previousRate.toFixed(1)}%`],
          ['Current API error rate', `${data.currentRate.toFixed(1)}%`],
          ['Increase', `+${data.percentIncrease.toFixed(0)}%`],
        ]),
      },
    ];

    if (data.topErrors && data.topErrors.length > 0) {
      const errorsList = data.topErrors.map(e =>
        `<div style="border-bottom: 1px solid ${BRAND.border}; padding: 10px 0; font-size: 14px; line-height: 1.5; color: ${BRAND.text};"><strong style="color: ${BRAND.warning};">${formatCount(e.count)}x</strong> ${escapeHtml(e.name)}</div>`
      ).join('');
      sections.push({
        title: 'Top Related Issues',
        content: errorsList
      });
    }

    sections.push({
      title: 'Why You Got This',
      style: 'info',
      content: `
        This matched your API error spike alert rules for ${escapeHtml(data.projectName)}. The alert worker compares the recent window against a baseline and rate-limits repeat emails.
      `,
    });

    return sections;
  };

  for (const group of recipientGroups) {
    const detectedAtText = data.detectedAt ? formatEmailDate(data.detectedAt, group.timeZone) : 'just now';
    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: `API error spike in ${data.projectName}: ${data.previousRate.toFixed(1)}% -> ${data.currentRate.toFixed(1)}% (+${data.percentIncrease.toFixed(0)}%). Detected: ${detectedAtText}. View affected sessions: ${issueLink}`,
      html: generateEmailHtml({
        title: 'API Error Spike',
        previewText: `API error rate increased ${data.percentIncrease.toFixed(0)}% in ${data.projectName}`,
        sections: buildSections(group.timeZone),
        action: { label: 'View Sessions', url: issueLink },
        secondaryAction: { label: 'API Insights', url: apiLink },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        alertType: 'error_spike',
        metaBadges,
        timestamp: data.detectedAt || new Date(),
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      })
    });
  }
}

// =============================================================================
// API Degradation Alert Email
// =============================================================================

export interface ApiDegradationAlertData {
  projectId: string;
  projectName: string;
  currentLatencyMs: number;
  previousLatencyMs: number;
  percentIncrease: number;
  issueUrl?: string;
  slowestEndpoints?: Array<{ method: string; path: string; latency: number }>;
  detectedAt?: Date;
}

export async function sendApiDegradationAlertEmail(
  recipients: AlertEmailRecipientInput[],
  data: ApiDegradationAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const recipientGroups = groupAlertRecipientsByTimeZone(recipients);
  if (recipientGroups.length === 0) return;

  const insightsLink = data.issueUrl || emailDashboardAppPath('/api');
  const projectSettingsLink = emailDashboardAppPath(`/settings/${data.projectId}`);
  const subject = truncateForSubject(`API latency degradation in ${data.projectName}: +${data.percentIncrease.toFixed(0)}% (${data.previousLatencyMs}ms -> ${data.currentLatencyMs}ms)`);

  const metaBadges: EmailMetaBadge[] = [
    { label: 'Latency', value: `${data.currentLatencyMs}ms`, color: data.currentLatencyMs >= 1000 ? 'red' : 'orange' },
    { label: 'Increase', value: `+${data.percentIncrease.toFixed(0)}%`, color: data.percentIncrease >= 100 ? 'red' : 'orange' },
    { label: 'Baseline', value: `${data.previousLatencyMs}ms`, color: 'gray' },
  ];

  const buildSections = (timeZone: string): EmailSection[] => {
    const detectedAtLabel = data.detectedAt ? formatEmailDate(data.detectedAt, timeZone) : 'Just now';
    const sections: EmailSection[] = [
      {
        style: 'warning',
        content: `
          <div style="font-size: 13px; margin-bottom: 8px; color: ${BRAND.warning}; font-weight: 800;">API degradation detected</div>
          <div style="font-weight: 800; font-size: 20px; line-height: 1.35; margin-bottom: 8px; color: ${BRAND.text};">Average API latency increased ${data.percentIncrease.toFixed(0)}%</div>
          <div style="font-size: 14px; line-height: 1.65; color: ${BRAND.text};">Recent average latency is materially above the baseline for this project.</div>
          <div style="margin-top: 16px;">
            ${renderMetricGrid([
              { label: 'Baseline latency', value: `${data.previousLatencyMs}ms` },
              { label: 'Current latency', value: `${data.currentLatencyMs}ms`, tone: data.currentLatencyMs >= 1000 ? 'error' : 'warning' },
              { label: 'Increase', value: `+${data.percentIncrease.toFixed(0)}%`, tone: data.percentIncrease >= 100 ? 'error' : 'warning' },
              { label: 'Detected', value: detectedAtLabel },
              { label: 'Direction', value: renderNumberDelta(data.currentLatencyMs, data.previousLatencyMs, 'ms'), tone: 'warning' },
            ])}
          </div>
        `
      },
      {
        title: 'Triage Context',
        content: renderKeyValueTable([
          ['Project', data.projectName],
          ['Detected at', detectedAtLabel],
          ['Previous average latency', `${data.previousLatencyMs}ms`],
          ['Current average latency', `${data.currentLatencyMs}ms`],
          ['Increase', `+${data.percentIncrease.toFixed(0)}%`],
        ]),
      },
    ];

    if (data.slowestEndpoints && data.slowestEndpoints.length > 0) {
      const endpointsList = data.slowestEndpoints.map(e =>
        `<div style="border-bottom: 1px solid ${BRAND.border}; padding: 10px 0; font-size: 14px; line-height: 1.5; color: ${BRAND.text};"><strong style="color: ${BRAND.warning};">${formatCount(e.latency)}ms</strong> <span style="font-weight: 800;">${escapeHtml(e.method)}</span> ${escapeHtml(e.path)}</div>`
      ).join('');
      sections.push({
        title: 'Slowest Endpoints',
        content: endpointsList
      });
    }

    sections.push({
      title: 'Why You Got This',
      style: 'info',
      content: `
        This matched your API latency alert rules for ${escapeHtml(data.projectName)}. The alert worker compares the recent window against a baseline and rate-limits repeat emails.
      `,
    });

    return sections;
  };

  for (const group of recipientGroups) {
    const detectedAtText = data.detectedAt ? formatEmailDate(data.detectedAt, group.timeZone) : 'just now';
    await transport.sendMail({
      from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
      to: group.recipients.map((recipient) => recipient.email).join(','),
      subject,
      text: `API latency degradation in ${data.projectName}: ${data.previousLatencyMs}ms -> ${data.currentLatencyMs}ms (+${data.percentIncrease.toFixed(0)}%). Detected: ${detectedAtText}. View API insights: ${insightsLink}`,
      html: generateEmailHtml({
        title: 'API Degradation',
        previewText: `API latency increased ${data.percentIncrease.toFixed(0)}% in ${data.projectName}`,
        sections: buildSections(group.timeZone),
        action: { label: 'View API Insights', url: insightsLink },
        projectName: data.projectName,
        projectUrl: projectSettingsLink,
        alertType: 'api_degradation',
        metaBadges,
        timestamp: data.detectedAt || new Date(),
        timeZone: group.timeZone,
        footerText: `Sent to alert recipients for ${data.projectName}. Times shown in ${group.timeZone}.`,
      })
    });
  }
}
