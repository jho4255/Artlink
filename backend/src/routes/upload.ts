import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { v2 as cloudinary } from 'cloudinary';

const router = Router();

// Cloudinary 사용 여부 판별 (환경변수가 모두 설정된 경우에만 사용)
const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('☁️ Cloudinary 업로드 모드 활성화');
}

// Multer 설정: Cloudinary 사용 시 memoryStorage, 아닐 때 diskStorage
const storage = useCloudinary
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
      },
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('이미지 파일만 업로드 가능합니다.'));
  },
});

// Cloudinary에 버퍼 업로드하는 헬퍼 함수
function uploadToCloudinary(buffer: Buffer, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: `artlink/${folder}` }, (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      })
      .end(buffer);
  });
}

// 단일 이미지 업로드
router.post('/image', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });

  if (useCloudinary) {
    const url = await uploadToCloudinary(req.file.buffer, 'images');
    return res.json({ url });
  }

  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// 다중 이미지 업로드 (최대 10개)
router.post('/images', authenticate, upload.array('images', 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) return res.status(400).json({ error: '파일이 필요합니다.' });

  if (useCloudinary) {
    const urls = await Promise.all(
      files.map((f) => uploadToCloudinary(f.buffer, 'images'))
    );
    return res.json({ urls });
  }

  const urls = files.map((f) => `/uploads/${f.filename}`);
  res.json({ urls });
});

export default router;
