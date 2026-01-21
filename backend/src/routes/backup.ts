import express from 'express';
import multer from 'multer';
import * as backupController from '../controllers/backupController';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.get('/export', backupController.exportBackup);
router.post('/import', upload.single('backup'), backupController.importBackup);

export default router;
