import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { protect, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname) || '';
        cb(null, `${unique}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max for 4K video exports
});

// GET /api/files/presigned-url
router.get('/presigned-url', protect, (req: AuthenticatedRequest, res: Response) => {
    try {
        const key = (req.query.key as string) || `uploads/${Date.now()}_media`;
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4005}`;
        const publicUrl = `${baseUrl}/uploads/${path.basename(key)}`;
        const uploadUrl = `${baseUrl}/api/files/upload-direct?key=${encodeURIComponent(key)}`;

        return res.json({
            success: true,
            url: uploadUrl,
            publicUrl,
            key,
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/files/upload
router.post('/upload', protect, upload.single('file'), (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4005}`;
        const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;

        return res.json({
            success: true,
            fileUrl,
            url: fileUrl,
            document: {
                id: req.file.filename,
                fileName: req.file.originalname,
                fileUrl,
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
            },
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Direct PUT stream upload for presigned fallback
router.put('/upload-direct', (req: Request, res: Response) => {
    try {
        const key = (req.query.key as string) || `upload_${Date.now()}`;
        const filename = path.basename(key);
        const targetPath = path.join(uploadsDir, filename);

        const writeStream = fs.createWriteStream(targetPath);
        req.pipe(writeStream);

        writeStream.on('finish', () => {
            const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4005}`;
            const fileUrl = `${baseUrl}/uploads/${filename}`;
            return res.status(200).json({ success: true, url: fileUrl, fileUrl });
        });

        writeStream.on('error', (err) => {
            return res.status(500).json({ success: false, error: err.message });
        });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
