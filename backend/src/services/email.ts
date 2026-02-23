/**
 * Email Service
 * 
 * Sends OTP and notification emails
 */

import nodemailer from 'nodemailer';
import { config, isDevelopment } from '../config.js';
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
}

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

/**
 * Format a date for email display
 */
function formatEmailDate(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
}: EmailTemplateProps): string {
  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';

  // Base styles
  const styles = {
    // Body reset
    body: `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: ${BRAND.canvas}; margin: 0; padding: 40px 0; color: ${BRAND.black}; line-height: 1.5; -webkit-font-smoothing: antialiased;`,

    // Main container - brutalist border/shadow
    container: `max-width: 600px; margin: 0 auto; background-color: ${BRAND.surface}; border: 3px solid ${BRAND.black}; box-shadow: 8px 8px 0 0 ${BRAND.black}; width: 100%;`,

    // Header
    header: `background-color: ${BRAND.white}; padding: 32px 32px 24px; border-bottom: 3px solid ${BRAND.black};`,
    nav: `display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px;`,
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
        ${section.title ? `<div style="${styles.sectionTitle}">${section.title}</div>` : ''}
        ${contentHtml}
      </div>
    `;
  };

  const renderMetaBadge = (badge: EmailMetaBadge) => {
    return `
      <div style="${styles.badge}">
        <span style="${styles.badgeLabel}">${badge.label}:</span>
        <span>${badge.value}</span>
      </div>
    `;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="${styles.body}">
  <!-- Preheader -->
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${previewText}
    ${'&nbsp;'.repeat(100)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 20px;">
        <div style="${styles.container}">
          
          <!-- Header -->
          <div style="${styles.header}">
            <div style="${styles.nav}">
              <a href="${baseUrl}" style="${styles.logo}">
                Rejourney
              </a>
              ${projectName && projectUrl ? `
                <a href="${projectUrl}" style="${styles.projectBadge}">${projectName}</a>
              ` : ''}
            </div>

            ${alertType ? `
              <div style="${styles.alertLabel}">
                ${ALERT_LABELS[alertType] || 'NOTIFICATION'}
              </div>
            ` : ''}
            
            <h1 style="${styles.h1}">${title}</h1>
            
            ${timestamp ? `
              <div style="${styles.subtitle}">
                ${formatEmailDate(timestamp)}
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
                ${action ? `<a href="${action.url}" style="${styles.button}">${action.label}</a>` : ''}
                ${secondaryAction ? `<a href="${secondaryAction.url}" style="${styles.buttonSecondary}">${secondaryAction.label}</a>` : ''}
              </div>
            ` : ''}
          </div>

          <!-- Footer -->
          <div style="${styles.footer}">
            <p style="${styles.footerText}">
              ${footerText || 'You received this email because you are registered on Rejourney.'}
            </p>
            <div style="margin-top: 16px; font-family: monospace; font-size: 11px;">
              <a href="${baseUrl}" style="${styles.footerLink}">Dashboard</a> &bull; 
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

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co/dashboard';
  const billingUrl = `${baseUrl}/dashboard/billing?action=setup`;

  // Determine urgency
  let urgencyLabel = 'WARNING';

  if (usagePercent >= 95) {
    urgencyLabel = 'CRITICAL';
  }

  const remaining = cap - currentUsage;

  const metaBadges: EmailMetaBadge[] = [
    { label: 'USAGE', value: `${usagePercent}%` },
    { label: 'STATUS', value: urgencyLabel },
    { label: 'REMAINING', value: `${remaining.toLocaleString()} MIN` },
  ];

  const html = generateEmailHtml({
    title: 'Usage Limit Warning',
    previewText: `${teamName} has used ${usagePercent}% of monthly recording minutes`,
    sections: [
      {
        style: 'warning',
        content: `
          <div style="text-align: center;">
            <div style="font-size: 64px; font-weight: 900; line-height: 1;">${usagePercent}%</div>
            <div style="font-weight: bold; text-transform: uppercase; margin-top: 8px;">of monthly limit used</div>
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
          Session recording will <strong>PAUSE</strong> when you hit 100%. 
          To keep recording, add a payment method for pay-as-you-go billing.
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
    subject: `Billing Alert: ${teamName} at ${usagePercent}% usage`,
    text: `Team ${teamName} has used ${usagePercent}% of recording minutes. Add payment method: ${billingUrl}`,
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

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  const billingUrl = `${baseUrl}/dashboard/billing`;

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

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  const inviteUrl = `${baseUrl}/invite/accept/${token}`;

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
  recipients: string[],
  data: CrashAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  // Use a generic issues link if specific one isn't constructed correctly or needs to be update
  const issueLink = `${baseUrl}/dashboard/general/${data.issueId || ''}`;

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

  const sections: EmailSection[] = [];

  // Crash Header
  sections.push({
    style: 'error',
    content: `
      <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">EXCEPTION</div>
      <div style="font-weight: 800; font-size: 18px; margin-bottom: 8px;">${data.crashTitle}</div>
      ${data.subtitle ? `<div style="font-family: monospace; font-size: 13px;">${data.subtitle}</div>` : ''}
      
      ${data.screenName ? `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #000; font-size: 13px;"><strong>Screen:</strong> ${data.screenName}</div>` : ''}
    `
  });

  // Stack Trace
  if (data.stackTrace) {
    const stackLines = data.stackTrace.split('\n').slice(0, 10);
    sections.push({
      title: 'Stack Trace',
      style: 'highlight',
      content: `<pre style="margin: 0;">${stackLines.join('\n')}</pre>`
    });
  }

  // Versions Breakdown
  if (data.affectedVersions && Object.keys(data.affectedVersions).length > 0) {
    const sortedVersions = Object.entries(data.affectedVersions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ver, count]) => `<span style="border: 1px solid #000; background: #fff; padding: 2px 6px; margin-right: 4px; font-size: 11px; font-family: monospace;">v${ver}: ${count}</span>`)
      .join('');

    sections.push({
      title: 'Affected Versions',
      content: sortedVersions
    });
  }

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
    to: recipients.join(','),
    subject: `Issue Alert: ${data.crashTitle} (${data.affectedUsers} impacted)`,
    text: `New issue in ${data.projectName}: ${data.crashTitle}. View details: ${issueLink}`,
    html: generateEmailHtml({
      title: 'Issue Alert',
      previewText: `${data.crashTitle} in ${data.projectName}`,
      sections,
      action: {
        label: 'View Issue',
        url: issueLink
      },
      projectName: data.projectName,
      projectUrl: `${baseUrl}/dashboard/settings/${data.projectId}`,
      alertType: 'crash',
      metaBadges,
      timestamp: data.lastSeen || new Date()
    })
  });
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
  recipients: string[],
  data: AnrAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  const issueLink = `${baseUrl}/dashboard/general/${data.issueId || ''}`;

  const durationSecs = Math.round(data.durationMs / 1000);
  const metaBadges: EmailMetaBadge[] = [
    { label: 'DURATION', value: `${durationSecs}s` },
    { label: 'USERS', value: data.affectedUsers.toLocaleString() },
  ];

  if (data.shortId) {
    metaBadges.unshift({ label: 'ID', value: data.shortId });
  }

  const sections: EmailSection[] = [];

  sections.push({
    style: 'warning',
    content: `
      <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">APP NOT RESPONDING</div>
      <div style="font-weight: 800; font-size: 18px; margin-bottom: 8px;">ANR for ${durationSecs} seconds</div>
      ${data.screenName ? `<div style="font-size: 13px;"><strong>Screen:</strong> ${data.screenName}</div>` : ''}
    `
  });

  if (data.stackTrace) {
    const stackLines = data.stackTrace.split('\n').slice(0, 10);
    sections.push({
      title: 'Thread State',
      style: 'highlight',
      content: `<pre style="margin: 0;">${stackLines.join('\n')}</pre>`
    });
  }

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
    to: recipients.join(','),
    subject: `ANR Alert: App frozen for ${durationSecs}s (${data.affectedUsers} users)`,
    text: `ANR detected in ${data.projectName}. View details: ${issueLink}`,
    html: generateEmailHtml({
      title: 'ANR Alert',
      previewText: `ANR in ${data.projectName}`,
      sections,
      action: { label: 'View Issue', url: issueLink },
      projectName: data.projectName,
      projectUrl: `${baseUrl}/dashboard/settings/${data.projectId}`,
      alertType: 'anr',
      metaBadges,
      timestamp: data.lastSeen || new Date()
    })
  });
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
  recipients: string[],
  data: ErrorSpikeAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  const issueLink = data.issueUrl || `${baseUrl}/dashboard/general`;

  const metaBadges: EmailMetaBadge[] = [
    { label: 'SPIKE', value: `+${data.percentIncrease.toFixed(0)}%` },
    { label: 'CURRENT', value: `${data.currentRate.toFixed(1)}%` },
    { label: 'PREVIOUS', value: `${data.previousRate.toFixed(1)}%` },
  ];

  const sections: EmailSection[] = [];

  sections.push({
    style: 'warning',
    content: `
      <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">ERROR SPIKE DETECTED</div>
      <div style="font-weight: 800; font-size: 18px; margin-bottom: 8px;">Error rate increased ${data.percentIncrease.toFixed(0)}%</div>
      <div style="margin-top: 16px; font-size: 13px;">
        <strong>Previous:</strong> ${data.previousRate.toFixed(1)}% → <strong>Current:</strong> ${data.currentRate.toFixed(1)}%
      </div>
    `
  });

  if (data.topErrors && data.topErrors.length > 0) {
    const errorsList = data.topErrors.map(e =>
      `<div style="margin: 4px 0; font-size: 12px;"><strong>${e.count}x</strong> ${e.name}</div>`
    ).join('');
    sections.push({
      title: 'Top Errors',
      content: errorsList
    });
  }

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
    to: recipients.join(','),
    subject: `Error Spike: +${data.percentIncrease.toFixed(0)}% in ${data.projectName}`,
    text: `Error spike in ${data.projectName}. View details: ${issueLink}`,
    html: generateEmailHtml({
      title: 'Error Spike Alert',
      previewText: `Error spike in ${data.projectName}`,
      sections,
      action: { label: 'View Issues', url: issueLink },
      projectName: data.projectName,
      projectUrl: `${baseUrl}/dashboard/settings/${data.projectId}`,
      alertType: 'error_spike',
      metaBadges,
      timestamp: data.detectedAt || new Date()
    })
  });
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
  recipients: string[],
  data: ApiDegradationAlertData
): Promise<void> {
  if (recipients.length === 0) return;
  const transport = getTransporter();
  if (!transport) return;

  const baseUrl = config.PUBLIC_DASHBOARD_URL || 'http://localhost:8080';
  const insightsLink = data.issueUrl || `${baseUrl}/dashboard/analytics/api`;

  const metaBadges: EmailMetaBadge[] = [
    { label: 'LATENCY', value: `${data.currentLatencyMs}ms` },
    { label: 'INCREASE', value: `+${data.percentIncrease.toFixed(0)}%` },
  ];

  const sections: EmailSection[] = [];

  sections.push({
    style: 'warning',
    content: `
      <div style="font-family: monospace; font-size: 12px; margin-bottom: 8px; opacity: 0.7;">API DEGRADATION</div>
      <div style="font-weight: 800; font-size: 16px; margin-bottom: 8px;">Latency increased ${data.percentIncrease.toFixed(0)}%</div>
      <div style="margin-top: 16px; font-size: 13px;">
        <strong>Latency:</strong> ${data.previousLatencyMs}ms → ${data.currentLatencyMs}ms
      </div>
    `
  });

  if (data.slowestEndpoints && data.slowestEndpoints.length > 0) {
    const endpointsList = data.slowestEndpoints.map(e =>
      `<div style="margin: 4px 0; font-size: 12px;"><strong>${e.latency}ms</strong> ${e.method} ${e.path}</div>`
    ).join('');
    sections.push({
      title: 'Slowest Endpoints',
      content: endpointsList
    });
  }

  await transport.sendMail({
    from: config.SMTP_FROM || 'Rejourney Alerts <alerts@rejourney.co>',
    to: recipients.join(','),
    subject: `API Degradation: +${data.percentIncrease.toFixed(0)}% latency in ${data.projectName}`,
    text: `API degradation in ${data.projectName}. View details: ${insightsLink}`,
    html: generateEmailHtml({
      title: 'API Degradation Alert',
      previewText: `API degradation in ${data.projectName}`,
      sections,
      action: { label: 'View API Insights', url: insightsLink },
      projectName: data.projectName,
      projectUrl: `${baseUrl}/dashboard/settings/${data.projectId}`,
      alertType: 'api_degradation',
      metaBadges,
      timestamp: data.detectedAt || new Date()
    })
  });
}
