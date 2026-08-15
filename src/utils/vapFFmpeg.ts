import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export const getFFmpeg = async () => {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    });
    return ffmpeg;
};

export const extractAudioFromVap = async (file: File): Promise<Blob> => {
    const ff = await getFFmpeg();
    const inputName = 'input.mp4';
    const outputName = 'output.mp3';
    
    await ff.writeFile(inputName, await fetchFile(file));
    
    // Check if it has audio
    await ff.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputName]);
    
    const data = await ff.readFile(outputName);
    return new Blob([data], { type: 'audio/mp3' });
};
