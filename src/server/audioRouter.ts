import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import crypto from 'crypto';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const router = express.Router();

// Setup Multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('video/') || 
      file.mimetype.startsWith('audio/') || 
      file.originalname.match(/\.(mp4|mov|mkv|avi|webm|flv|wmv|3gp|mp3|wav|aac|m4a|ogg|flac|opus|wma|aiff|alac)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error('الملف غير مدعوم. الرجاء رفع ملف صوتي أو فيديو صالح.'));
    }
  }
});

interface Job {
  id: string;
  originalName: string;
  size: number;
  format: string;
  quality: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  createdAt: number;
  outputFile?: string;
  error?: string;
}

const jobs = new Map<string, Job>();

// Clean up jobs and files older than 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > 3600000) {
      if (job.outputFile && fs.existsSync(job.outputFile)) {
        fs.unlinkSync(job.outputFile);
      }
      jobs.delete(id);
    }
  }
}, 3600000);

router.post('/extract', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  }

  const file = req.file;
  const format = req.body.format || 'mp3';
  const quality = req.body.quality || '192k';

  const jobId = crypto.randomUUID();
  const outputFileName = `audio-${jobId}.${format}`;
  const outputPath = path.join(uploadDir, outputFileName);

  const newJob: Job = {
    id: jobId,
    originalName: file.originalname,
    size: file.size,
    format,
    quality,
    status: 'processing',
    progress: 0,
    createdAt: Date.now()
  };

  jobs.set(jobId, newJob);

  res.json({ jobId, message: 'بدأت عملية الاستخراج' });

  // Process video in background
  const command = ffmpeg(file.path)
    .noVideo()
    .format(format);

  if (format === 'mp3') {
    command.audioBitrate(quality);
  }

  command.on('progress', (progress) => {
    const job = jobs.get(jobId);
    if (job) {
      job.progress = Math.round(progress.percent || 0);
    }
  })
  .on('end', () => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.progress = 100;
      job.outputFile = outputPath;
    }
    // Delete original file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  })
  .on('error', (err, stdout, stderr) => {
    console.error('FFmpeg Error:', err.message);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = err.message;
    }
    // Delete original file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  })
  .save(outputPath);
});

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'العملية غير موجودة' });
  }
  res.json(job);
});

router.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'completed' || !job.outputFile) {
    return res.status(404).json({ error: 'الملف غير جاهز أو غير موجود' });
  }

  const ext = path.extname(job.outputFile);
  const baseName = path.basename(job.originalName, path.extname(job.originalName));
  const downloadName = `${baseName}${ext}`;

  res.download(job.outputFile, downloadName);
});

export default router;
