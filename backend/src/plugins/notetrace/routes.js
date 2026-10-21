import { Router } from 'express';
import { requireAuth, isPluginActivated, captureStatus, connectCapture, disconnectCapture, prepareEmailCapture, saveEmailCapture, emailCaptureStatus } from '../api.js';

const router = Router();
router.use(requireAuth);
router.use(async (req, res, next) => await isPluginActivated(req.session.userId, 'notetrace') ? next() : res.status(409).json({ error: 'Enable NoteTrace in Settings → Plugins first.' }));
const handle = fn => async (req, res) => {
  try { res.json(await fn(req.session.userId, req.body || {}, req)); }
  catch (e) { res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.status ? e.message : 'The NoteTrace request failed. Try again.' }); }
};
router.get('/status', handle(captureStatus));
router.get('/messages/:id', handle((userId, _body, req) => emailCaptureStatus(userId, req.params.id)));
router.post('/connect', handle(connectCapture));
router.delete('/disconnect', handle(disconnectCapture));
router.post('/preview', handle(prepareEmailCapture));
router.post('/captures', handle(saveEmailCapture));
export default router;
