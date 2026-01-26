/**
 * Routes Index
 * 
 * Register all API routes
 */

import { Router } from 'express';
import authRoutes from './auth.js';
import projectsRoutes from './projects.js';
import teamsRoutes from './teams.js';
import billingRoutes from './billing.js';
import stripeBillingRoutes from './stripeBilling.js';
import sessionsRoutes from './sessions.js';
import ingestRoutes from './ingest.js';
import apiKeysRoutes from './apiKeys.js';

import sdkRoutes from './sdk.js';
import devicesRoutes from './devices.js';
import crashesRoutes from './crashes.js';
import anrsRoutes from './anrs.js';
import errorsRoutes from './errors.js';
import issuesRoutes from './issues.js';
import analyticsRoutes from './analytics.js';
import dashboardInsightsRoutes from './dashboardInsights.js';
import workspaceRoutes from './uiWorkspace.js';
import demoRoutes from './demo.js';
import alertsRoutes from './alerts.js';

const router = Router();

// Auth routes
router.use('/auth', authRoutes);

// SDK initialization routes (public, no auth required)
router.use('/sdk', sdkRoutes);

// Demo routes (public, no auth required)
router.use('/demo', demoRoutes);

// Device authentication routes (new ECDSA-based auth)
router.use('/devices', devicesRoutes);

// Dashboard routes
router.use('/projects', projectsRoutes);
router.use('/teams', teamsRoutes);
router.use('/teams', billingRoutes); // /api/teams/:teamId/billing/*
router.use('/teams', stripeBillingRoutes); // /api/teams/:teamId/billing/stripe/*
router.use('/billing', billingRoutes); // /api/billing/cap (user-level global cap)
router.use('/billing', stripeBillingRoutes); // /api/billing/free-tier
router.use('/sessions', sessionsRoutes);
router.use('/session', sessionsRoutes);
router.use('/dashboard-stats', sessionsRoutes); // Stats endpoint

// Analytics routes (pre-computed daily stats)
router.use('/analytics', analyticsRoutes);

// Dashboard insights routes (actionable data)
router.use('/insights', dashboardInsightsRoutes);

// UI workspace state persistence
router.use('/', workspaceRoutes);

// API management
router.use('/', apiKeysRoutes); // /api/projects/:id/api-keys and /api/api-keys/:id

router.use('/', crashesRoutes); // /api/projects/:id/crashes
router.use('/', anrsRoutes); // /api/projects/:id/anrs
router.use('/', errorsRoutes); // /api/projects/:id/errors
router.use('/', issuesRoutes); // /api/issues
router.use('/', alertsRoutes); // /api/projects/:projectId/alert-settings, /alert-recipients

// SDK ingest routes
router.use('/ingest', ingestRoutes);

export default router;

