import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { loadFFmpegWithFallbacks } from './ffmpegLoader';

let ffmpeg: FFmpeg | null = null;

export const getFFmpeg = async (onLog?: (msg: string) => void): Promise<FFmpeg> => {
    if (ffmpeg && ffmpeg.loaded) return ffmpeg;
    if (!ffmpeg) {
      ffmpeg = new FFmpeg();
    }
    await loadFFmpegWithFallbacks(ffmpeg, onLog);
    return ffmpeg;
};

export const extractAudioFromVap = async (file: File | Blob): Promise<Blob> => {
    const ff = await getFFmpeg();
    const inputName = 'input_audio_extract.mp4';
    const outputName = 'output_audio_extract.mp3';
    
    await ff.writeFile(inputName, await fetchFile(file));
    
    // Extract audio stream directly to MP3
    await ff.exec(['-y', '-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputName]);
    
    const data = await ff.readFile(outputName);
    return new Blob([data], { type: 'audio/mp3' });
};

// Build a valid VAP 'vapc' box from JSON string or object
export const buildVapBoxFromJson = (config: any): Uint8Array => {
  const jsonStr = typeof config === 'string' ? config : JSON.stringify(config);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const boxSize = 8 + jsonBytes.length; // 4 bytes size + 4 bytes 'vapc' + json
  const buffer = new ArrayBuffer(boxSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  view.setUint32(0, boxSize);
  uint8[4] = 118; // 'v'
  uint8[5] = 97;  // 'a'
  uint8[6] = 112; // 'p'
  uint8[7] = 99;  // 'c'
  uint8.set(jsonBytes, 8);

  return uint8;
};

// Extract raw VAP config box bytes from a Blob
export const extractRawVapBox = async (blob: Blob): Promise<Uint8Array | null> => {
  try {
    const chunkSize = Math.min(blob.size, 8 * 1024 * 1024);
    const start = Math.max(0, blob.size - chunkSize);
    const slice = blob.slice(start, blob.size);
    const buffer = await slice.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    const boxTags = [
      [118, 97, 112, 99], // 'vapc'
      [121, 121, 101, 97], // 'yyea' (YYEVA)
      [121, 121, 101, 118], // 'yyev' (YYEVA)
    ];

    let offset = -1;
    for (const tag of boxTags) {
      for (let i = 0; i <= uint8.length - 4; i++) {
        if (
          uint8[i] === tag[0] &&
          uint8[i + 1] === tag[1] &&
          uint8[i + 2] === tag[2] &&
          uint8[i + 3] === tag[3]
        ) {
          offset = i;
          break;
        }
      }
      if (offset !== -1) break;
    }

    if (offset >= 4) {
      const view = new DataView(buffer);
      const boxSize = view.getUint32(offset - 4);
      if (boxSize > 0 && boxSize <= uint8.length - (offset - 4)) {
        return uint8.slice(offset - 4, offset - 4 + boxSize);
      } else {
        return uint8.slice(offset - 4);
      }
    }
  } catch (e) {
    console.warn('Failed to extract raw VAP box:', e);
  }
  return null;
};

/**
 * Ultra-fast audio replacement in VAP (zero video re-encoding, pure stream copy)
 * - Video stream is copied bit-for-bit (-c:v copy)
 * - Audio is encoded to high-quality AAC and muxed
 * - Preserves original VAP box metadata for transparency
 */
export const fastReplaceAudioInVap = async (
    videoFile: File | Blob, 
    audioFile: File | Blob | null, 
    options?: {
      duration?: number;
      vapConfig?: any;
      mute?: boolean;
      onProgress?: (progress: number) => void;
      onStatus?: (status: string) => void;
    }
): Promise<Blob> => {
    // 1. Try High-Performance Server Direct Stream Copy Endpoint (100-300ms execution)
    try {
      options?.onStatus?.('جاري استبدال مسار الصوت في VAP فوراً عبر المحرك فائق السرعة...');
      options?.onProgress?.(15);

      const formData = new FormData();
      formData.append('video', videoFile, (videoFile as File).name || 'input_video.mp4');
      if (audioFile) {
        formData.append('audio', audioFile, (audioFile as File).name || 'input_audio.mp3');
      }
      if (options?.mute) {
        formData.append('mute', 'true');
      }
      if (options?.duration && options.duration > 0) {
        formData.append('duration', options.duration.toString());
      }
      if (options?.vapConfig) {
        formData.append('vapConfig', JSON.stringify(options.vapConfig));
      }

      const responseBlob = await new Promise<Blob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/audio/replace-vap-audio');
        xhr.responseType = 'blob';

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            const percent = Math.min(85, Math.round((e.loaded / e.total) * 70) + 15);
            options?.onProgress?.(percent);
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300 && xhr.response && xhr.response.size > 0) {
            options?.onProgress?.(95);
            resolve(xhr.response as Blob);
          } else {
            let errorMsg = `Server response status: ${xhr.status}`;
            try {
              if (xhr.response instanceof Blob) {
                const errText = await xhr.response.text();
                errorMsg += ` - ${errText}`;
              }
            } catch (_) {}
            console.error('[VAP Audio Server Error]:', errorMsg);
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => reject(new Error('Network error on audio engine'));
        xhr.ontimeout = () => reject(new Error('Audio engine timeout'));
        xhr.send(formData);
      });

      options?.onProgress?.(100);
      options?.onStatus?.('تم تجهيز وتحديث ملف الـ VAP بالصوت الجديد بنجاح!');
      return responseBlob;
    } catch (serverErr) {
      console.warn("[VAP Audio] Server fast-replace audio unavailable, checking local fallback options:", serverErr);
    }

    // 2. Client-side fallback via WASM if available
    try {
      const ff = await getFFmpeg((log) => {
        console.log("[VAP Audio Engine]", log);
      });

      const videoName = 'input_video.mp4';
      const audioName = 'input_audio.media';
      const outputName = 'output_vap_remux.mp4';
      
      options?.onStatus?.('جاري قراءة ملف VAP وتجهيز مسار الصوت...');
      options?.onProgress?.(10);

      if (options?.onProgress) {
          ff.on('progress', ({ progress }) => {
              const p = Math.min(95, Math.max(15, Math.round(progress * 100)));
              options.onProgress?.(p);
          });
      }

      await ff.writeFile(videoName, await fetchFile(videoFile));

      const args: string[] = ['-y', '-i', videoName];

      if (audioFile) {
          options?.onStatus?.('جاري استبدال مسار الصوت بدون المساس بإطارات الفيديو...');
          await ff.writeFile(audioName, await fetchFile(audioFile));
          args.push('-i', audioName);
          args.push('-map', '0:v:0');
          args.push('-map', '1:a:0?');
          args.push('-c:v', 'copy');
          args.push('-c:a', 'aac');
          args.push('-b:a', '192k');
          args.push('-ar', '44100');
          args.push('-shortest');
          if (options?.duration && options.duration > 0) {
            args.push('-t', options.duration.toFixed(3));
          }
      } else if (options?.mute) {
          // Mute audio / remove audio stream completely
          options?.onStatus?.('جاري إزالة مسار الصوت وكتم الفيديو فوراً...');
          args.push('-map', '0:v:0');
          args.push('-c:v', 'copy');
          args.push('-an');
      } else {
          options?.onStatus?.('جاري نسخ مسارات الفيديو والصوت...');
          args.push('-map', '0:v:0');
          args.push('-map', '0:a:0?');
          args.push('-c:v', 'copy');
          args.push('-c:a', 'copy');
      }

      args.push(outputName);
      
      options?.onProgress?.(40);
      await ff.exec(args);
      options?.onProgress?.(80);
      
      options?.onStatus?.('جاري استخراج ودمج صندوق إعدادات الشفافية (VAP metadata)...');
      const data = await ff.readFile(outputName);
      const ffmpegOutputBlob = new Blob([data], { type: 'video/mp4' });
      
      // Extract custom VAP/YYEVA box from original file or rebuild from config
      let rawBox = await extractRawVapBox(videoFile);
      if (!rawBox && options?.vapConfig) {
        rawBox = buildVapBoxFromJson(options.vapConfig);
      }
      
      options?.onProgress?.(100);
      options?.onStatus?.('تم تجهيز ملف الـ VAP بنجاح مع الصوت الجديد!');

      if (rawBox) {
          return new Blob([ffmpegOutputBlob, rawBox], { type: 'video/mp4' });
      }
      
      return ffmpegOutputBlob;
    } catch (wasmErr) {
      console.warn("[VAP Audio] WASM processing unavailable:", wasmErr);
      
      // If we are just preserving the video without custom audio alteration
      if (!audioFile && !options?.mute) {
        let rawBox = await extractRawVapBox(videoFile);
        if (!rawBox && options?.vapConfig) {
          rawBox = buildVapBoxFromJson(options.vapConfig);
        }
        if (rawBox) {
          return new Blob([videoFile, rawBox], { type: 'video/mp4' });
        }
        return videoFile instanceof Blob ? videoFile : new Blob([videoFile], { type: 'video/mp4' });
      }

      throw wasmErr;
    }
};
