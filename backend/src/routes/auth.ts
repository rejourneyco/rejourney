/**
 * Auth Routes
 * 
 * OTP-based authentication with OAuth support (future)
 */

import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { eq, gt, and, sql, desc } from 'drizzle-orm';
import { db, users, teams, teamMembers, otpTokens, userSessions, sessions, sessionMetrics, projects } from '../db/client.js';
import { logger } from '../logger.js';
import { config, isSelfHosted } from '../config.js';
import { validate, asyncHandler, ApiError, sessionAuth } from '../middleware/index.js';
import {
    otpSendRateLimiter,
    otpSendIpRateLimiter,
    otpVerifyRateLimiter,
    otpVerifyIpRateLimiter,
    oauthRateLimiter,
    writeApiRateLimiter,
} from '../middleware/rateLimit.js';
import { sendOtpSchema, verifyOtpSchema } from '../validation/auth.js';
import { sendOtpEmail } from '../services/email.js';
import { createAuditLog } from '../services/auditLog.js';
import { UAParser } from 'ua-parser-js';
import { getSessionCookieOptions, getOAuthStateCookieOptions } from '../utils/cookies.js';
import { isDisposableEmail } from '../utils/disposableEmail.js';
import {
    enforceAccountCreationVelocity,
    enforceCredentialStuffingGuards,
    recordFailedAuthAttempt,
} from '../services/abuseDetection.js';

const router = Router();

// OTP settings
const OTP_EXPIRY_MINUTES = 10;
const SESSION_EXPIRY_DAYS = 30;

/**
 * Verify Cloudflare Turnstile token
 */
async function verifyTurnstileToken(token: string, remoteIp?: string): Promise<boolean> {
    const secretKey = config.TURNSTILE_SECRET_KEY;

    // If no secret key configured, skip verification (for development/self-hosted)
    if (!secretKey) {
        logger.warn('Turnstile secret key not configured, skipping verification');
        return true;
    }

    try {
        const params = new URLSearchParams({
            secret: secretKey,
            response: token,
            ...(remoteIp ? { remoteip: remoteIp } : {}),
        });
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        const result = await response.json() as { success: boolean; 'error-codes'?: string[] };

        if (!result.success) {
            logger.warn({ errorCodes: result['error-codes'] }, 'Turnstile verification failed');
            return false;
        }

        return true;
    } catch (err) {
        logger.error({ err }, 'Turnstile verification error');
        return false;
    }
}

/**
 * Send OTP email
 * POST /api/auth/otp/send
 */
router.post(
    '/otp/send',
    otpSendIpRateLimiter,
    otpSendRateLimiter,
    validate(sendOtpSchema),
    asyncHandler(async (req, res) => {
        const { email, fingerprint, turnstileToken } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        const accountFingerprint =
            fingerprint?.browserFingerprint ||
            [fingerprint?.timezone, fingerprint?.platform, fingerprint?.screenResolution]
                .filter(Boolean)
                .join('|') ||
            null;

        // Verify Turnstile token (if configured)
        if (config.TURNSTILE_SECRET_KEY) {
            if (!turnstileToken) {
                throw new ApiError('Turnstile verification required', 400);
            }

            const isValid = await verifyTurnstileToken(turnstileToken, req.ip);
            if (!isValid) {
                throw new ApiError('Bot verification failed. Please try again.', 400);
            }
        }

        // Generate OTP code (10-character alphanumeric)
        // Exclude confusing characters: 0, O, I, 1
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = randomBytes(10);
        const code = Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
        const codeHash = createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        // Parse platform from user-agent
        const userAgent = req.headers['user-agent'] || '';
        const parser = new UAParser(userAgent);
        const parsedPlatform = `${parser.getOS().name || 'Unknown'} ${parser.getOS().version || ''} / ${parser.getBrowser().name || 'Unknown'}`.trim();

        // Find or create user
        let [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

        if (!user) {
            if (isDisposableEmail(normalizedEmail)) {
                throw ApiError.badRequest('Disposable email domains are not allowed. Please use a permanent email address.');
            }

            await enforceAccountCreationVelocity({
                ip: req.ip,
                fingerprint: accountFingerprint,
            });

            // Collect fingerprint data for new users
            [user] = await db.insert(users).values({
                email: normalizedEmail,
                authProvider: 'otp',
                // Fingerprinting data
                registrationIp: req.ip || null,
                registrationUserAgent: userAgent || null,
                registrationTimezone: fingerprint?.timezone || null,
                browserFingerprint: fingerprint?.browserFingerprint || null,
                screenResolution: fingerprint?.screenResolution || null,
                languagePreference: fingerprint?.language || req.headers['accept-language']?.split(',')[0] || null,
                registrationPlatform: fingerprint?.platform || parsedPlatform || null,
            }).returning();

            // Get free plan for new teams - no database reference needed
            // Teams start on free tier, Stripe subscription is created via billing flow

            // Create default team for new user
            const [team] = await db.insert(teams).values({
                ownerUserId: user.id,
                name: `${normalizedEmail.split('@')[0]}'s Team`,
                // No billingPlanId needed - teams start on free tier
            }).returning();

            // Add user as team owner
            await db.insert(teamMembers).values({
                teamId: team.id,
                userId: user.id,
                role: 'owner',
            });

            logger.info({ userId: user.id, email: normalizedEmail }, 'Created new user');
        }

        // Delete old OTP tokens for this email
        await db.delete(otpTokens).where(eq(otpTokens.email, normalizedEmail));

        // Create new OTP token
        await db.insert(otpTokens).values({
            userId: user.id,
            email: normalizedEmail,
            codeHash,
            expiresAt,
        });

        // Send email
        try {
            await sendOtpEmail(normalizedEmail, code);
            logger.info({ email: normalizedEmail }, 'OTP sent');
        } catch (err) {
            logger.error({ err, email: normalizedEmail }, 'Failed to send OTP email');
            // In development, log the code for testing and include it in response
            if (config.NODE_ENV === 'development') {
                logger.info({ code, email: normalizedEmail }, 'DEV: OTP code (email not sent)');
                // Return code in development mode for testing
                res.json({
                    success: true,
                    message: 'If an account exists, a verification code has been sent.',
                    devCode: code, // Only in development
                });
                return;
            }
            // In production, still return success to avoid revealing if email exists
            // but log the error for debugging
        }

        res.json({
            success: true,
            message: 'If an account exists, a verification code has been sent.',
        });
    })
);

/**
 * Verify OTP
 * POST /api/auth/otp/verify
 */
router.post(
    '/otp/verify',
    otpVerifyIpRateLimiter,
    otpVerifyRateLimiter,
    validate(verifyOtpSchema),
    asyncHandler(async (req, res) => {
        const { email, code, fingerprint } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        const codeHash = createHash('sha256').update(code).digest('hex');

        await enforceCredentialStuffingGuards({
            email: normalizedEmail,
            ip: req.ip,
        });

        // Find OTP token with user
        const [otpToken] = await db
            .select({
                id: otpTokens.id,
                codeHash: otpTokens.codeHash,
                attempts: otpTokens.attempts,
                user: {
                    id: users.id,
                    email: users.email,
                    displayName: users.displayName,
                    registrationIp: users.registrationIp,
                },
            })
            .from(otpTokens)
            .leftJoin(users, eq(otpTokens.userId, users.id))
            .where(
                and(
                    eq(otpTokens.email, normalizedEmail),
                    gt(otpTokens.expiresAt, new Date())
                )
            )
            .limit(1);

        if (!otpToken) {
            await recordFailedAuthAttempt({ email: normalizedEmail, ip: req.ip });
            throw ApiError.badRequest('Invalid or expired code');
        }

        // Check attempts
        if (otpToken.attempts >= 5) {
            await db.delete(otpTokens).where(eq(otpTokens.id, otpToken.id));
            await recordFailedAuthAttempt({ email: normalizedEmail, ip: req.ip });
            throw ApiError.tooManyRequests('Too many attempts. Please request a new code.');
        }

        // Verify code
        if (otpToken.codeHash !== codeHash) {
            await db.update(otpTokens)
                .set({ attempts: sql`${otpTokens.attempts} + 1` })
                .where(eq(otpTokens.id, otpToken.id));
            await recordFailedAuthAttempt({ email: normalizedEmail, ip: req.ip });
            throw ApiError.badRequest('Invalid code');
        }

        // Delete used OTP token
        await db.delete(otpTokens).where(eq(otpTokens.id, otpToken.id));

        // Backfill fingerprint data for users who don't have it yet
        if (fingerprint && !otpToken.user!.registrationIp) {
            const userAgent = req.headers['user-agent'] || '';
            const parser = new UAParser(userAgent);
            const parsedPlatform = `${parser.getOS().name || 'Unknown'} ${parser.getOS().version || ''} / ${parser.getBrowser().name || 'Unknown'}`.trim();

            await db.update(users)
                .set({
                    registrationIp: req.ip || null,
                    registrationUserAgent: userAgent || null,
                    registrationTimezone: fingerprint.timezone || null,
                    browserFingerprint: fingerprint.browserFingerprint || null,
                    screenResolution: fingerprint.screenResolution || null,
                    languagePreference: fingerprint.language || req.headers['accept-language']?.split(',')[0] || null,
                    registrationPlatform: fingerprint.platform || parsedPlatform || null,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, otpToken.user!.id));

            logger.info({ userId: otpToken.user!.id }, 'Backfilled fingerprint data for existing user');
        }

        // Create session
        const sessionToken = randomBytes(32).toString('hex');
        const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        await db.insert(userSessions).values({
            userId: otpToken.user!.id,
            token: sessionToken,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
            expiresAt: sessionExpiresAt,
        });

        // Set session cookie
        res.cookie('session', sessionToken, getSessionCookieOptions(req, SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000));

        logger.info({ userId: otpToken.user!.id, email: normalizedEmail }, 'User logged in');

        // Audit log for successful login
        await createAuditLog({
            userId: otpToken.user!.id,
            action: 'login_success',
            targetType: 'user',
            targetId: otpToken.user!.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        }, req);

        res.json({
            success: true,
            user: {
                id: otpToken.user!.id,
                email: otpToken.user!.email,
                displayName: otpToken.user!.displayName,
            },
            token: sessionToken,
        });
    })
);

/**
 * Get current user
 * GET /api/auth/me
 */
router.get(
    '/me',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                displayName: users.displayName,
                avatarUrl: users.avatarUrl,
                roles: users.roles,
                createdAt: users.createdAt,
            })
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1);

        if (!user) {
            throw ApiError.notFound('User not found');
        }

        // Get user's teams with team info
        const memberships = await db
            .select({
                role: teamMembers.role,
                team: {
                    id: teams.id,
                    name: teams.name,
                    stripePriceId: teams.stripePriceId,
                    stripeSubscriptionId: teams.stripeSubscriptionId,
                },
            })
            .from(teamMembers)
            .innerJoin(teams, eq(teamMembers.teamId, teams.id))
            .where(eq(teamMembers.userId, user.id));

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.displayName || null,
                displayName: user.displayName || null,
                avatarUrl: user.avatarUrl,
                roles: user.roles,
                // OTP login means email is verified
                emailVerified: true,
                // Usage stats - defaults for now, can be computed from billing tables later
                minutesUsedThisMonth: 0,
                totalMinutesUsed: 0,
                storageBytesUsed: 0,
                storageLimitBytes: 10 * 1024 * 1024 * 1024, // 10GB default
                // Self-hosted flag
                isSelfHosted,
                // Properly formatted date
                createdAt: user.createdAt.toISOString(),
                // User's teams
                teams: memberships.map((tm) => ({
                    ...tm.team,
                    role: tm.role,
                })),
            },
        });
    })
);

/**
 * Logout
 * POST /api/auth/logout
 */
router.post(
    '/logout',
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const token = req.cookies?.session || req.headers.authorization?.replace('Bearer ', '');

        if (token) {
            await db.delete(userSessions).where(eq(userSessions.token, token));
        }

        res.clearCookie('session');
        res.json({ success: true });
    })
);

/**
 * Available OAuth providers (for future)
 * GET /api/auth/providers
 */
router.get('/providers', (_req, res) => {
    res.json({
        providers: [
            { id: 'otp', name: 'Email OTP', enabled: true },
            { id: 'github', name: 'GitHub', enabled: !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) },
        ],
    });
});

// =============================================================================
// GitHub OAuth Flow
// =============================================================================

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

/**
 * Initiate GitHub OAuth
 * GET /api/auth/github
 */
router.get('/github', oauthRateLimiter, (req, res) => {
    if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
        throw ApiError.badRequest('GitHub OAuth is not configured');
    }

    // Generate state for CSRF protection
    const state = randomBytes(16).toString('hex');

    // Store state in cookie for verification
    res.cookie('oauth_state', state, getOAuthStateCookieOptions(req));

    const callbackUrl = config.OAUTH_REDIRECT_BASE
        ? `${config.OAUTH_REDIRECT_BASE}/api/auth/github/callback`
        : config.PUBLIC_API_URL
            ? `${config.PUBLIC_API_URL}/api/auth/github/callback`
            : `${req.protocol}://${req.get('host')}/api/auth/github/callback`;

    const params = new URLSearchParams({
        client_id: config.GITHUB_CLIENT_ID,
        redirect_uri: callbackUrl,
        scope: 'user:email read:user',
        state,
    });

    res.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
});

/**
 * GitHub OAuth Callback
 * GET /api/auth/github/callback
 */
router.get(
    '/github/callback',
    oauthRateLimiter,
    asyncHandler(async (req, res) => {
        const { code, state } = req.query;
        const storedState = req.cookies?.oauth_state;

        // Clear state cookie
        res.clearCookie('oauth_state');

        // Validate state
        if (!state || state !== storedState) {
            logger.warn('GitHub OAuth: Invalid state parameter');
            const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
            return res.redirect(`${dashboardUrl}/login?error=invalid_state`);
        }

        if (!code || typeof code !== 'string') {
            logger.warn('GitHub OAuth: No code provided');
            const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
            return res.redirect(`${dashboardUrl}/login?error=no_code`);
        }

        if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
            const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
            return res.redirect(`${dashboardUrl}/login?error=not_configured`);
        }

        const callbackUrl = config.OAUTH_REDIRECT_BASE
            ? `${config.OAUTH_REDIRECT_BASE}/api/auth/github/callback`
            : config.PUBLIC_API_URL
                ? `${config.PUBLIC_API_URL}/api/auth/github/callback`
                : `${req.protocol}://${req.get('host')}/api/auth/github/callback`;

        try {
            // Exchange code for access token
            const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    client_id: config.GITHUB_CLIENT_ID,
                    client_secret: config.GITHUB_CLIENT_SECRET,
                    code,
                    redirect_uri: callbackUrl,
                }),
            });

            const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

            if (!tokenData.access_token) {
                const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
                logger.error({ error: tokenData.error }, 'GitHub OAuth: Failed to get access token');
                return res.redirect(`${dashboardUrl}/login?error=token_failed`);
            }

            // Get user info from GitHub
            const userResponse = await fetch(GITHUB_USER_URL, {
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            });

            const githubUser = await userResponse.json() as {
                id: number;
                login: string;
                name?: string;
                avatar_url?: string;
                email?: string;
            };

            // Get primary email from GitHub (may require separate API call)
            let primaryEmail = githubUser.email;

            if (!primaryEmail) {
                const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
                    headers: {
                        'Authorization': `Bearer ${tokenData.access_token}`,
                        'Accept': 'application/vnd.github.v3+json',
                    },
                });

                const emails = await emailsResponse.json() as Array<{
                    email: string;
                    primary: boolean;
                    verified: boolean;
                }>;

                // Find verified primary email
                const verifiedPrimary = emails.find(e => e.primary && e.verified);
                const verifiedAny = emails.find(e => e.verified);
                primaryEmail = verifiedPrimary?.email || verifiedAny?.email;
            }

            if (!primaryEmail) {
                const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
                logger.warn({ githubId: githubUser.id }, 'GitHub OAuth: No verified email found');
                return res.redirect(`${dashboardUrl}/login?error=no_email`);
            }

            const normalizedEmail = primaryEmail.toLowerCase().trim();
            const githubUserId = String(githubUser.id);

            // Check if user exists by GitHub provider ID
            let [existingUser] = await db
                .select()
                .from(users)
                .where(and(
                    eq(users.authProvider, 'github'),
                    eq(users.providerUserId, githubUserId)
                ))
                .limit(1);

            // If not found by provider ID, check by email
            if (!existingUser) {
                [existingUser] = await db
                    .select()
                    .from(users)
                    .where(eq(users.email, normalizedEmail))
                    .limit(1);

                if (existingUser) {
                    // Link GitHub to existing account
                    await db.update(users)
                        .set({
                            authProvider: 'github',
                            providerUserId: githubUserId,
                            displayName: existingUser.displayName || githubUser.name || githubUser.login,
                            avatarUrl: existingUser.avatarUrl || githubUser.avatar_url,
                            updatedAt: new Date(),
                        })
                        .where(eq(users.id, existingUser.id));

                    logger.info({ userId: existingUser.id, email: normalizedEmail }, 'Linked GitHub to existing user');
                }
            }

            // Create new user if not found
            if (!existingUser) {
                if (isDisposableEmail(normalizedEmail)) {
                    const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
                    logger.warn({ email: normalizedEmail }, 'GitHub OAuth rejected disposable email domain');
                    return res.redirect(`${dashboardUrl}/login?error=disposable_email`);
                }

                try {
                    await enforceAccountCreationVelocity({ ip: req.ip });
                } catch (err) {
                    if (err instanceof ApiError) {
                        const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
                        logger.warn({ ip: req.ip, email: normalizedEmail }, 'GitHub OAuth signup velocity check blocked');
                        return res.redirect(`${dashboardUrl}/login?error=signup_limited`);
                    }
                    throw err;
                }

                // Collect fingerprint data for new GitHub users
                const userAgent = req.headers['user-agent'] || '';
                const parser = new UAParser(userAgent);
                const parsedPlatform = `${parser.getOS().name || 'Unknown'} ${parser.getOS().version || ''} / ${parser.getBrowser().name || 'Unknown'}`.trim();

                [existingUser] = await db.insert(users).values({
                    email: normalizedEmail,
                    displayName: githubUser.name || githubUser.login,
                    avatarUrl: githubUser.avatar_url,
                    authProvider: 'github',
                    providerUserId: githubUserId,
                    // Fingerprinting data (no client-side fingerprint for OAuth redirects)
                    registrationIp: req.ip || null,
                    registrationUserAgent: userAgent || null,
                    languagePreference: req.headers['accept-language']?.split(',')[0] || null,
                    registrationPlatform: parsedPlatform || null,
                }).returning();

                // Teams start on free tier - Stripe subscription created via billing flow

                // Create default team for new user
                const [team] = await db.insert(teams).values({
                    ownerUserId: existingUser.id,
                    name: `${normalizedEmail.split('@')[0]}'s Team`,
                }).returning();

                // Add user as team owner
                await db.insert(teamMembers).values({
                    teamId: team.id,
                    userId: existingUser.id,
                    role: 'owner',
                });

                logger.info({ userId: existingUser.id, email: normalizedEmail }, 'Created new user via GitHub OAuth');
            }

            // Create session
            const sessionToken = randomBytes(32).toString('hex');
            const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

            await db.insert(userSessions).values({
                userId: existingUser.id,
                token: sessionToken,
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip,
                expiresAt: sessionExpiresAt,
            });

            // Set session cookie
            res.cookie('session', sessionToken, getSessionCookieOptions(req, SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000));

            logger.info({ userId: existingUser.id, email: normalizedEmail }, 'User logged in via GitHub');

            // Redirect to dashboard
            const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
            res.redirect(`${dashboardUrl}/dashboard/issues`);

        } catch (error) {
            const dashboardUrl = config.PUBLIC_DASHBOARD_URL || 'https://rejourney.co';
            logger.error({ error }, 'GitHub OAuth callback failed');
            return res.redirect(`${dashboardUrl}/login?error=oauth_failed`);
        }
    })
);

// =============================================================================
// GDPR Data Export
// =============================================================================

const DATA_EXPORT_COOLDOWN_DAYS = 30;

/**
 * Get data export status
 * GET /api/auth/export-data/status
 * 
 * Returns whether the user can export data and when the next export will be available.
 */
router.get(
    '/export-data/status',
    sessionAuth,
    asyncHandler(async (req, res) => {
        const [user] = await db
            .select({
                lastDataExportAt: users.lastDataExportAt,
            })
            .from(users)
            .where(eq(users.id, req.user!.id))
            .limit(1);

        if (!user) {
            throw ApiError.notFound('User not found');
        }

        const now = new Date();
        const cooldownMs = DATA_EXPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

        let canExport = true;
        let nextExportAt: string | null = null;
        let lastExportAt: string | null = null;

        if (user.lastDataExportAt) {
            lastExportAt = user.lastDataExportAt.toISOString();
            const nextExportDate = new Date(user.lastDataExportAt.getTime() + cooldownMs);

            if (nextExportDate > now) {
                canExport = false;
                nextExportAt = nextExportDate.toISOString();
            }
        }

        res.json({
            canExport,
            lastExportAt,
            nextExportAt,
            cooldownDays: DATA_EXPORT_COOLDOWN_DAYS,
        });
    })
);

/**
 * Export user data (GDPR Right to Data Portability)
 * POST /api/auth/export-data
 * 
 * Rate limited to once per 30 days for scalability.
 * Returns minimal data: account info + session summaries (no replay frames or raw events).
 */
router.post(
    '/export-data',
    sessionAuth,
    writeApiRateLimiter,
    asyncHandler(async (req, res) => {
        const userId = req.user!.id;

        // Get user with last export timestamp
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            throw ApiError.notFound('User not found');
        }

        // Check rate limit
        const now = new Date();
        const cooldownMs = DATA_EXPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

        if (user.lastDataExportAt) {
            const nextExportDate = new Date(user.lastDataExportAt.getTime() + cooldownMs);
            if (nextExportDate > now) {
                const daysRemaining = Math.ceil((nextExportDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
                throw ApiError.tooManyRequests(
                    `Data export is limited to once every ${DATA_EXPORT_COOLDOWN_DAYS} days. ` +
                    `You can export again in ${daysRemaining} day(s).`
                );
            }
        }

        // Get user's teams
        const userTeams = await db
            .select({
                role: teamMembers.role,
                teamName: teams.name,
                teamId: teams.id,
            })
            .from(teamMembers)
            .innerJoin(teams, eq(teamMembers.teamId, teams.id))
            .where(eq(teamMembers.userId, userId));

        // Get all project IDs for user's teams
        const teamIds = userTeams.map(t => t.teamId);

        // Get session summaries (minimal data for scalability)
        // Only include sessions from the last 90 days and limit to 10,000 sessions
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        let sessionSummaries: Array<{
            id: string;
            date: string;
            platform: string | null;
            durationSeconds: number | null;
            uxScore: number | null;
            projectName: string | null;
        }> = [];

        if (teamIds.length > 0) {
            // Get projects for teams
            const userProjects = await db
                .select({
                    id: projects.id,
                    name: projects.name,
                    teamId: projects.teamId,
                })
                .from(projects)
                .where(sql`${projects.teamId} IN ${teamIds}`);

            const projectIds = userProjects.map(p => p.id);
            const projectNameMap = new Map(userProjects.map(p => [p.id, p.name]));

            if (projectIds.length > 0) {
                const sessionsWithMetrics = await db
                    .select({
                        id: sessions.id,
                        startedAt: sessions.startedAt,
                        platform: sessions.platform,
                        durationSeconds: sessions.durationSeconds,
                        projectId: sessions.projectId,
                        uxScore: sessionMetrics.uxScore,
                    })
                    .from(sessions)
                    .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
                    .where(and(
                        sql`${sessions.projectId} IN ${projectIds}`,
                        gt(sessions.startedAt, ninetyDaysAgo)
                    ))
                    .orderBy(desc(sessions.startedAt))
                    .limit(10000);

                sessionSummaries = sessionsWithMetrics.map(s => ({
                    id: s.id,
                    date: s.startedAt.toISOString().split('T')[0],
                    platform: s.platform,
                    durationSeconds: s.durationSeconds,
                    uxScore: s.uxScore,
                    projectName: projectNameMap.get(s.projectId) || null,
                }));
            }
        }

        // Build export data
        const exportData = {
            exportedAt: now.toISOString(),
            account: {
                email: user.email,
                displayName: user.displayName,
                createdAt: user.createdAt.toISOString(),
                teams: userTeams.map(t => ({
                    name: t.teamName,
                    role: t.role,
                })),
            },
            sessionSummaries,
            metadata: {
                totalSessionsExported: sessionSummaries.length,
                exportPeriod: `Last 90 days (${ninetyDaysAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]})`,
                note: 'Replay screenshots and raw event data are not included for privacy and scalability reasons.',
            },
        };

        // Update last export timestamp
        await db.update(users)
            .set({ lastDataExportAt: now })
            .where(eq(users.id, userId));

        logger.info({ userId, sessionCount: sessionSummaries.length }, 'User exported data (GDPR)');

        // Return as JSON download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="rejourney-data-export-${now.toISOString().split('T')[0]}.json"`);
        res.json(exportData);
    })
);

export default router;
