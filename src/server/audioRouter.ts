import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import crypto from 'crypto';

const execFilePromise = util.promisify(execFile);

// Setup resilient FFmpeg binary path
let resolvedFfmpegPath = '/usr/bin/ffmpeg';
if (fs.existsSync('/usr/bin/ffmpeg')) {
  resolvedFfmpegPath = '/usr/bin/ffmpeg';
} else {
  resolvedFfmpegPath = 'ffmpeg';
}
console.log('[Audio Server] Initialized FFmpeg binary at:', resolvedFfmpegPath);

const router = express.Router();

// Helper to extract VAP metadata box from a Buffer
function extractRawVapBoxFromBuffer(buffer: Buffer): Buffer | null {
  try {
    const boxTags = ['vapc', 'yyea', 'yyev', 'udta'];
    for (const tagStr of boxTags) {
      const tag = Buffer.from(tagStr, 'ascii');
      let idx = buffer.indexOf(tag);
      while (idx !== -1) {
        if (idx >= 4) {
          const boxSize = buffer.readUInt32BE(idx - 4);
          // Standard MP4 box layout: [4 bytes size][4 bytes tag][payload]
          if (boxSize >= 8 && (idx - 4 + boxSize) <= buffer.length) {
            const rawPayload = buffer.subarray(idx + 4, idx - 4 + boxSize);
            const str = rawPayload.toString('utf-8');
            const start = str.indexOf('{');
            const end = str.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              try {
                const jsonStr = str.substring(start, end + 1);
                const parsed = JSON.parse(jsonStr);
                if (parsed && (parsed.info || parsed.descript || parsed.v !== undefined || parsed.rgbFrame || parsed.w || parsed.width)) {
                  return buildVapBoxFromJsonServer(parsed);
                }
              } catch {}
            }
          }
        }

        // Check if raw JSON follows the tag anywhere in the slice
        const rawPayload = buffer.subarray(idx + 4, Math.min(buffer.length, idx + 4 + 65536));
        const str = rawPayload.toString('utf-8');
        const start = str.indexOf('{');
        const end = str.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          try {
            const jsonStr = str.substring(start, end + 1);
            const parsed = JSON.parse(jsonStr);
            if (parsed && (parsed.info || parsed.descript || parsed.v !== undefined || parsed.rgbFrame || parsed.w || parsed.width)) {
              return buildVapBoxFromJsonServer(parsed);
            }
          } catch {}
        }

        idx = buffer.indexOf(tag, idx + 1);
      }
    }

    // Direct search for rgbFrame in buffer text
    const fullText = buffer.subarray(Math.max(0, buffer.length - 1024 * 1024)).toString('utf-8');
    const rgbIdx = fullText.indexOf('rgbFrame');
    if (rgbIdx !== -1) {
      const start = fullText.lastIndexOf('{', rgbIdx);
      const end = fullText.indexOf('}', rgbIdx);
      if (start !== -1 && end !== -1) {
        const jsonStr = fullText.substring(start, fullText.indexOf('}', end) + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          return buildVapBoxFromJsonServer(parsed);
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[Audio Server] Failed to extract raw VAP box in server:', e);
  }
  return null;
}

function buildVapBoxFromJsonServer(config: any): Buffer {
  let parsed: any = null;
  if (typeof config === 'string') {
    try {
      parsed = JSON.parse(config);
    } catch {
      parsed = null;
    }
  } else if (typeof config === 'object' && config !== null) {
    parsed = config;
  }

  if (!parsed) {
    parsed = {
      info: {
        v: 2,
        f: 24,
        w: 750,
        h: 1334,
        videoW: 1500,
        videoH: 1334,
        aFrame: [750, 0, 750, 1334],
        rgbFrame: [0, 0, 750, 1334]
      }
    };
  }

  // Ensure standard VAP info structure
  if (!parsed.info) {
    const desc = parsed.descript || parsed;
    const w = desc.w || desc.width || 750;
    const h = desc.h || desc.height || 1334;
    const f = desc.f || desc.fps || 24;
    const videoW = desc.videoW || desc.videoWidth || (w * 2);
    const videoH = desc.videoH || desc.videoHeight || h;
    const rgbFrame = desc.rgbFrame || [0, 0, w, h];
    const aFrame = desc.aFrame || desc.alphaFrame || [w, 0, w, h];
    parsed = {
      info: {
        v: 2,
        f,
        w,
        h,
        videoW,
        videoH,
        rgbFrame,
        aFrame,
        ...desc
      }
    };
  }

  const jsonStr = JSON.stringify(parsed);
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
        try { fs.unlinkSync(job.outputFile); } catch (e) {}
      }
      jobs.delete(id);
    }
  }
}, 3600000);

router.post('/extract', upload.single('video'), async (req, res) => {
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
    progress: 10,
    createdAt: Date.now()
  };

  jobs.set(jobId, newJob);

  res.json({ jobId, message: 'بدأت عملية الاستخراج' });

  // Process video in background with execFile
  (async () => {
    try {
      const args: string[] = ['-y', '-i', file.path, '-vn'];
      if (format === 'mp3') {
        args.push('-c:a', 'libmp3lame', '-b:a', quality);
      } else if (format === 'wav') {
        args.push('-c:a', 'pcm_s16le');
      } else if (format === 'aac') {
        args.push('-c:a', 'aac', '-b:a', quality);
      } else if (format === 'm4a') {
        args.push('-c:a', 'aac', '-b:a', quality);
      } else if (format === 'ogg') {
        args.push('-c:a', 'libvorbis', '-b:a', quality);
      } else if (format === 'flac') {
        args.push('-c:a', 'flac');
      } else if (format === 'opus') {
        args.push('-c:a', 'libopus', '-b:a', quality);
      } else {
        args.push('-c:a', 'aac', '-b:a', quality);
      }
      args.push(outputPath);

      await execFilePromise(resolvedFfmpegPath, args);
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.outputFile = outputPath;
      }
    } catch (err: any) {
      console.error('[Audio Extract Error]:', err);
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = err.message || 'فشل استخراج الصوت';
      }
    } finally {
      if (fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (e) {}
      }
    }
  })();
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ffmpeg: fs.existsSync(resolvedFfmpegPath),
    ffmpegPath: resolvedFfmpegPath,
    supportedFormats: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus']
  });
});

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'العملية غير موجودة' });
  }
  res.json(job);
});

router.get('/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'completed' || !job.outputFile || !fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'الملف غير جاهز أو غير موجود' });
  }

  const ext = path.extname(job.outputFile).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.opus': 'audio/opus',
  };

  const stat = fs.statSync(job.outputFile);
  res.setHeader('Content-Type', mimeTypes[ext] || 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(job.outputFile).pipe(res);
});

router.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'completed' || !job.outputFile || !fs.existsSync(job.outputFile)) {
    return res.status(404).json({ error: 'الملف غير جاهز أو غير موجود' });
  }

  const ext = path.extname(job.outputFile);
  const baseName = path.basename(job.originalName, path.extname(job.originalName)) || 'audio_export';
  const downloadName = `${baseName}${ext}`;

  res.download(job.outputFile, downloadName, (err) => {
    if (err) {
      console.warn('[Audio Download Notice]:', err.message);
    }
  });
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
  const isMute = req.body.mute === 'true' || req.body.mute === '1';
  const vapCompressionEnabled = req.body.vapCompressionEnabled === 'true' || req.body.vapCompressionEnabled === '1';

  try {
    // 1. Probe exact video duration to ensure added audio is trimmed to exact video length
    let exactDuration: number | undefined = rawDuration && rawDuration > 0 ? rawDuration : undefined;
    try {
      const { stdout } = await execFilePromise('/usr/bin/ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoFile.path
      ]);
      const probed = parseFloat(stdout.trim());
      if (!isNaN(probed) && probed > 0) {
        exactDuration = probed;
      }
    } catch (probeErr) {
      console.warn('[Audio Server] ffprobe duration probe warning:', probeErr);
    }

    const args: string[] = ['-y', '-threads', '0', '-i', videoFile.path];

    if (audioFile && !isMute) {
      if (exactDuration && exactDuration > 0) {
        args.push('-t', exactDuration.toFixed(4));
      }
      args.push('-i', audioFile.path);
      args.push('-map', '0:v:0');
      args.push('-map', '1:a:0');
      
      // If VAP compression is enabled, compress the video stream
      if (vapCompressionEnabled) {
          args.push('-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast');
      } else {
          args.push('-c:v', 'copy');
      }
      
      args.push('-c:a', 'aac');
      args.push('-b:a', '128k');
      args.push('-ar', '44100');
      args.push('-ac', '2');
      args.push('-shortest');
    } else if (isMute) {
      args.push('-map', '0:v:0');
      // If VAP compression is enabled, compress the video stream
      if (vapCompressionEnabled) {
          args.push('-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast');
      } else {
          args.push('-c:v', 'copy');
      }
      args.push('-an');
    } else {
      args.push('-map', '0:v:0');
      args.push('-map', '0:a:0?');
      // If VAP compression is enabled, compress the video stream
      if (vapCompressionEnabled) {
          args.push('-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast');
      } else {
          args.push('-c:v', 'copy');
      }
      args.push('-c:a', 'copy');
    }

    args.push(outputPath);

    console.log('[Audio Server] Running ultra-fast remux with args:', args.join(' '));
    await execFilePromise(resolvedFfmpegPath, args);

    if (!fs.existsSync(outputPath)) {
      throw new Error('فشل إنشاء ملف الفيديو الجديد');
    }

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

    // Ensure a valid VAP box is ALWAYS appended
    if (!vapBox) {
      vapBox = buildVapBoxFromJsonServer(null);
    }

    const finalBuffer = Buffer.concat([generatedMp4Buffer, vapBox]);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="replaced_vap.mp4"`);
    res.setHeader('Content-Length', finalBuffer.length.toString());
    res.end(finalBuffer);
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
