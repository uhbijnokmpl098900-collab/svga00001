import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

export const loadFFmpegWithFallbacks = async (ffmpeg: FFmpeg, onLog?: (msg: string) => void): Promise<void> => {
    if (ffmpeg.loaded) return;

    const cdns = [
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
        'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm',
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
        'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg-core/0.12.6'
    ];
    
    if (onLog) {
        ffmpeg.on('log', ({ message }) => {
            onLog(message);
        });
    } else {
        ffmpeg.on('log', ({ message }) => {
            console.log("FFmpeg Log:", message);
        });
    }

    const attemptLoad = async (baseURL: string) => {
        console.log(`Attempting to load FFmpeg from: ${baseURL}`);
        
        const coreURL = `${baseURL}/ffmpeg-core.js`;
        const wasmURL = `${baseURL}/ffmpeg-core.wasm`;

        const loadPromise = ffmpeg.load({
            coreURL: await toBlobURL(coreURL, 'text/javascript'),
            wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
        });

        // Increase timeout to 60 seconds
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`FFmpeg load timeout (60s) from ${baseURL}`)), 60000)
        );

        await Promise.race([loadPromise, timeoutPromise]);
        console.log("FFmpeg Loaded successfully");
    };

    let lastError: any = null;
    for (let i = 0; i < cdns.length; i++) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await attemptLoad(cdns[i]);
                return;
            } catch (e) {
                lastError = e;
                console.error(`FFmpeg load failed (CDN: ${cdns[i]}, Attempt: ${attempt + 1}):`, e);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    
    throw lastError || new Error("Failed to load FFmpeg from all available CDNs");
};
