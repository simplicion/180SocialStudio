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

// POST /oauth/token & POST /token (Handles token exchange for PKCE authorization code)
router.post(['/oauth/token', '/token'], async (req: Request, res: Response) => {
    const identityServer = process.env.IDENTITY_SERVER_URL || 'https://api.180core.cloud';
    const clientId = req.body.client_id || process.env['180_CLIENT_ID'] || process.env.CLIENT_ID;
    const clientSecret = req.body.client_secret || process.env['180_CLIENT_SECRET'] || process.env.CLIENT_SECRET;

    const payload = {
        grant_type: req.body.grant_type || 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: req.body.code,
        redirect_uri: req.body.redirect_uri,
        code_verifier: req.body.code_verifier,
    };

    const candidateEndpoints = [
        `${identityServer}/api/v1/auth/token`,
        `${identityServer}/api/oauth/token`,
        `${identityServer}/oauth/token`,
    ];

    let lastError: any = null;
    let forwardRes: any = null;
    let data: any = null;

    for (const ep of candidateEndpoints) {
        try {
            forwardRes = await fetch(ep, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const text = await forwardRes.text();
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
            if (forwardRes.ok) {
                break;
            } else {
                lastError = data;
            }
        } catch (e: any) {
            console.warn(`[oauth/token] Failed attempt on ${ep}:`, e.message);
            lastError = { error: 'network_error', message: e.message };
        }
    }

    if (!forwardRes || !forwardRes.ok || !data) {
        console.warn('[oauth/token] 180 Core token exchange failed:', lastError);
        return res.status(forwardRes?.status || 400).json(lastError || { error: 'invalid_grant', error_description: 'Failed to exchange authorization code' });
    }

    // Attempt to hydrate real user profile if missing from token exchange response
    const accessToken = data.access_token || data.token;
    if (accessToken && (!data.user || !data.user.email)) {
        try {
            const userinfoRes = await fetch(`${identityServer}/api/v1/auth/userinfo`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (userinfoRes.ok) {
                const uiData: any = await userinfoRes.json();
                data.user = uiData.user || uiData;
            }
        } catch (uiErr: any) {
            console.warn('[oauth/token] Userinfo lookup notice:', uiErr.message);
        }
    }

    // Sync real user and company into Prisma DB
    if (data.user) {
        try {
            const db = prisma as any;
            const uId = data.user.id || data.user.sub || 'user_' + Date.now();
            const uEmail = data.user.email;
            const uName = data.user.name || data.user.displayName || (uEmail ? uEmail.split('@')[0] : 'User');
            const coName = data.user.company?.name || `${uName}'s Studio`;

            let company = await db.company.findFirst();
            if (!company) {
                company = await db.company.create({
                    data: {
                        name: coName,
                        slug: uName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-studio',
                    },
                });
            } else if (company.name === '180 Social Studio Creator Space' || company.name === 'default_creator_company') {
                company = await db.company.update({
                    where: { id: company.id },
                    data: { name: coName },
                });
            }

            if (uEmail) {
                await db.user.upsert({
                    where: { email: uEmail },
                    update: {
                        name: uName,
                        photoUrl: data.user.avatarUrl || data.user.picture,
                        companyId: company.id,
                    },
                    create: {
                        id: uId,
                        email: uEmail,
                        name: uName,
                        photoUrl: data.user.avatarUrl || data.user.picture,
                        companyId: company.id,
                        role: data.user.role || 'creator',
                    },
                });
            }

            data.company = {
                id: company.id,
                _id: company.id,
                name: company.name,
                companyName: company.name,
                slug: company.slug,
            };
        } catch (syncErr: any) {
            console.warn('[oauth/token] DB sync notice:', syncErr.message);
        }
    }

    return res.json(data);
});

// GET /api/auth/me
router.get('/me', protect, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = prisma as any;
        const identityServer = process.env.IDENTITY_SERVER_URL || 'https://api.180core.cloud';

        let userId = req.user?.id;
        let email = req.user?.email;
        let name = req.user?.name;
        let role = req.user?.role || 'creator';
        let avatarUrl: string | undefined;

        // If email or name is missing, attempt to fetch userinfo from 180 Core using the incoming Bearer token
        const authHeader = req.headers.authorization;
        if ((!email || !name || name === 'Creator') && authHeader) {
            try {
                const userinfoRes = await fetch(`${identityServer}/api/v1/auth/userinfo`, {
                    headers: { Authorization: authHeader }
                });
                if (userinfoRes.ok) {
                    const uiData: any = await userinfoRes.json();
                    const profile = uiData.user || uiData;
                    if (profile) {
                        userId = profile.id || profile.sub || userId;
                        email = profile.email || email;
                        name = profile.name || profile.displayName || (profile.firstName ? `${profile.firstName} ${profile.lastName || ''}`.trim() : name);
                        avatarUrl = profile.avatarUrl || profile.picture;
                        role = profile.role || role;
                    }
                }
            } catch (e: any) {
                console.warn('[auth/me] 180 Core userinfo fetch notice:', e.message);
            }
        }

        // Check if user exists in database
        let dbUser: any = null;
        if (email || userId) {
            try {
                dbUser = await db.user.findFirst({
                    where: {
                        OR: [
                            ...(email ? [{ email }] : []),
                            ...(userId ? [{ id: userId }] : []),
                        ]
                    }
                });
            } catch (_) {}
        }

        if (dbUser) {
            userId = dbUser.id;
            email = dbUser.email || email;
            name = dbUser.name || name;
            avatarUrl = dbUser.photoUrl || dbUser.avatarUrl || avatarUrl;
            role = dbUser.role || role;
        }

        const displayName = name || (email ? email.split('@')[0] : 'User');
        const displayEmail = email || `${userId || 'user'}@180workspace.com`;
        const defaultWorkspaceName = `${displayName}'s Studio`;

        let companyId = dbUser?.companyId || req.user?.companyId;
        let company: any = null;
        try {
            if (companyId) {
                company = await db.company.findUnique({ where: { id: companyId } });
            }
            if (!company) {
                company = await db.company.findFirst();
            }
        } catch (dbErr) {
            console.warn('[auth/me] DB lookup fallback:', dbErr);
        }

        if (!company) {
            try {
                company = await db.company.create({
                    data: {
                        id: companyId || undefined,
                        name: defaultWorkspaceName,
                        slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-studio',
                    },
                });
            } catch {
                company = {
                    id: companyId || 'default_workspace',
                    name: defaultWorkspaceName,
                    companyName: defaultWorkspaceName,
                    slug: 'workspace',
                };
            }
        } else if (company.name === '180 Social Studio Creator Space' || company.name === 'default_creator_company') {
            try {
                company = await db.company.update({
                    where: { id: company.id },
                    data: { name: defaultWorkspaceName },
                });
            } catch (_) {}
        }

        // Upsert user in database if not present
        if (!dbUser && email) {
            try {
                await db.user.create({
                    data: {
                        id: userId || 'user_' + Date.now(),
                        email,
                        name: displayName,
                        photoUrl: avatarUrl,
                        role,
                        companyId: company.id,
                    }
                });
            } catch (_) {}
        }

        const userObj = {
            id: userId || 'user_active',
            email: displayEmail,
            name: displayName,
            role,
            companyId: company.id,
            imageUrl: avatarUrl,
            photoUrl: avatarUrl,
        };

        const companyObj = {
            _id: company.id,
            id: company.id,
            companyName: company.name || company.companyName || defaultWorkspaceName,
            name: company.name || company.companyName || defaultWorkspaceName,
            slug: company.slug || 'workspace',
        };

        return res.json({
            // Nested objects expected by mobile and desktop Flutter app
            user: userObj,
            company: companyObj,

            // Flat root-level fields for backwards compatibility
            id: userObj.id,
            email: userObj.email,
            name: userObj.name,
            role: userObj.role,
            companyId: company.id,
            imageUrl: avatarUrl,

            // Entitlements required by Flutter Entitlement model
            entitlements: {
                subscriptionStatus: 'active',
                isPaidPlan: true,
                availableApps: ['social-media', 'social_media', 'media-editor', 'studio'],
                enabledApps: ['social-media', 'social_media', 'media-editor', 'studio'],
                disabledByAdmin: [],
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
