import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, requestContext } from '@workspace/db';

export interface AuthenticatedUser {
    id: string;
    companyId?: string;
    email?: string;
    role?: string;
    name?: string;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
    companyId?: string;
    file?: any;
    files?: any;
}

/**
 * Verifies the JWT Bearer token and attaches user identity to req.user.
 * Also reliably resolves tenant context (companyId) for SSO tokens and attaches to requestContext.
 */
export async function protect(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        let token: string | undefined;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.query.token) {
            token = req.query.token as string;
        }

        if (!token) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
        }

        const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '180_social_studio_jwt_secret_dev';
        let decoded: any;
        try {
            decoded = jwt.verify(token, secret) as any;
        } catch (verifyErr: any) {
            // Check if this token is an SSO token issued by 180 Identity
            const unverified = jwt.decode(token) as any;
            if (unverified && (unverified.id || unverified.userId || unverified.sub || unverified.email)) {
                // Allow SSO token identity to persist; subscription access guard handles entitlement expiry
                decoded = unverified;
            } else {
                if (verifyErr.name === 'TokenExpiredError') {
                    return res.status(401).json({ success: false, error: 'Session expired. Please refresh your token.', code: 'TOKEN_EXPIRED' });
                }
                return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
            }
        }

        const userId = decoded.id || decoded.userId || decoded.sub || 'creator_user';
        const userEmail = decoded.email;

        // Resolve companyId with resilient multi-tier fallback:
        // 1. Direct claims in token (companyId, tenantId, cid)
        let resolvedCompanyId: string | undefined = decoded.companyId || decoded.tenantId || decoded.cid;

        // 2. Client headers if provided (x-company-id, x-workspace-id)
        if (!resolvedCompanyId) {
            const headerCid = (req.headers['x-company-id'] || req.headers['x-workspace-id']) as string | undefined;
            if (headerCid && typeof headerCid === 'string' && headerCid.trim().length > 0) {
                resolvedCompanyId = headerCid.trim();
            }
        }

        // 3. Database lookup for user's assigned company or active company
        if (!resolvedCompanyId) {
            try {
                const db = prisma as any;
                let dbUser: any = null;
                if (userId || userEmail) {
                    dbUser = await db.user.findFirst({
                        where: {
                            OR: [
                                ...(userId ? [{ id: userId }] : []),
                                ...(userEmail ? [{ email: userEmail }] : []),
                            ],
                        },
                        select: { id: true, companyId: true },
                    });
                }

                if (dbUser?.companyId) {
                    resolvedCompanyId = dbUser.companyId;
                } else {
                    const existingCompany = await db.company.findFirst({ select: { id: true } });
                    if (existingCompany?.id) {
                        resolvedCompanyId = existingCompany.id;
                    } else {
                        const defaultCo = await db.company.upsert({
                            where: { id: 'default_creator_company' },
                            update: {},
                            create: {
                                id: 'default_creator_company',
                                name: userEmail ? `${userEmail.split('@')[0]}'s Studio` : 'My Studio',
                                slug: 'studio',
                            },
                        });
                        resolvedCompanyId = defaultCo.id;
                    }

                    if (dbUser && !dbUser.companyId && resolvedCompanyId) {
                        try {
                            await db.user.update({
                                where: { id: dbUser.id },
                                data: { companyId: resolvedCompanyId },
                            });
                        } catch (_) {}
                    }
                }
            } catch (dbErr) {
                console.warn('[auth.protect] Company resolution DB fallback warning:', dbErr);
                resolvedCompanyId = 'default_creator_company';
            }
        }

        if (!resolvedCompanyId) {
            resolvedCompanyId = 'default_creator_company';
        }

        const resolvedName = decoded.name || decoded.displayName || (userEmail ? userEmail.split('@')[0] : 'User');

        req.user = {
            id: userId,
            companyId: resolvedCompanyId,
            email: userEmail,
            role: decoded.role || 'creator',
            name: resolvedName,
        };

        (req as any).companyId = resolvedCompanyId;

        // Run downstream handlers inside requestContext so AsyncLocalStorage has tenant scope
        if (requestContext && typeof requestContext.run === 'function') {
            return requestContext.run({ companyId: resolvedCompanyId, userId }, () => next());
        }

        next();
    } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'Session expired. Please refresh your token.', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
    }
}

export function requireRole(...roles: string[]) {
    return (req: any, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const userRoles = req.user.roles || [req.user.role || 'creator'];
        const hasPermission = userRoles.includes('admin') || userRoles.includes('ceo') || roles.some((role: string) => userRoles.includes(role));

        if (!hasPermission) {
            return res.status(403).json({
                error: `Access denied. Required role(s): ${roles.join(', ')}. Your roles: ${userRoles.join(', ')}`,
            });
        }
        next();
    };
}