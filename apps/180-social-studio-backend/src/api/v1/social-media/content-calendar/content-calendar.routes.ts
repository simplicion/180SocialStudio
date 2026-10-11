import { Router } from 'express';
import * as contentCalendarController from './content-calendar.controller';

const router = Router();

router.post('/create', contentCalendarController.createCalendar);
router.get('/', contentCalendarController.listCalendars);
router.get('/:id', contentCalendarController.getCalendar);
router.put('/:id', contentCalendarController.updateCalendar);
router.delete('/:id', contentCalendarController.deleteCalendar);

router.get('/:id/pieces', contentCalendarController.getCalendarPieces);
router.put('/:id/pieces/:pieceId', contentCalendarController.updateCalendarPiece);

export default router;
