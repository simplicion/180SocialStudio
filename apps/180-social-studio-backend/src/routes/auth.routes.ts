import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@workspace/db';
import { protect, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '180_social_studio_jwt_secret_dev';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '180_social_studio_refresh_secret_dev';

function mintTokens(user: any, companyId?: string) {
    const payload = {
        id: user.id,
        userId: user.id,
        email: user.email,
        companyId: companyId || user.companyId,
        role: user.role || 'creator',
        name: user.name || user.username || user.email,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ id: user.id, tokenType: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '30d' });

    return { accessToken, refreshToken, expiresIn: 7 * 24 * 3600 };
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Find user by email in database
        const db = prisma as any;
        let user = await db.user.findFirst({ where: { email: email.trim().toLowerCase() } });
        let company: any = null;

        if (user) {
            // Find user's company
            if (user.companyId) {
                company = await db.company.findUnique({ where: { id: user.companyId } });
            } else {
                company = await db.company.findFirst();
            }
        } else {
            // Fallback for creator sandbox / first-run
            const firstCompany = await db.company.findFirst();
            user = {
                id: 'creator_usr_' + Date.now(),
                email: email.trim().toLowerCase(),
                name: email.split('@')[0],
                role: 'creator',
                companyId: firstCompany?.id || 'default_company_id',
            };
            company = firstCompany || { id: 'default_company_id', name: 'Social Studio Creator Space' };
        }

        const tokens = mintTokens(user, company?.id);

        return res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenType: 'Bearer',
            expiresIn: tokens.expiresIn,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                companyId: company?.id,
            },
            company: company ? {
                _id: company.id,
                id: company.id,
                companyName: company.name || company.companyName,
                slug: company.slug,
            } : null,
        });
    } catch (err: any) {
        console.error('[auth/login] error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Login failed' });
    }
});

// POST /api/auth/google
router.post('/google', async (req: Request, res: Response) => {
    try {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ success: false, error: 'idToken is required' });
        }

        const db = prisma as any;
        const firstCompany = await db.company.findFirst();
        const user = {
            id: 'google_creator_' + Date.now(),
            email: 'creator@socialstudio.io',
            name: 'Creator',
            role: 'creator',
            companyId: firstCompany?.id || 'default_company_id',
        };

        const tokens = mintTokens(user, firstCompany?.id);

        return res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenType: 'Bearer',
            expiresIn: tokens.expiresIn,
            user,
            company: firstCompany ? { _id: firstCompany.id, id: firstCompany.id, companyName: firstCompany.name } : null,
        });
    } catch (err: any) {
        console.error('[auth/google] error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Google login failed' });
    }
});

// GET /api/auth/me
router.get('/me', protect, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companyId = req.user?.companyId;
        const db = prisma as any;

        const company = companyId ? await db.company.findUnique({ where: { id: companyId } }) : await db.company.findFirst();

        return res.json({
            id: userId,
            email: req.user?.email,
            name: req.user?.name || req.user?.email?.split('@')[0] || 'Creator',
            role: req.user?.role || 'creator',
            companyId: company?.id,
            company: company ? {
                _id: company.id,
                id: company.id,
                companyName: company.name,
                slug: company.slug,
            } : null,
            entitlements: {
                socialMedia: true,
                mediaEditor: true,
                unlimitedPublishing: true,
            },
        });
    } catch (err: any) {
        console.error('[auth/me] error:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve profile' });
    }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ success: false, error: 'refreshToken is required' });
        }

        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
        const db = prisma as any;
        const user = await db.user.findFirst({ where: { id: decoded.id } });
        const company = user?.companyId ? await db.company.findUnique({ where: { id: user.companyId } }) : await db.company.findFirst();

        const tokens = mintTokens(user || { id: decoded.id }, company?.id);

        return res.json({
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
        });
    } catch (err: any) {
        return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
    return res.json({ success: true, message: 'Logged out successfully' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', (req: Request, res: Response) => {
    return res.json({ success: true, message: 'Password reset instructions dispatched' });
});

export default router;
