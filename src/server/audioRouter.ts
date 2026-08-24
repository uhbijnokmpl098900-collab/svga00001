import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import crypto from 'crypto';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const router = express.Router();

// Helper to extract VAP metadata box from a Buffer
function extractRawVapBoxFromBuffer(buffer: Buffer): Buffer | null {
  try {
    const chunkSize = Math.min(buffer.length, 8 * 1024 * 1024);
    const start = Math.max(0, buffer.length - chunkSize);
    const slice = buffer.subarray(start);

    const boxTags = [
      Buffer.from([118, 97, 112, 99]), // 'vapc'
      Buffer.from([121, 121, 101, 97]), // 'yyea'
      Buffer.from([121, 121, 101, 118]), // 'yyev'
    ];

    let offset = -1;
    for (const tag of boxTags) {
      const idx = slice.indexOf(tag);
      if (idx !== -1) {
        offset = idx;
        break;
      }
    }

    if (offset >= 4) {
      const boxSize = slice.readUInt32BE(offset - 4);
      if (boxSize > 0 && boxSize <= slice.length - (offset - 4)) {
        return slice.subarray(offset - 4, offset - 4 + boxSize);
      } else {
        return slice.subarray(offset - 4);
      }
    }
  } catch (e) {
    console.warn('Failed to extract raw VAP box in server:', e);
  }
  return null;
}

function buildVapBoxFromJsonServer(config: any): Buffer {
  const jsonStr = typeof config === 'string' ? config : JSON.stringify(config);
  const jsonBytes = Buffer.from(jsonStr, 'utf-8');
  const boxSize = 8 + jsonBytes.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(boxSize, 0);
  header.write('vapc', 4, 'ascii');
  return Buffer.concat([header, jsonBytes]);
}

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

router.post('/replace-vap-audio', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const videoFile = files?.['video']?.[0];
  const audioFile = files?.['audio']?.[0];

  if (!videoFile) {
    return res.status(400).json({ error: 'ملف الفيديو (VAP) مطلوب' });
  }

  const outputId = crypto.randomUUID();
  const outputPath = path.join(uploadDir, `vap-remux-${outputId}.mp4`);
  const rawDuration = req.body.duration ? parseFloat(req.body.duration) : undefined;
  const vapConfigJson = req.body.vapConfig ? req.body.vapConfig : undefined;

  try {
    // Execute FFmpeg natively with zero video re-encoding (instant stream copy)
    await new Promise<void>((resolve, reject) => {
      const proc = ffmpeg();
      proc.input(videoFile.path);

      if (audioFile) {
        proc.input(audioFile.path)
            .outputOptions([
              '-map 0:v:0',
              '-map 1:a:0',
              '-c:v copy',
              '-c:a aac',
              '-b:a 192k',
              '-ar 44100'
            ]);
        if (rawDuration && rawDuration > 0) {
          proc.outputOptions([`-t ${rawDuration.toFixed(3)}`]);
        }
      } else {
        proc.outputOptions([
          '-map 0:v:0',
          '-c:v copy',
          '-an'
        ]);
      }

      proc.output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
    });

    // Read generated mp4
    const generatedMp4Buffer = await fs.promises.readFile(outputPath);
    
    // Read original video file to extract VAP metadata box
    const originalVideoBuffer = await fs.promises.readFile(videoFile.path);
    let vapBox = extractRawVapBoxFromBuffer(originalVideoBuffer);
    if (!vapBox && vapConfigJson) {
      try {
        const parsed = typeof vapConfigJson === 'string' ? JSON.parse(vapConfigJson) : vapConfigJson;
        vapBox = buildVapBoxFromJsonServer(parsed);
      } catch (e) {}
    }

    const finalBuffer = vapBox 
      ? Buffer.concat([generatedMp4Buffer, vapBox])
      : generatedMp4Buffer;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="replaced_vap.mp4"`);
    res.send(finalBuffer);
  } catch (error: any) {
    console.error('Error in replace-vap-audio endpoint:', error);
    res.status(500).json({ error: error?.message || 'فشلت معالجة الصوت في الخادم' });
  } finally {
    // Immediate cleanup of temporary files
    if (videoFile && fs.existsSync(videoFile.path)) {
      try { fs.unlinkSync(videoFile.path); } catch (e) {}
    }
    if (audioFile && fs.existsSync(audioFile.path)) {
      try { fs.unlinkSync(audioFile.path); } catch (e) {}
    }
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch (e) {}
    }
  }
});

export default router;
