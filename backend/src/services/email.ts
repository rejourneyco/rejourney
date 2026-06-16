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
  alertType?: 'crash' | 'anr' | 'error_spike' | 'api_degradation' | 'billing' | 'general';
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

// Rejourney Neo-Brutalist Style
const BRAND = {
  black: '#000000',
  white: '#ffffff',
  accent: '#2563eb', // bold blue
  success: '#059669', // bold green
  warning: '#d97706', // bold orange
  error: '#dc2626', // bold red
  surface: '#ffffff', // pure white
  canvas: '#f1f5f9', // light gray background
  border: '#000000', // pure black borders
};

const ALERT_LABELS: Record<string, string> = {
  crash: 'CRASH ALERT',
  anr: 'ANR ALERT',
  error_spike: 'ERROR SPIKE',
  api_degradation: 'PERFORMANCE',
  billing: 'BILLING NOTICE',
  general: 'NOTIFICATION',
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

function renderKeyValueTable(rows: Array<[string, string | number | null | undefined]>): string {
  const visibleRows = rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0);
  if (visibleRows.length === 0) return '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 13px;">
      ${visibleRows.map(([label, value]) => `
        <tr>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 8px 0; color: #525252; font-weight: 700; width: 38%;">${escapeHtml(label)}</td>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 8px 0; color: #000; font-family: monospace; font-weight: 800; text-align: right;">${escapeHtml(value)}</td>
        </tr>
      `).join('')}
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
    .map(([label, count]) => `<span style="border: 1px solid #000; background: #fff; padding: 3px 7px; margin: 0 5px 5px 0; display: inline-block; font-size: 11px; font-family: monospace; font-weight: 800;">${escapeHtml(options.prefix || '')}${escapeHtml(label)}: ${formatCount(count)}</span>`)
    .join('');
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
 * Shared Email Template - Rejourney Neo-Brutalist Style
 * High contrast, sharp borders, bold typography.
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

  // Base styles
  const styles = {
    // Body reset
    body: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: ${BRAND.canvas}; margin: 0; padding: 40px 0; color: ${BRAND.black}; line-height: 1.5; -webkit-font-smoothing: antialiased;`,

    // Main container - brutalist border/shadow
    container: `max-width: 600px; margin: 0 auto; background-color: ${BRAND.surface}; border: 3px solid ${BRAND.black}; box-shadow: 8px 8px 0 0 ${BRAND.black}; width: 100%;`,

    // Header
    header: `background-color: ${BRAND.white}; padding: 32px 32px 24px; border-bottom: 3px solid ${BRAND.black};`,
    navTable: `width: 100%; border-collapse: collapse; margin-bottom: 32px;`,
    navCell: `vertical-align: middle;`,
    navProjectCell: `vertical-align: middle; text-align: right;`,
    logo: `font-size: 24px; font-weight: 900; color: ${BRAND.black}; text-decoration: none; text-transform: uppercase; letter-spacing: -0.5px;`,
    projectBadge: `background: ${BRAND.black}; color: ${BRAND.white}; font-size: 12px; font-weight: 700; padding: 6px 12px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;`,

    // Content area
    content: `padding: 32px;`,

    // Typography
    h1: `font-size: 32px; font-weight: 900; line-height: 1.1; margin: 0 0 16px; letter-spacing: -1px; text-transform: uppercase; color: ${BRAND.black};`,
    subtitle: `font-size: 16px; font-weight: 500; color: #525252; margin: 0 0 24px; font-family: monospace;`,

    // Alert banner
    alertLabel: `display: inline-block; background: ${BRAND.black}; color: ${BRAND.white}; font-size: 11px; font-weight: 800; padding: 4px 8px; text-transform: uppercase; margin-bottom: 16px; letter-spacing: 1px;`,

    // Sections
    section: `margin-bottom: 32px;`,
    sectionTitle: `font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: ${BRAND.black}; border-bottom: 2px solid ${BRAND.black}; padding-bottom: 8px; margin-bottom: 16px;`,
    text: `font-size: 16px; line-height: 1.6; padding: 0; margin: 0;`,

    // Styled boxes
    box: `border: 2px solid ${BRAND.black}; padding: 20px; background: #fff; position: relative;`,
    highlightBox: `border: 2px solid ${BRAND.black}; padding: 20px; background: #f8fafc; font-family: monospace; font-size: 13px; overflow-x: auto;`,
    warningBox: `border: 2px solid ${BRAND.black}; padding: 20px; background: #fffbeb; box-shadow: 4px 4px 0 0 #fcd34d;`,
    errorBox: `border: 2px solid ${BRAND.black}; padding: 20px; background: #fef2f2; box-shadow: 4px 4px 0 0 #fca5a5;`,
    successBox: `border: 2px solid ${BRAND.black}; padding: 20px; background: #f0fdf4; box-shadow: 4px 4px 0 0 #86efac;`,
    infoBox: `border: 2px solid ${BRAND.black}; padding: 20px; background: #eff6ff; box-shadow: 4px 4px 0 0 #93c5fd;`,

    // Buttons
    buttonContainer: `margin-top: 40px; display: flex; flex-wrap: wrap; gap: 16px;`,
    button: `background-color: ${BRAND.black}; color: ${BRAND.white}; display: inline-block; padding: 16px 32px; font-weight: 800; text-decoration: none; border: 2px solid ${BRAND.black}; text-transform: uppercase; font-size: 14px; letter-spacing: 0.5px; transition: all 0.2s;`,
    buttonSecondary: `background-color: ${BRAND.white}; color: ${BRAND.black}; display: inline-block; padding: 16px 32px; font-weight: 800; text-decoration: none; border: 2px solid ${BRAND.black}; text-transform: uppercase; font-size: 14px; letter-spacing: 0.5px; box-shadow: 4px 4px 0 0 ${BRAND.black};`,

    // Meta badges
    badgesContainer: `display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; padding-top: 24px; border-top: 2px solid ${BRAND.black};`,
    badge: `display: inline-flex; border: 1px solid ${BRAND.black}; padding: 4px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #fff;`,
    badgeLabel: `opacity: 0.6; margin-right: 4px;`,

    // Footer
    footer: `background-color: #f1f5f9; padding: 32px; border-top: 3px solid ${BRAND.black};`,
    footerText: `font-family: monospace; font-size: 11px; color: ${BRAND.black}; margin: 0; line-height: 1.6; opacity: 0.7;`,
    footerLink: `color: ${BRAND.black}; text-decoration: underline; font-weight: 700;`,
  };

  const renderSection = (section: EmailSection) => {
    let contentStyle = styles.text;
    let containerStyle = '';

    if (section.style === 'highlight') {
      contentStyle = styles.highlightBox;
    } else if (section.style === 'warning') {
      containerStyle = styles.warningBox;
    } else if (section.style === 'error') {
      containerStyle = styles.errorBox;
    } else if (section.style === 'success') {
      containerStyle = styles.successBox;
    } else if (section.style === 'info') {
      containerStyle = styles.infoBox;
    }

    // Standard text wrapper if not a special box
    const contentHtml = section.style && section.style !== 'default' && section.style !== 'highlight'
      ? `<div style="${containerStyle}">${section.content}</div>`
      : `<div style="${contentStyle}">${section.content}</div>`;

    return `
      <div style="${styles.section}">
        ${section.title ? `<div style="${styles.sectionTitle}">${escapeHtml(section.title)}</div>` : ''}
        ${contentHtml}
      </div>
    `;
  };

  const renderMetaBadge = (badge: EmailMetaBadge) => {
    return `
      <div style="${styles.badge}">
        <span style="${styles.badgeLabel}">${escapeHtml(badge.label)}:</span>
        <span>${escapeHtml(badge.value)}</span>
      </div>
    `;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="${styles.body}">
  <!-- Preheader -->
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${safePreviewText}
    ${'&nbsp;'.repeat(100)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 20px;">
        <div style="${styles.container}">
          
          <!-- Header -->
          <div style="${styles.header}">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${styles.navTable}">
              <tr>
                <td style="${styles.navCell}">
                  <a href="${safeBaseUrl}" style="${styles.logo}">Rejourney</a>
                </td>
                <td align="right" style="${styles.navProjectCell}">
                  ${safeProjectName && safeProjectUrl ? `
                    <a href="${safeProjectUrl}" style="${styles.projectBadge}">${safeProjectName}</a>
                  ` : ''}
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
          <div style="${styles.content}">
            ${sections.map(renderSection).join('')}

            ${action || secondaryAction ? `
              <div style="${styles.buttonContainer}">
                ${action ? `<a href="${escapeHtml(action.url)}" style="${styles.button}">${escapeHtml(action.label)}</a>` : ''}
                ${secondaryAction ? `<a href="${escapeHtml(secondaryAction.url)}" style="${styles.buttonSecondary}">${escapeHtml(secondaryAction.label)}</a>` : ''}
              </div>
            ` : ''}
          </div>

          <!-- Footer -->
          <div style="${styles.footer}">
            <p style="${styles.footerText}">
              ${escapeHtml(footerText || 'You received this email because you are registered on Rejourney.')}
            </p>
            <div style="margin-top: 16px; font-family: monospace; font-size: 11px;">
              <a href="${safeBaseUrl}" style="${styles.footerLink}">Dashboard</a> &bull; 
              <a href="https://rejourney.co/docs" style="${styles.footerLink}">Docs</a> &bull; 
              <a href="mailto:contact@rejourney.co" style="${styles.footerLink}">Support</a>
            </div>
            <p style="${styles.footerText}; margin-top: 16px; font-weight: bold;">
              REJOURNEY
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
          <div style="border: 2px solid #000; padding: 32px; text-align: center; background: #fff;">
            <div style="font-family: monospace; color: #555; margin-bottom: 12px; font-size: 14px;">VERIFICATION CODE</div>
            <div style="font-size: 48px; font-weight: 900; letter-spacing: 4px; color: #000; font-family: monospace;">${code}</div>
          </div>
        `
      },
      {
        style: 'info',
        content: `
          <strong>Security Check:</strong> Never share this code. Rejourney support will never ask for it.
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

  const remaining = cap - currentUsage;

  const metaBadges: EmailMetaBadge[] = [
    { label: 'USAGE', value: `${usagePercent}%` },
    { label: 'STATUS', value: urgencyLabel },
    { label: 'REMAINING', value: `${remaining.toLocaleString()} REPLAYS` },
  ];

  const html = generateEmailHtml({
    title: 'Usage Limit Warning',
    previewText: `${teamName} has used ${usagePercent}% of monthly session replay usage`,
    sections: [
      {
        style: 'warning',
        content: `
          <div style="text-align: center;">
            <div style="font-size: 64px; font-weight: 900; line-height: 1;">${usagePercent}%</div>
            <div style="font-weight: bold; text-transform: uppercase; margin-top: 8px;">of monthly session replay limit used</div>
          </div>
          <div style="margin-top: 24px; border-top: 2px solid #000; padding-top: 16px; display: flex; justify-content: space-between; font-family: monospace; font-weight: bold;">
            <span>USED: ${currentUsage.toLocaleString()}</span>
            <span>TOTAL: ${cap.toLocaleString()}</span>
          </div>
        `
      },
      {
        title: 'What Happens Next?',
        content: `
          Session replay capture will <strong>PAUSE</strong> when you hit 100%. 
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
          Your billing plan for <strong>${teamName}</strong> has been changed from <strong>${oldPlanName}</strong> to <strong>${newPlanName}</strong>.
        </p>
        <p style="margin-bottom: 0;">
          ${statusMessage}
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
        <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">PAYMENT NOT COMPLETED</div>
        <div style="font-weight: 800; font-size: 18px;">Your subscription to ${planName} was not activated</div>
      `
    },
    {
      style: 'default',
      content: `
        <p style="margin-bottom: 16px;">
          Your recent subscription attempt for <strong>${teamName}</strong> required additional payment verification (such as 3D Secure authentication), which was not completed in time.
        </p>
        <p style="margin-bottom: 16px;">
          <strong>You have not been charged.</strong> Your team has been moved back to the Free plan.
        </p>
        <p style="margin-bottom: 0;">
          To subscribe to the <strong>${planName}</strong> plan, please try again from the billing page and make sure to complete all payment verification steps.
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
    `Could you please integrate Rejourney into ${project.name || 'our web application'}? It will allow us to record sessions and track user diagnostics.`,
    '',
    'Project details:',
    teamName ? `- Team: ${teamName}` : null,
    project.name ? `- Project: ${project.name}` : null,
    `- API Key: ${project.publicKey}`,
    `- Platforms: ${formatProjectPlatformsForEmail(project)}`,
    project.webAllowedDomains?.length
      ? `- Web allowed domains: ${project.webAllowedDomains.join(', ')}`
      : project.webDomain
        ? `- Web allowed domain: ${project.webDomain}`
        : null,
    project.bundleId ? `- iOS bundle ID: ${project.bundleId}` : null,
    project.packageName ? `- Android package name: ${project.packageName}` : null,
    '',
    'Here are the quick options to get it set up:',
    '',
    'Option 1: Using an AI Coding Agent (Cursor, Copilot, v0, etc.) - Recommended',
    'Just copy and paste the prompt below into your AI editor. It has all the files and configurations needed:',
    '--------------------------------------------------',
    aiPrompt,
    '--------------------------------------------------',
    '',
    'Option 2: Manual Setup',
    '- Package install: Install the Rejourney package.',
    '- Initialize: Start the SDK with our project API key.',
    `  API Key: ${project.publicKey}`,
    '',
    'Once complete, please trigger a local test session so we can verify the data on our end.',
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
          <div style="font-size: 18px; font-weight: 500;">
            <strong>${inviterName}</strong> has invited you to join the team <strong>${teamName}</strong>.
          </div>
        `
      },
      {
        style: 'success',
        content: `
          <div style="font-family: monospace; font-size: 14px;">
            <div style="margin-bottom: 4px; opacity: 0.7;">ASSIGNED ROLE</div>
            <div style="font-size: 24px; font-weight: 900; text-transform: uppercase;">${role}</div>
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
  issueUrl: string;
  stackTrace?: string;
  affectedVersions?: Record<string, number>;
  affectedDevices?: Record<string, number>;
  screenName?: string;
  componentName?: string;
  environment?: string;
  firstSeen?: Date;
  lastSeen?: Date;
  isHandled?: boolean;
  sampleAppVersion?: string;
  sampleOsVersion?: string;
  sampleDeviceModel?: string;
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
    { label: 'USERS', value: data.affectedUsers.toLocaleString() },
    { label: 'STATUS', value: data.isHandled === false ? 'UNHANDLED' : 'REPORTED' },
  ];

  if (data.shortId) {
    metaBadges.unshift({ label: 'ID', value: data.shortId });
  }
  if (data.environment) {
    metaBadges.push({ label: 'ENV', value: data.environment.toUpperCase() });
  }
  if (data.eventCount !== undefined) {
    metaBadges.push({ label: 'EVENTS', value: formatCount(data.eventCount) });
  }

  const buildSections = (timeZone: string): EmailSection[] => {
    const sections: EmailSection[] = [];
    const lastSeenLabel = data.lastSeen ? formatEmailDate(data.lastSeen, timeZone) : 'Just now';
    const firstSeenLabel = data.firstSeen ? formatEmailDate(data.firstSeen, timeZone) : null;

    sections.push({
      style: 'error',
      content: `
        <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">${escapeHtml(data.isHandled === false ? 'UNHANDLED EXCEPTION' : 'EXCEPTION')}</div>
        <div style="font-weight: 800; font-size: 19px; margin-bottom: 8px;">${escapeHtml(data.crashTitle)}</div>
        ${data.subtitle ? `<div style="font-family: monospace; font-size: 13px; line-height: 1.45;">${escapeHtml(data.subtitle)}</div>` : ''}
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #000; font-size: 13px; line-height: 1.55;">
          Rejourney grouped this crash in <strong>${escapeHtml(data.projectName)}</strong>. It has affected <strong>${escapeHtml(userLabel)}</strong>${data.eventCount !== undefined ? ` across <strong>${escapeHtml(eventLabel)}</strong>` : ''}. Last seen <strong>${escapeHtml(lastSeenLabel)}</strong>.
        </div>
      `
    });

    sections.push({
      title: 'Triage Context',
      content: renderKeyValueTable([
        ['Issue ID', data.shortId || data.issueId],
        ['First seen', firstSeenLabel],
        ['Last seen', lastSeenLabel],
        ['Screen', data.screenName],
        ['Component', data.componentName],
        ['Environment', data.environment],
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
  shortId?: string;
  issueId?: string;
  issueUrl: string;
  stackTrace?: string;
  affectedVersions?: Record<string, number>;
  affectedDevices?: Record<string, number>;
  screenName?: string;
  environment?: string;
  firstSeen?: Date;
  lastSeen?: Date;
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
    { label: 'DURATION', value: `${durationSecs}s` },
    { label: 'USERS', value: data.affectedUsers.toLocaleString() },
  ];

  if (data.shortId) {
    metaBadges.unshift({ label: 'ID', value: data.shortId });
  }
  if (data.eventCount !== undefined) {
    metaBadges.push({ label: 'EVENTS', value: formatCount(data.eventCount) });
  }

  const buildSections = (timeZone: string): EmailSection[] => {
    const sections: EmailSection[] = [];
    const lastSeenLabel = data.lastSeen ? formatEmailDate(data.lastSeen, timeZone) : 'Just now';
    const firstSeenLabel = data.firstSeen ? formatEmailDate(data.firstSeen, timeZone) : null;

    sections.push({
      style: 'warning',
      content: `
        <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">APP NOT RESPONDING</div>
        <div style="font-weight: 800; font-size: 19px; margin-bottom: 8px;">Main thread frozen for ${durationSecs} seconds</div>
        <div style="margin-top: 12px; font-size: 13px; line-height: 1.55;">
          Rejourney detected an ANR in <strong>${escapeHtml(data.projectName)}</strong> affecting <strong>${escapeHtml(userLabel)}</strong>${data.eventCount !== undefined ? ` across <strong>${escapeHtml(eventLabel)}</strong>` : ''}. Last seen <strong>${escapeHtml(lastSeenLabel)}</strong>.
        </div>
      `
    });

    sections.push({
      title: 'Triage Context',
      content: renderKeyValueTable([
        ['Issue ID', data.shortId || data.issueId],
        ['First seen', firstSeenLabel],
        ['Last seen', lastSeenLabel],
        ['Screen', data.screenName],
        ['Environment', data.environment],
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
    { label: 'SPIKE', value: `+${data.percentIncrease.toFixed(0)}%` },
    { label: 'CURRENT', value: `${data.currentRate.toFixed(1)}%` },
    { label: 'PREVIOUS', value: `${data.previousRate.toFixed(1)}%` },
  ];

  const buildSections = (timeZone: string): EmailSection[] => {
    const detectedAtLabel = data.detectedAt ? formatEmailDate(data.detectedAt, timeZone) : 'Just now';
    const sections: EmailSection[] = [
      {
        style: 'warning',
        content: `
          <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">API ERROR RATE SPIKE DETECTED</div>
          <div style="font-weight: 800; font-size: 19px; margin-bottom: 8px;">API error rate increased ${data.percentIncrease.toFixed(0)}%</div>
          <div style="margin-top: 8px; font-size: 13px; line-height: 1.55;">This measures HTTP 4xx/5xx responses from your app's API calls. It is separate from crash and ANR alerts.</div>
          <div style="margin-top: 16px; font-size: 13px; line-height: 1.55;">
            <strong>Baseline:</strong> ${data.previousRate.toFixed(1)}% &rarr; <strong>Current:</strong> ${data.currentRate.toFixed(1)}%<br>
            <strong>Detected:</strong> ${escapeHtml(detectedAtLabel)}
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
        `<div style="margin: 6px 0; font-size: 12px; font-family: monospace;"><strong>${formatCount(e.count)}x</strong> ${escapeHtml(e.name)}</div>`
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
    { label: 'LATENCY', value: `${data.currentLatencyMs}ms` },
    { label: 'INCREASE', value: `+${data.percentIncrease.toFixed(0)}%` },
  ];

  const buildSections = (timeZone: string): EmailSection[] => {
    const detectedAtLabel = data.detectedAt ? formatEmailDate(data.detectedAt, timeZone) : 'Just now';
    const sections: EmailSection[] = [
      {
        style: 'warning',
        content: `
          <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">API DEGRADATION DETECTED</div>
          <div style="font-weight: 800; font-size: 19px; margin-bottom: 8px;">Average API latency increased ${data.percentIncrease.toFixed(0)}%</div>
          <div style="margin-top: 16px; font-size: 13px; line-height: 1.55;">
            <strong>Baseline:</strong> ${data.previousLatencyMs}ms &rarr; <strong>Current:</strong> ${data.currentLatencyMs}ms<br>
            <strong>Detected:</strong> ${escapeHtml(detectedAtLabel)}
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
        `<div style="margin: 6px 0; font-size: 12px; font-family: monospace;"><strong>${formatCount(e.latency)}ms</strong> ${escapeHtml(e.method)} ${escapeHtml(e.path)}</div>`
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
