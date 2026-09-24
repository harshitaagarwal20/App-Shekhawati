import { Router } from 'express';
import validate from '../middleware/validate.js';
import * as c from '../controllers/notification.controller.js';
import {
  markReadSchema,
  notificationListQuery,
  preferencesSchema,
} from '../validators/notification.validator.js';

/**
 * The caller's own notifications. No permission code guards these: being
 * signed in is the whole requirement, and every query is scoped to the
 * caller's user id in the service, so nobody can read another person's.
 */
const router = Router();

router.get('/', validate({ query: notificationListQuery }), c.list);
router.get('/unread-count', c.unreadCount);
router.post('/read', validate({ body: markReadSchema }), c.markRead);
router.get('/preferences', c.getPreferences);
router.patch('/preferences', validate({ body: preferencesSchema }), c.setPreferences);

export default router;
