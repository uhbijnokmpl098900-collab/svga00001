import { FFmpeg } from '@ffmpeg/ffmpeg';

export const loadFFmpegWithFallbacks = async (ffmpeg: FFmpeg, onLog?: (msg: string) => void): Promise<void> => {
    if (ffmpeg.loaded) return;

    if (onLog) {
        ffmpeg.on('log', ({ message }) => {
            onLog(message);
        });
    } else {
        ffmpeg.on('log', ({ message }) => {
            console.log("FFmpeg Log:", message);
        });
    }

    try {
        console.log("Attempting to load FFmpeg...");
        await ffmpeg.load({
            coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        });
        console.log("FFmpeg Loaded successfully");
    } catch (e) {
        console.error("FFmpeg load failed:", e);
        throw e;
    }
};
