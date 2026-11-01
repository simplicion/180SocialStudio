import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env
// Load environment variables from .env
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { protect, AuthenticatedRequest } from './middleware/auth';
import authRoutes from './routes/auth.routes';
import filesRoutes from './routes/files.routes';

// Import existing social media & media editor routers from workspace
const socialMediaRoutes = require('./api/v1/social-media/index').default;
const mediaEditorRoutes = require('./api/v1/media-editor/media-editor.routes').default;
const { oauthCallbackRouter } = require('./api/v1/social-media/accounts/social-account.routes');
const { metaWebhookRouter } = require('./api/v1/social-media/webhooks/meta-webhook.routes');
const { socialBillingWebhookHandler } = require('./api/v1/social-media/billing/social-billing.routes');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', true);

// Security & Performance
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());

// CORS configuration for mobile and web studios
const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((u) => u.trim())
    : ['http://localhost:3000', 'http://localhost:3002', 'http://10.0.2.2:4007'];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
                return callback(null, true);
            }
            return callback(null, true); // Allow native mobile clients
        },
        credentials: true,
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-company-id',
            'x-workspace-id',
            'x-requested-with',
            'Accept',
            'Origin',
            'Range',
            'x-device-token',
            'idempotency-key',
            'Idempotency-Key',
            'x-client-platform',
            'x-app-version',
        ],
        exposedHeaders: ['Content-Range', 'X-Content-Range', 'Content-Disposition'],
    })
);

// Body Parsing
app.use(
    express.json({
        limit: '50mb',
        verify: (req: any, res, buf) => {
            req.rawBody = buf;
        },
    })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use('/public', express.static(path.resolve(__dirname, '../public')));
app.use('/logo', express.static(path.resolve(__dirname, '../public/logo')));

// Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const ip = req.ip || req.socket?.remoteAddress || '';
        return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    },
});
app.use(globalLimiter);

// ─── Health Checks ─────────────────────────────────────────────────────────────
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        service: '180-social-studio-backend',
        timestamp: new Date().toISOString(),
    });
});

app.get('/', (req: Request, res: Response) => {
    res.json({
        service: '180 Social Studio Dedicated API',
        status: 'online',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
    });
});

// ─── Public OAuth & Webhook Handlers ──────────────────────────────────────────
app.use('/v1/social-media/accounts/oauth', oauthCallbackRouter);
app.use('/api/v1/social-media/accounts/oauth', oauthCallbackRouter);

app.use('/v1/social-media/webhooks/meta', metaWebhookRouter);
app.use('/api/v1/social-media/webhooks/meta', metaWebhookRouter);

app.post('/v1/social-media/billing/webhook', socialBillingWebhookHandler);
app.post('/api/v1/social-media/billing/webhook', socialBillingWebhookHandler);

// ─── Creator Authentication & Identity ─────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/oauth', authRoutes);
app.use('/oauth', authRoutes);
app.use('/api/v1/identity/oauth', authRoutes);
app.use('/api/v1/auth', authRoutes);

// ─── Media Storage & File Uploads ─────────────────────────────────────────────
app.use('/api/files', filesRoutes);
app.use('/files', filesRoutes);

// ─── Social Media Domain Routes ───────────────────────────────────────────────
// Mount protected social media endpoints
app.use('/api/v1/social-media', protect, socialMediaRoutes);
app.use('/v1/social-media', protect, socialMediaRoutes);
app.use('/social-media', protect, socialMediaRoutes);

// ─── Media Editor & Studio Engine (Transcriptions, Captions, AI Director) ─────
app.use('/api/v1/media-editor', protect, mediaEditorRoutes);
app.use('/v1/media-editor', protect, mediaEditorRoutes);
app.use('/media-editor', protect, mediaEditorRoutes);

// ─── Creator Feature Flags & Billing Compatibility ────────────────────────────
app.get('/api/feature-flags', (req: Request, res: Response) => {
    res.json({
        socialMedia: true,
        mediaStudio: true,
        aiDirector: true,
        unlimitedPublishing: true,
    });
});

app.get('/api/billing', (req: Request, res: Response) => {
    res.json({
        status: 'active',
        plan: 'pro_creator',
        canAccess: true,
    });
});

// Mock task/user endpoints for mobile app compatibility
app.get('/api/tasks', (req: Request, res: Response) => res.json({ tasks: [] }));
app.post('/api/tasks', (req: Request, res: Response) => res.json({ task: req.body }));
app.get('/api/users', (req: Request, res: Response) => res.json({ users: [] }));
app.get('/api/clients', (req: Request, res: Response) => res.json({ clients: [] }));
app.post('/api/desktop/devices/register', (req: Request, res: Response) => res.json({ success: true, deviceId: 'mobile_' + Date.now() }));
app.get('/api/desktop/devices', (req: Request, res: Response) => res.json({ devices: [] }));
app.put('/api/desktop/devices/:id/push-token', (req: Request, res: Response) => res.json({ success: true }));

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[SocialStudioBackend Error]:', err);
    res.status(err.status || err.statusCode || 500).json({
        success: false,
        code: err.code || 'INTERNAL_ERROR',
        error: err.message || 'An unexpected server error occurred',
    });
});

app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.method} ${req.url} not found`,
    });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.SOCIAL_STUDIO_PORT || process.env.PORT || 4007;

server.listen(PORT, () => {
    console.log(`🚀 180 Social Studio Dedicated Backend running on port ${PORT}`);
    console.log(`📡 Base URL: http://localhost:${PORT}`);
    console.log(`🔗 Health Check: http://localhost:${PORT}/health`);
});

export default app;
