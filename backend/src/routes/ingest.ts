import { Router } from 'express';
import ingestUploadsRouter from './ingestUploads.js';
import ingestLifecycleRouter from './ingestLifecycle.js';
import ingestDeviceAuthRouter from './ingestDeviceAuth.js';
import ingestFaultsRouter from './ingestFaults.js';

const router = Router();

router.use(ingestUploadsRouter);
router.use(ingestLifecycleRouter);
router.use(ingestDeviceAuthRouter);
router.use(ingestFaultsRouter);

export default router;
