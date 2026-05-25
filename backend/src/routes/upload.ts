import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const router = Router();

const useR2 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

let s3: S3Client;
if (useR2) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const storage = useR2
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('이미지 파일만 업로드 가능합니다.'));
  },
});

async function uploadToR2(file: Express.Multer.File, folder = 'artlink'): Promise<string> {
  const ext = path.extname(file.originalname);
  const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// 단일 이미지 업로드
router.post('/image', authenticate, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file)
      : `/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// 다중 이미지 업로드 (최대 10개)
router.post('/images', authenticate, upload.array('images', 10), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: '파일이 필요합니다.' });
    const urls = useR2
      ? await Promise.all(files.map(f => uploadToR2(f)))
      : files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    next(err);
  }
});

// 파일 업로드 (PDF/DOC/HWP/ZIP, 20MB)
const fileUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|doc|docx|hwp|hwpx|zip/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase().replace('.', ''));
    if (ext) return cb(null, true);
    cb(new Error('허용된 파일 형식: PDF, DOC, DOCX, HWP, HWPX, ZIP'));
  },
});

router.post('/file', authenticate, fileUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
    const url = useR2
      ? await uploadToR2(req.file, 'artlink/files')
      : `/uploads/${req.file.filename}`;
    res.json({ url, originalName: req.file.originalname });
  } catch (err) {
    next(err);
  }
});

export default router;
