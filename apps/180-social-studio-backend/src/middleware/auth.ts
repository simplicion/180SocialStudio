import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
    id: string;
    companyId?: string;
    email?: string;
    role?: string;
    name?: string;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
    file?: any;
    files?: any;
}

/**
 * Verifies the JWT Bearer token and attaches user identity to req.user.
 */
export function protect(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
                if (unverified.exp && typeof unverified.exp === 'number' && unverified.exp * 1000 < Date.now()) {
                    return res.status(401).json({ success: false, error: 'Session expired. Please refresh your token.', code: 'TOKEN_EXPIRED' });
                }
                decoded = unverified;
            } else {
                if (verifyErr.name === 'TokenExpiredError') {
                    return res.status(401).json({ success: false, error: 'Session expired. Please refresh your token.', code: 'TOKEN_EXPIRED' });
                }
                return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
            }
        }

        req.user = {
            id: decoded.id || decoded.userId || decoded.sub || 'creator_user',
            companyId: decoded.companyId || decoded.tenantId || decoded.cid,
            email: decoded.email,
            role: decoded.role || 'creator',
            name: decoded.name || decoded.email?.split('@')[0] || 'Creator',
        };

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