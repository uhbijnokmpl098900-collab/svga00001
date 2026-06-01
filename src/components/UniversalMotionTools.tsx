import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Download, Music, Image as ImageIcon, Box, ZoomIn, ZoomOut, Maximize, Play, Pause, RefreshCw, Layers } from 'lucide-react';
import { UserRecord } from '../types';
import SVGAPlayer from './SVGAPlayer';
import { VapPlayer } from './VapPlayer';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { loadFFmpegWithFallbacks } from '../utils/ffmpegLoader';
import JSZip from 'jszip';
import { encodeSVGA } from '../utils/svgaEncoder';

interface UniversalMotionToolsProps {
  currentUser: UserRecord | null;
  onCancel: () => void;
  onLoginRequired: () => void;
  onSubscriptionRequired: () => void;
}

export const UniversalMotionTools: React.FC<UniversalMotionToolsProps> = ({
  currentUser,
  onCancel,
  onLoginRequired,
  onSubscriptionRequired
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'Motion' | 'Image' | 'Docs'>('Motion');
  
  const ffmpegRef = useRef(new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        await loadFFmpegWithFallbacks(ffmpegRef.current);
        setFfmpegLoaded(true);
      } catch (err: any) {
        console.error("Failed to load FFmpeg:", err);
        if (ffmpegRef.current.loaded) {
            setFfmpegLoaded(true);
        }
      }
    };
    loadFFmpeg();
  }, []);
  
  const [fileInfo, setFileInfo] = useState({
    format: '',
    version: '-',
    dimensions: '-',
    duration: '-',
    size: '-',
    fps: '-',
    name: ''
  });

  const [convertFormat, setConvertFormat] = useState('VAP 1.0.5');
  const [compressionQuality, setCompressionQuality] = useState(80);
  const [exportFps, setExportFps] = useState(30);
  const [alphaMode, setAlphaMode] = useState<'none'|'right'|'left'|'bottom'|'top'|'white'|'black'|'green'>('right');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableFormats = [
    'SVGA 2.0', 'WebM (Video)', 'VAP 1.0.5', 'VAP (MP4)', 'YYEVA (MP4)', 'WebP (Animated)',
    'Image Sequence', 'GIF (Animation)', 'APNG (Animation)'
  ];

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) processFile(dropped);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) processFile(selected);
  };

  const processFile = (f: File) => {
    setFile(f);
    const url = URL.createObjectURL(f);
    setFileUrl(url);
    
    // Naive file info extraction for now
    let type = f.type || 'Unknown';
    if (f.name.toLowerCase().endsWith('.svga')) type = 'SVGA';
    else if (f.name.toLowerCase().endsWith('.mp4')) {
        type = 'MP4';
        // Auto-detect common side-by-side alpha by checking if it's VAP
        if (f.name.toLowerCase().includes('vap') || f.name.toLowerCase().includes('yyeva')) {
            setAlphaMode('right');
        } else {
            setAlphaMode('none');
        }
    }
    else if (f.name.toLowerCase().endsWith('.json')) type = 'Lottie';

    setFileInfo({
      format: type,
      version: '1.0',
      dimensions: '800 x 600 px',
      duration: '0.00 s',
      size: (f.size / (1024 * 1024)).toFixed(2) + ' MB',
      fps: '30 FPS',
      name: f.name
    });
  };

  const handleDownloadImages = async () => {
    if (!file) return;
    setIsProcessing(true);
    let ffmpeg = ffmpegRef.current;
    if (!ffmpegLoaded) {
       try {
           if (!ffmpeg.loaded) {
               await loadFFmpegWithFallbacks(ffmpeg);
           }
           setFfmpegLoaded(true);
       } catch (err) {
           console.error(err);
           alert("تعذر تحميل المحرك، يرجى تحديث الصفحة.");
           setIsProcessing(false);
           return;
       }
    }
    
    try {
        const uint8 = new Uint8Array(await file.arrayBuffer());
        const inputName = `input_${file.name.replace(/\s+/g, '_')}`;
        await ffmpeg.writeFile(inputName, uint8);
        
        let filterComplex = '';
        const isVideo = fileInfo.format === 'MP4' || fileInfo.format.startsWith('video');
        if (isVideo && alphaMode !== 'none') {
            if (alphaMode === 'right') {
                filterComplex = '[0:v]crop=iw/2:ih:0:0[out]';
            } else if (alphaMode === 'left') {
                filterComplex = '[0:v]crop=iw/2:ih:iw/2:0[out]';
            } else if (alphaMode === 'bottom') {
                filterComplex = '[0:v]crop=iw:ih/2:0:0[out]';
            } else if (alphaMode === 'top') {
                filterComplex = '[0:v]crop=iw:ih/2:0:ih/2[out]';
            } else if (alphaMode === 'black') {
                // To remove black background and keep transparency in PNG
                filterComplex = '[0:v]colorkey=black:0.1:0.2[out]';
            } else if (alphaMode === 'white') {
                filterComplex = '[0:v]colorkey=white:0.1:0.2[out]';
            } else if (alphaMode === 'green') {
                filterComplex = '[0:v]colorkey=0x00FF00:0.3:0.2[out]';
            }
        }
        
        const baseName = fileInfo.name.replace(/\.[^/.]+$/, "");
        const outPattern = 'frame_%04d.png';
        const args = ['-i', inputName];
        if (filterComplex) {
            
            if (['right', 'left', 'top', 'bottom'].includes(alphaMode)) {
                // If it's a side-by-side video, we extract alpha using alphamerge!
                let alphaFilter = '';
                if (alphaMode === 'right') alphaFilter = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:0:0[rgb]; [alpha_full]crop=iw/2:ih:iw/2:0[alpha]; [rgb][alpha]alphamerge[out]';
                else if (alphaMode === 'left') alphaFilter = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:iw/2:0[rgb]; [alpha_full]crop=iw/2:ih:0:0[alpha]; [rgb][alpha]alphamerge[out]';
                else if (alphaMode === 'bottom') alphaFilter = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:0[rgb]; [alpha_full]crop=iw:ih/2:0:ih/2[alpha]; [rgb][alpha]alphamerge[out]';
                else if (alphaMode === 'top') alphaFilter = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:ih/2[rgb]; [alpha_full]crop=iw:ih/2:0:0[alpha]; [rgb][alpha]alphamerge[out]';
                args.push('-filter_complex', alphaFilter, '-map', '[out]');
            } else {
                args.push('-filter_complex', filterComplex, '-map', '[out]');
            }
        }
        args.push(outPattern);
        
        await ffmpeg.exec(args);
        
        const jszip = new JSZip();
        const files = (await ffmpeg.listDir('.')).filter(f => !f.isDir);
        let foundFrames = 0;
        for (const f of files) {
            if (f.name.startsWith('frame_') && f.name.endsWith('.png')) {
                const data = await ffmpeg.readFile(f.name);
                jszip.file(f.name, (data as Uint8Array).buffer);
                foundFrames++;
                ffmpeg.deleteFile(f.name);
            }
        }
        if (foundFrames > 0) {
           const content = await jszip.generateAsync({ type: 'blob' });
           const url = URL.createObjectURL(content);
           const link = document.createElement('a');
           link.href = url;
           link.download = `${baseName}_images.zip`;
           link.click();
        } else {
           throw new Error("No frames extracted");
        }
        ffmpeg.deleteFile(inputName);
    } catch (err: any) {
        console.error(err);
        alert('حدث خطأ أثناء التصدير: ' + err.message);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleStartConversion = async () => {
    if (!currentUser) {
      onLoginRequired();
      return;
    }
    
    if (!file) return;

    setIsProcessing(true);
    let ffmpeg = ffmpegRef.current;
    if (!ffmpegLoaded) {
       try {
           if (!ffmpeg.loaded) {
               await loadFFmpegWithFallbacks(ffmpeg);
           }
           setFfmpegLoaded(true);
       } catch (err) {
           console.error(err);
           alert("تعذر تحميل المحرك، يرجى تحديث الصفحة.");
           setIsProcessing(false);
           return;
       }
    }
    
    try {
        const uint8 = new Uint8Array(await file.arrayBuffer());
        const inputName = `input_${file.name.replace(/\s+/g, '_')}`;
        await ffmpeg.writeFile(inputName, uint8);
        
        let filterComplex = '';
        
        const isVideo = fileInfo.format === 'MP4' || fileInfo.format.startsWith('video');
        
        if (isVideo && alphaMode !== 'none') {
            if (alphaMode === 'right') {
                filterComplex = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:0:0[rgb]; [alpha_full]crop=iw/2:ih:iw/2:0[alpha]; [rgb][alpha]alphamerge[out]';
            } else if (alphaMode === 'left') {
                filterComplex = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:iw/2:0[rgb]; [alpha_full]crop=iw/2:ih:0:0[alpha]; [rgb][alpha]alphamerge[out]';
            } else if (alphaMode === 'bottom') {
                filterComplex = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:0[rgb]; [alpha_full]crop=iw:ih/2:0:ih/2[alpha]; [rgb][alpha]alphamerge[out]';
            } else if (alphaMode === 'top') {
                filterComplex = '[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:ih/2[rgb]; [alpha_full]crop=iw:ih/2:0:0[alpha]; [rgb][alpha]alphamerge[out]';
            } else if (alphaMode === 'white') {
                filterComplex = '[0:v]colorkey=white:0.1:0.2[out]';
            } else if (alphaMode === 'black') {
                filterComplex = '[0:v]colorkey=black:0.1:0.2[out]';
            } else if (alphaMode === 'green') {
                filterComplex = '[0:v]colorkey=0x00FF00:0.3:0.2[out]';
            }
        }
        
        const baseName = fileInfo.name.replace(/\.[^/.]+$/, "");
        
        if (convertFormat === 'Image Sequence') {
            const outPattern = 'frame_%04d.png';
            const args = ['-i', inputName];
            if (filterComplex) {
                args.push('-filter_complex', filterComplex, '-map', '[out]');
            }
            args.push(outPattern);
            
            await ffmpeg.exec(args);
            
            const jszip = new JSZip();
            const files = await ffmpeg.listDir('.');
            let foundFrames = 0;
            for (const f of files) {
                if (f.name.startsWith('frame_') && f.name.endsWith('.png')) {
                    const data = await ffmpeg.readFile(f.name);
                    jszip.file(f.name, (data as Uint8Array).buffer);
                    foundFrames++;
                    ffmpeg.deleteFile(f.name);
                }
            }
            if (foundFrames > 0) {
               const content = await jszip.generateAsync({ type: 'blob' });
               const url = URL.createObjectURL(content);
               const link = document.createElement('a');
               link.href = url;
               link.download = `${baseName}_images.zip`;
               link.click();
            } else {
               throw new Error("No frames extracted");
            }
            
        } else if (convertFormat === 'GIF (Animation)') {
            const outName = 'out.gif';
            const args = ['-i', inputName];
            if (filterComplex) {
                const fullFilter = `${filterComplex}; [out]split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse[gifout]`;
                args.push('-filter_complex', fullFilter, '-map', '[gifout]');
            } else {
                args.push('-filter_complex', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-map', '0:v');
            }
            args.push(outName);
            await ffmpeg.exec(args);
            const data = await ffmpeg.readFile(outName);
            const blob = new Blob([data], { type: 'image/gif' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}.gif`;
            link.click();
            ffmpeg.deleteFile(outName);
            
        } else if (convertFormat === 'WebM (Video)') {
            const outName = 'out.webm';
            const args = ['-i', inputName];
            if (filterComplex) {
                args.push('-filter_complex', filterComplex, '-map', '[out]');
            }
            const crf = Math.floor(51 - (compressionQuality * 51 / 100));
            args.push('-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p', '-crf', crf.toString(), '-b:v', '0');
            args.push(outName);
            await ffmpeg.exec(args);
            const data = await ffmpeg.readFile(outName);
            const blob = new Blob([data], { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}.webm`;
            link.click();
            ffmpeg.deleteFile(outName);
        } else if (convertFormat === 'APNG (Animation)') {
            const outName = 'out.apng';
            const args = ['-i', inputName];
            if (filterComplex) {
                args.push('-filter_complex', filterComplex, '-map', '[out]');
            }
            args.push('-f', 'apng', '-plays', '0');
            args.push(outName);
            await ffmpeg.exec(args);
            const data = await ffmpeg.readFile(outName);
            const blob = new Blob([data], { type: 'image/apng' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}.apng`;
            link.click();
            ffmpeg.deleteFile(outName);
        } else if (convertFormat === 'WebP (Animated)') {
            const outName = 'out.webp';
            const args = ['-i', inputName];
            if (filterComplex) {
                args.push('-filter_complex', filterComplex, '-map', '[out]');
            }
            args.push('-vcodec', 'libwebp', '-lossless', '0', '-compression_level', '4', '-q:v', compressionQuality.toString(), '-loop', '0');
            args.push(outName);
            await ffmpeg.exec(args);
            const data = await ffmpeg.readFile(outName);
            const blob = new Blob([data], { type: 'image/webp' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}.webp`;
            link.click();
            ffmpeg.deleteFile(outName);
        } else if (convertFormat === 'VAP 1.0.5' || convertFormat === 'VAP (MP4)' || convertFormat === 'YYEVA (MP4)') {
            const outName = 'out.mp4';
            const args = ['-i', inputName];
            
            // If the input is already a video and alphaMode is right/left (which means it's ALREADY side-by-side)
            // AND they are asking for VAP, we might just be copying it. But they might want to 
            // convert WebM or GIF to VAP!
            // Let's ensure format=rgba is forced before split to ensure alphaextract succeeds.
            const sourceStream = filterComplex ? '[out]' : '0:v';
            
            const vapFilter = `${filterComplex ? filterComplex + ';' : ''}${sourceStream}format=rgba,split[rgb][a];[rgb]format=rgb24[rgb_out];[a]alphaextract[a_out];[rgb_out][a_out]hstack[vap_out]`;
            
            args.push('-filter_complex', vapFilter, '-map', '[vap_out]');
            const crf = Math.floor(51 - (compressionQuality * 51 / 100));
            args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf.toString());
            args.push(outName);
            
            let ffmpegLogs = '';
            const logHandler = ({ message }: { message: string }) => { ffmpegLogs += message + '\n'; };
            ffmpeg.on('log', logHandler);
            
            const ret = await ffmpeg.exec(args);
            ffmpeg.off('log', logHandler);
            
            if (ret !== 0) {
               console.error(ffmpegLogs);
               throw new Error(`FFmpeg error (code ${ret}): Check console for details. ` + ffmpegLogs.slice(-200));
            }
            
            const data = await ffmpeg.readFile(outName);
            const blob = new Blob([data], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = convertFormat.includes('YYEVA') ? `${baseName}_yyeva.mp4` : `${baseName}_vap.mp4`;
            link.click();
            ffmpeg.deleteFile(outName);
        } else if (convertFormat === 'SVGA 2.0') {
            const outPattern = 'frame_%04d.png';
            const args = ['-i', inputName];
            
            const scaleRatio = Math.max(0.1, compressionQuality / 100).toFixed(2);
            let svgaFilter = '';
            
            let currentOut = '0:v';

            if (['right', 'left', 'top', 'bottom'].includes(alphaMode)) {
                let alphaFilter = '';
                if (alphaMode === 'right') alphaFilter = `[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:0:0[rgb]; [alpha_full]crop=iw/2:ih:iw/2:0[alpha]; [rgb][alpha]alphamerge[merged]`;
                else if (alphaMode === 'left') alphaFilter = `[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw/2:ih:iw/2:0[rgb]; [alpha_full]crop=iw/2:ih:0:0[alpha]; [rgb][alpha]alphamerge[merged]`;
                else if (alphaMode === 'bottom') alphaFilter = `[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:0[rgb]; [alpha_full]crop=iw:ih/2:0:ih/2[alpha]; [rgb][alpha]alphamerge[merged]`;
                else if (alphaMode === 'top') alphaFilter = `[0:v]split [rgb_full][alpha_full]; [rgb_full]crop=iw:ih/2:0:ih/2[rgb]; [alpha_full]crop=iw:ih/2:0:0[alpha]; [rgb][alpha]alphamerge[merged]`;
                
                svgaFilter += alphaFilter + ';';
                currentOut = 'merged';
            } else if (alphaMode === 'black') {
                svgaFilter += `[0:v]format=rgba,colorkey=black:0.3:0.2[ck];`;
                currentOut = 'ck';
            } else if (alphaMode === 'white') {
                svgaFilter += `[0:v]format=rgba,colorkey=white:0.3:0.2[ck];`;
                currentOut = 'ck';
            } else if (alphaMode === 'green') {
                svgaFilter += `[0:v]format=rgba,colorkey=0x00FF00:0.3:0.2[ck];`;
                currentOut = 'ck';
            }

            svgaFilter += `[${currentOut}]scale=iw*${scaleRatio}:-1`;
            
            if (compressionQuality <= 85) {
                // High compression for SVGA: convert to 256 colors palette with transparency
                svgaFilter += `[scaled];[scaled]split[s0][s1];[s0]palettegen=max_colors=256:reserve_transparent=1:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5[out]`;
            } else {
                svgaFilter += `[out]`;
            }

            args.push('-filter_complex', svgaFilter, '-map', '[out]');
            args.push('-r', exportFps.toString());
            args.push(outPattern);
            
            let ffmpegLogs = '';
            const logHandler = ({ message }: { message: string }) => { ffmpegLogs += message + '\n'; };
            ffmpeg.on('log', logHandler);
            
            const ret = await ffmpeg.exec(args);
            ffmpeg.off('log', logHandler);
            
            if (ret !== 0) {
               console.error(ffmpegLogs);
               throw new Error(`FFmpeg error extracting frames: code ${ret}`);
            }
            
            const files = await ffmpeg.listDir('.');
            const frameFiles = files.filter(f => !f.isDir && f.name.startsWith('frame_') && f.name.endsWith('.png')).sort((a: any, b: any) => a.name.localeCompare(b.name));
            
            if (frameFiles.length > 0) {
                const imagesMap: Record<string, Uint8Array> = {};
                const sprites: any[] = [];
                let imgW = 0, imgH = 0;

                for (let i = 0; i < frameFiles.length; i++) {
                    const f = frameFiles[i];
                    const data = await ffmpeg.readFile(f.name) as Uint8Array;
                    if (i === 0) {
                        const dims = await new Promise<{w: number, h: number}>((resolve, reject) => {
                            const blob = new Blob([data], {type: 'image/png'});
                             const url = URL.createObjectURL(blob);
                             const img = new Image();
                             img.onload = () => { resolve({w: img.width, h: img.height}); URL.revokeObjectURL(url); };
                             img.onerror = () => reject("Failed");
                             img.src = url;
                        });
                        imgW = dims.w; imgH = dims.h;
                    }
                    
                    const imageKey = `img_${i}`;
                    imagesMap[imageKey] = data;
                    
                    const frames = [];
                    for (let fIdx = 0; fIdx < frameFiles.length; fIdx++) {
                        frames.push({
                            alpha: fIdx === i ? 1 : 0,
                            layout: { x: 0, y: 0, width: imgW, height: imgH },
                            transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
                        });
                    }
                    
                    sprites.push({
                        imageKey,
                        frames
                    });
                    
                    ffmpeg.deleteFile(f.name);
                }
                
                const movieData = {
                    version: "2.0",
                    params: {
                        viewBoxWidth: imgW,
                        viewBoxHeight: imgH,
                        fps: exportFps,
                        frames: frameFiles.length
                    },
                    images: imagesMap,
                    sprites: sprites
                };
                
                const svgaBlob = await encodeSVGA(movieData);
                const url = URL.createObjectURL(svgaBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${baseName}.svga`;
                link.click();
            } else {
               throw new Error("No frames extracted");
            }
        } else {
            alert('عفواً، هذه الصيغة (' + convertFormat + ') غير مدعومة للتصدير في هذه النسخة حالياً. يرجى اختيار صيغة مدعومة مثل:  SVGA 2.0, VAP 1.0.5, GIF, WebM, WebP, APNG, أو Image Sequence.');
        }

        ffmpeg.deleteFile(inputName);
    } catch (err) {
        console.error(err);
        alert('حدث خطأ أثناء المعالجة!');
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0F14] text-white flex flex-col font-sans overflow-hidden">
      <div className="flex-1 overflow-auto flex flex-col">
        {!file ? (
          // Uploader Area
          <div className="flex-1 flex flex-col items-center justify-center relative px-4 z-10 w-full h-full">
             <div className="absolute top-6 left-6 z-20">
               <div className="flex items-center gap-2 cursor-pointer transition select-none hover:opacity-80 bg-slate-900/50 p-2 pr-4 rounded-full border border-white/5" onClick={onCancel}>
                 <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg">
                   <RefreshCw className="w-4 h-4 text-white" />
                 </div>
                 <span className="font-bold tracking-tight text-slate-300">Back</span>
               </div>
             </div>
             
             {/* Background decorative dots */}
             <div className="absolute inset-0 pointer-events-none opacity-20" style={{ backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)', backgroundSize: '50px 50px' }}></div>
             
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="relative z-10 flex flex-col items-center max-w-4xl w-full"
             >
                <div className="flex flex-wrap justify-center gap-2 mb-8 items-center text-[10px] sm:text-xs">
                  {['PAG', 'SVGA', 'Lottie', 'VAP', 'YYEVA', 'Dual Channel', 'GIF', 'WebP', 'MP4', 'MKV', 'Image Sequence', '.ZIP'].map(tag => (
                    <span key={tag} className="px-3 py-1 rounded bg-slate-800/80 text-sky-400 font-mono border border-slate-700/50 shadow-inner">
                      {tag}
                    </span>
                  ))}
                </div>
                
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white text-center mb-4 tracking-tight drop-shadow-2xl">Universal Motion Tools</h1>
                <p className="text-lg md:text-xl text-slate-400 text-center mb-16 shadow-black drop-shadow-md font-arabic" dir="rtl">
                   بيئة احترافية شاملة لمعاينة وضغط وتحويل كافة صيغ الأنيميشن بسهولة.
                </p>
                
                <div 
                   onDragOver={(e) => e.preventDefault()}
                   onDrop={handleFileDrop}
                   onClick={() => fileInputRef.current?.click()}
                   className="w-48 h-48 md:w-64 md:h-64 rounded-full border border-purple-500/30 flex items-center justify-center cursor-pointer hover:bg-purple-900/10 transition group z-20 relative shadow-2xl"
                >
                   <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-tr from-purple-800 to-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform duration-300 shadow-[0_0_50px_-10px_rgba(192,38,211,0.5)] border border-white/10 pointer-events-none">
                      <Upload className="w-10 h-10 md:w-16 md:h-16 text-white/90 drop-shadow-md group-hover:-translate-y-2 transition-transform duration-300" />
                   </div>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
             </motion.div>
          </div>
        ) : (
          // Workspace Area
          <div className="flex-1 flex w-full h-screen relative overflow-hidden flex-col md:flex-row">
            
            {/* Main Preview Area */}
            <div className="flex-1 flex flex-col bg-[#0b0c10] relative overflow-hidden">
               {/* Header in Preview */}
               <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-[#0b0c10]/80 backdrop-blur-md absolute top-0 left-0 right-0 z-20">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <Box className="w-4 h-4 text-white" />
                   </div>
                   <h1 className="font-bold text-slate-200 tracking-tight text-sm sm:text-base">Universal Motion Workspace</h1>
                 </div>
                 <div className="flex gap-2">
                   <button onClick={handleDownloadImages} disabled={isProcessing} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-[#1A1C23] border border-white/10 hover:bg-slate-800 hover:border-white/20 rounded-lg transition disabled:opacity-50 text-xs sm:text-sm font-bold text-slate-300 shadow-sm">
                     {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4 text-emerald-400" />}
                     <span className="hidden sm:inline">Download Sequence (ZIP)</span>
                     <span className="sm:hidden">Images</span>
                   </button>
                 </div>
               </div>

               {/* Canvas */}
               <div className="flex-1 flex items-center justify-center p-4 sm:p-12 pt-20">
                 <div className="w-full h-full max-w-5xl aspect-video lg:aspect-auto lg:max-h-[80%] flex items-center justify-center rounded-2xl bg-black/40 overflow-hidden shadow-2xl relative border border-white/5" 
                      style={{ backgroundImage: 'linear-gradient(45deg, #181a20 25%, transparent 25%), linear-gradient(-45deg, #181a20 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #181a20 75%), linear-gradient(-45deg, transparent 75%, #181a20 75%)', backgroundSize: '30px 30px', backgroundPosition: '0 0, 0 15px, 15px -15px, -15px 0px' }}>
                    
                    {fileInfo.format === 'SVGA' ? (
                       <SVGAPlayer data={fileUrl} className="w-full h-full max-w-[80%] max-h-[80%]" />
                    ) : (fileInfo.format === 'MP4' || fileInfo.format === 'WebM' || fileInfo.format.startsWith('video')) ? (
                       alphaMode === 'none' ? (
                         <video src={fileUrl} controls autoPlay loop className="w-[80%] h-[80%] object-contain shadow-2xl rounded mx-auto" />
                       ) : (
                         <VapPlayer src={fileUrl} className="w-full h-full max-w-[80%] max-h-[80%]" alphaMode={alphaMode} />
                       )
                    ) : fileInfo.format.includes('image') ? (
                       <img src={fileUrl} className="max-w-[80%] max-h-[80%] object-contain drop-shadow-2xl" />
                    ) : (
                       <div className="text-slate-400 flex flex-col items-center">
                           <Box className="w-16 h-16 mb-4 opacity-50 text-indigo-400" />
                           <p className="font-bold tracking-tight text-white mb-2 py-1 px-4 bg-slate-800 rounded-full text-xs">File loaded: {fileInfo.name}</p>
                           <p className="text-[10px] text-slate-500">Preview not available for this format</p>
                       </div>
                    )}
                 </div>
               </div>
            </div>

            {/* Right Sidebar */}
            <div className="w-full md:w-80 lg:w-96 bg-[#14151B] border-t md:border-t-0 md:border-l border-white/5 shrink-0 flex flex-col h-full z-30 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative">
                
                {/* Info & Change File */}
                <div className="p-5 border-b border-white/5 bg-[#1A1C23]/80 backdrop-blur-sm z-10 shrink-0">
                   <div className="flex justify-between items-start mb-4">
                     <div className="flex-1 min-w-0 pr-2">
                        <h3 className="text-white font-bold text-xs uppercase tracking-wider mb-1">Source File</h3>
                        <p className="text-xs text-slate-400 font-mono truncate" title={fileInfo.name}>{fileInfo.name}</p>
                     </div>
                     <div className="text-right shrink-0">
                        <span className="text-[10px] font-mono font-bold bg-[#0E0F14] text-slate-300 px-2 py-1 rounded border border-white/10 shadow-inner">{fileInfo.size}</span>
                     </div>
                   </div>
                   <button 
                     onClick={() => { setFile(null); if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(''); }} 
                     className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0E0F14] hover:bg-slate-800 border border-white/10 hover:border-white/20 rounded-lg text-xs font-bold text-slate-300 transition-all shadow-sm"
                   >
                      <Upload className="w-4 h-4 text-indigo-400" />
                      Upload Different File
                   </button>
                </div>

                {/* Settings Scrollable Region */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-8">
                    
                    {/* Format Selection - Grid so everything is visible! */}
                    <div className="flex flex-col gap-3">
                       <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Export Format</h3>
                       <div className="grid grid-cols-2 gap-2">
                         {availableFormats.map((fmt) => {
                            const isActive = convertFormat === fmt;
                            return (
                               <button 
                                 key={fmt}
                                 onClick={() => setConvertFormat(fmt)}
                                 className={`relative flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left group overflow-hidden ${
                                   isActive ? 'bg-indigo-600/10 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.15)] ring-1 ring-indigo-500/50' : 'bg-[#1A1C23] border-white/5 hover:border-white/20 hover:bg-slate-800/80'
                                 }`}
                               >
                                 <div className={`w-7 h-7 rounded flex items-center justify-center shrink-0 transition-colors ${isActive ? 'bg-indigo-500 text-white shadow-md' : 'bg-[#0E0F14] text-slate-400 group-hover:text-slate-300'}`}>
                                   {fmt.includes('Video') || fmt.includes('VAP') || fmt.includes('YYEVA') ? <Play className="w-3.5 h-3.5 ml-0.5" /> : 
                                    fmt.includes('SVGA') ? <Box className="w-3.5 h-3.5" /> :
                                    fmt.includes('Image') || fmt.includes('GIF') || fmt.includes('Anim') ? <ImageIcon className="w-3.5 h-3.5" /> : 
                                    <Upload className="w-3.5 h-3.5" />}
                                 </div>
                                 <span className={`font-bold text-[11px] leading-tight flex-1 ${isActive ? 'text-indigo-100' : 'text-slate-400 group-hover:text-slate-200'}`}>{fmt}</span>
                               </button>
                            )
                         })}
                       </div>
                    </div>

                    {/* Alpha Selector (if video) */}
                    {(fileInfo.format === 'MP4' || fileInfo.format === 'WebM' || fileInfo.format.startsWith('video')) && (
                      <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2">
                         <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Alpha & Background</h3>
                         <div className="relative">
                            <select 
                              value={alphaMode} 
                              onChange={(e) => setAlphaMode(e.target.value as any)}
                              className="w-full bg-[#1A1C23] border border-white/10 rounded-xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer appearance-none font-medium shadow-sm"
                              style={{backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem top 50%', backgroundSize: '0.65rem auto'}}
                            >
                               <option value="none">Opaque (No extraction)</option>
                               <option value="right">Transparent Video (Alpha Right)</option>
                               <option value="left">Transparent Video (Alpha Left)</option>
                               <option value="bottom">Transparent Video (Alpha Bottom)</option>
                               <option value="top">Transparent Video (Alpha Top)</option>
                               <option value="white">Remove White Background</option>
                               <option value="black">Remove Black Background</option>
                               <option value="green">Remove Green Chroma</option>
                            </select>
                         </div>
                      </div>
                    )}

                    {/* Adjustments (Sliders) */}
                    <div className="flex flex-col gap-6">
                       <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Adjustments</h3>

                       <div className="flex flex-col gap-3 bg-[#1A1C23] p-4 rounded-xl border border-white/5">
                          <div className="flex justify-between text-xs font-bold font-mono">
                            <span className="text-slate-400">Target FPS</span>
                            <span className="text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded">{exportFps}</span>
                          </div>
                          <input 
                            type="range" min="1" max="60" 
                            value={exportFps} onChange={(e) => setExportFps(Number(e.target.value))}
                            className="w-full h-1.5 bg-[#0E0F14] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-sky-400 [&::-webkit-slider-thumb]:rounded-full cursor-pointer hover:[&::-webkit-slider-thumb]:scale-110 transition-all [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(56,189,248,0.5)]"
                          />
                       </div>

                       <div className="flex flex-col gap-3 bg-[#1A1C23] p-4 rounded-xl border border-white/5">
                          <div className="flex justify-between text-xs font-bold font-mono">
                            <span className="text-slate-400">Quality / Compression</span>
                            <span className={`px-2 py-0.5 rounded ${compressionQuality < 90 ? 'text-emerald-400 bg-emerald-400/10' : 'text-indigo-400 bg-indigo-400/10'}`}>{compressionQuality}%</span>
                          </div>
                          <input 
                            type="range" min="1" max="100" 
                            value={compressionQuality} onChange={(e) => setCompressionQuality(Number(e.target.value))}
                            className="w-full h-1.5 bg-[#0E0F14] rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:rounded-full cursor-pointer hover:[&::-webkit-slider-thumb]:scale-110 transition-all [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                          />
                       </div>
                    </div>

                </div>

                {/* Bottom Export Button */}
                <div className="p-5 border-t border-white/5 bg-[#1A1C23]/80 backdrop-blur-sm shrink-0">
                    <button 
                       onClick={handleStartConversion} 
                       disabled={isProcessing}
                       className="w-full relative group overflow-hidden bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-4 px-4 rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                       {isProcessing ? (
                          <>
                            <RefreshCw className="w-5 h-5 animate-spin" />
                            <span>Processing...</span>
                          </>
                       ) : (
                          <>
                            <Download className="w-5 h-5" />
                            <span>Export {convertFormat.split(' ')[0]}</span>
                          </>
                       )}
                       {!isProcessing && (
                         <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 pointer-events-none rounded-xl" />
                       )}
                    </button>
                    <p className="text-center text-[10px] text-slate-500 mt-4 flex items-center justify-center gap-1.5 uppercase tracking-wider font-bold">
                      <Layers className="w-3 h-3 text-slate-400" /> GPU Accelerated Workspace
                    </p>
                </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
};
