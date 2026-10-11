import { Request, Response } from 'express';
import { ContentCalendarService } from '@workspace/social-media';
import { companyOfUser, sendRouteError } from '../route-errors';

// Tenant = the authenticated user's company. The service scopes every lookup/write by (id, companyId) and throws a
// typed 404 for ids of another company; unexpected errors become a generic 500 (see route-errors.ts).

const requireCompany = (req: Request, res: Response): string | null => {
    const companyId = companyOfUser(req);
    if (!companyId) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return null;
    }
    return companyId;
};

export const listCalendars = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim() ? req.query.projectId.trim() : undefined;
        const calendars = await ContentCalendarService.listCalendars(limit, offset, companyId, projectId);
        res.json({ calendars });
    } catch (err) { sendRouteError(res, err, 'content-calendar.list'); }
};

export const getCalendar = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const result = await ContentCalendarService.getCalendar(String(req.params.id), companyId);
        res.json(result);
    } catch (err) { sendRouteError(res, err, 'content-calendar.get'); }
};

export const createCalendar = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const result = await ContentCalendarService.createCalendar(req.body, (req as any).user, companyId);
        res.status(201).json(result);
    } catch (err) { sendRouteError(res, err, 'content-calendar.create'); }
};

export const updateCalendar = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const calendar = await ContentCalendarService.updateCalendar(String(req.params.id), req.body, companyId);
        res.json({ calendar });
    } catch (err) { sendRouteError(res, err, 'content-calendar.update'); }
};

export const deleteCalendar = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const result = await ContentCalendarService.deleteCalendar(String(req.params.id), companyId);
        res.json(result);
    } catch (err) { sendRouteError(res, err, 'content-calendar.delete'); }
};

export const getCalendarPieces = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const pieces = await ContentCalendarService.getCalendarPieces(String(req.params.id), companyId);
        res.json({ pieces });
    } catch (err) { sendRouteError(res, err, 'content-calendar.pieces'); }
};

export const updateCalendarPiece = async (req: Request, res: Response) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    try {
        const piece = await ContentCalendarService.updateCalendarPiece(String(req.params.pieceId), req.body, companyId, String(req.params.id));
        res.json({ piece });
    } catch (err) { sendRouteError(res, err, 'content-calendar.update-piece'); }
};
