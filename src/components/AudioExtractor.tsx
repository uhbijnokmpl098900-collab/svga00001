import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, X, Music, Play, Pause, Settings, Download, Trash2, 
  Volume2, FastForward, CheckCircle, AlertCircle, FileAudio, 
  Archive, Loader2, ArrowRight, Video, Scissors, FileCode
} from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { loadFFmpegWithFallbacks } from '../utils/ffmpegLoader';
import { UserRecord } from '../types';
import JSZip from 'jszip';
import { logActivity } from '../utils/logger';
import WaveSurfer from 'wavesurfer.js';

interface AudioExtractorProps {
  currentUser: UserRecord | null;
  onCancel: () => void;
  onSubscriptionRequired: () => void;
}

interface ExportSettings {
  format: string;
  bitrate: string;
  sampleRate: string;
  channels: string;
  startTime: number;
  endTime: number;
}

interface AudioFileItem {
  id: string;
  originalName: string;
  videoFile: File;
  status: 'pending' | 'extracting' | 'ready' | 'exporting' | 'completed' | 'error';
  progress: number;
  previewUrl?: string; // fast extracted wav for preview
  finalBlob?: Blob; // final exported file
  finalExt?: string;
  duration: number;
  error?: string;
  settings: ExportSettings;
}

const AUDIO_FORMATS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'];
const BITRATES = ['96k', '128k', '192k', '256k', '320k'];
const SAMPLE_RATES = ['original', '44100', '48000'];
const CHANNELS = ['original', '1', '2'];

export const AudioExtractor: React.FC<AudioExtractorProps> = ({ currentUser, onCancel, onSubscriptionRequired }) => {
  const [files, setFiles] = useState<AudioFileItem[]>([]);
  const [isFfmpegLoaded, setIsFfmpegLoaded] = useState(false);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  useEffect(() => {
    const initFfmpeg = async () => {
      const ffmpeg = new FFmpeg();
      try {
        await loadFFmpegWithFallbacks(ffmpeg);
        ffmpegRef.current = ffmpeg;
        setIsFfmpegLoaded(true);
      } catch (err) {
        console.error("Failed to load FFmpeg", err);
      }
    };
    initFfmpeg();
    
    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
    };
  }, []);

  const handleFileUpload = (newFiles: FileList | File[]) => {
    const newItems: AudioFileItem[] = Array.from(newFiles)
      .filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/'))
      .map(file => ({
        id: Math.random().toString(36).substring(2, 9),
        originalName: file.name,
        videoFile: file,
        status: 'pending',
        progress: 0,
        duration: 0,
        settings: {
          format: 'mp3',
          bitrate: '192k',
          sampleRate: 'original',
          channels: 'original',
          startTime: 0,
          endTime: 0
        }
      }));
      
    if (newItems.length > 0) {
      setFiles(prev => [...prev, ...newItems]);
      if (!activeFileId) {
        setActiveFileId(newItems[0].id);
      }
    }
  };

  // Automatically start extraction for pending files when FFmpeg is ready
  useEffect(() => {
    if (!isFfmpegLoaded) return;
    
    const pendingFiles = files.filter(f => f.status === 'pending');
    pendingFiles.forEach(f => {
      handleExtractPreview(f.id);
    });
  }, [files, isFfmpegLoaded]);

  const handleExtractPreview = async (id: string) => {
    if (!ffmpegRef.current || !isFfmpegLoaded) return;
    const ffmpeg = ffmpegRef.current;
    
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'extracting', progress: 0 } : f));
    
    const fileItem = files.find(f => f.id === id);
    if (!fileItem) return;

    try {
      const ext = fileItem.videoFile.name.split('.').pop() || 'mp4';
      const inputName = `input_${id}.${ext}`;
      const outputName = `preview_${id}.wav`;
      
      await ffmpeg.writeFile(inputName, await fetchFile(fileItem.videoFile));
      
      const progressHandler = (ev: any) => {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: Math.round(ev.progress * 100) } : f));
      };
      
      ffmpeg.on('progress', progressHandler);

      // Extract to wav for accurate preview
      const code = await ffmpeg.exec([
        '-i', inputName,
        '-vn', // no video
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '2',
        outputName
      ]);
      
      ffmpeg.off('progress', progressHandler);
      
      if (code !== 0) {
        throw new Error('FFmpeg exited with code ' + code);
      }
      
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data], { type: 'audio/wav' });
      const previewUrl = URL.createObjectURL(blob);
      
      setFiles(prev => prev.map(f => f.id === id ? { 
        ...f, 
        status: 'ready', 
        progress: 100, 
        previewUrl 
      } : f));
      
      // cleanup
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      
    } catch (err: any) {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === id ? { 
        ...f, 
        status: 'error', 
        error: 'فشل استخراج الصوت. تأكد من أن الفيديو يحتوي على مسار صوتي.' 
      } : f));
    }
  };

  const handleExportFinal = async (id: string) => {
    if (!ffmpegRef.current || !isFfmpegLoaded) return;
    const ffmpeg = ffmpegRef.current;
    
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'exporting', progress: 0 } : f));
    
    const fileItem = files.find(f => f.id === id);
    if (!fileItem) return;

    try {
      // We process from original video to keep max quality
      const extIn = fileItem.videoFile.name.split('.').pop() || 'mp4';
      const inputName = `input_export_${id}.${extIn}`;
      const ext = fileItem.settings.format;
      const outputName = `final_${id}.${ext}`;
      
      await ffmpeg.writeFile(inputName, await fetchFile(fileItem.videoFile));
      
      const progressHandler = (ev: any) => {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: Math.round(ev.progress * 100) } : f));
      };
      
      ffmpeg.on('progress', progressHandler);

      const args = ['-i', inputName, '-vn'];
      
      // Trim
      if (fileItem.settings.startTime > 0) {
        args.push('-ss', fileItem.settings.startTime.toString());
      }
      if (fileItem.settings.endTime > 0 && fileItem.settings.endTime > fileItem.settings.startTime) {
        args.push('-to', fileItem.settings.endTime.toString());
      }

      // Audio settings
      if (fileItem.settings.sampleRate !== 'original') {
        args.push('-ar', fileItem.settings.sampleRate);
      }
      if (fileItem.settings.channels !== 'original') {
        args.push('-ac', fileItem.settings.channels);
      }

      // Codecs and bitrates
      if (ext === 'mp3') {
        args.push('-c:a', 'libmp3lame', '-b:a', fileItem.settings.bitrate);
      } else if (ext === 'aac' || ext === 'm4a') {
        args.push('-c:a', 'aac', '-b:a', fileItem.settings.bitrate);
      } else if (ext === 'ogg') {
        args.push('-c:a', 'libvorbis', '-q:a', '4');
      } else if (ext === 'flac') {
        args.push('-c:a', 'flac');
      } else if (ext === 'opus') {
        args.push('-c:a', 'libopus', '-b:a', fileItem.settings.bitrate);
      } else if (ext === 'wav') {
        args.push('-c:a', 'pcm_s16le');
      }

      args.push(outputName);
      
      const code = await ffmpeg.exec(args);
      
      ffmpeg.off('progress', progressHandler);
      
      if (code !== 0) {
        throw new Error('FFmpeg exited with code ' + code);
      }
      
      const data = await ffmpeg.readFile(outputName);
      const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : `audio/${ext}`;
      const blob = new Blob([data], { type: mime });
      
      setFiles(prev => prev.map(f => f.id === id ? { 
        ...f, 
        status: 'completed', 
        progress: 100, 
        finalBlob: blob,
        finalExt: ext
      } : f));
      
      logActivity(currentUser, 'feature_usage', `Audio Extracted: ${fileItem.originalName} -> ${ext}`);

      // cleanup
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      
    } catch (err: any) {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === id ? { 
        ...f, 
        status: 'error', 
        error: 'فشل تصدير الملف الصوتي.' 
      } : f));
    }
  };

  const handleExportAll = async () => {
    setIsProcessingAll(true);
    for (const f of files) {
      if (f.status === 'ready') {
        await handleExportFinal(f.id);
      }
    }
    setIsProcessingAll(false);
  };

  const handleDownloadZip = async () => {
    const completedFiles = files.filter(f => f.status === 'completed' && f.finalBlob);
    if (completedFiles.length === 0) return;
    
    const zip = new JSZip();
    completedFiles.forEach((f, idx) => {
      const originalBase = f.originalName.substring(0, f.originalName.lastIndexOf('.'));
      let fileName = `${originalBase}.${f.finalExt}`;
      // Prevent duplicates in zip
      if (zip.file(fileName)) {
        fileName = `${originalBase}_${idx}.${f.finalExt}`;
      }
      zip.file(fileName, f.finalBlob!);
    });
    
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted_audio.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSingle = (id: string) => {
    const file = files.find(f => f.id === id);
    if (!file || !file.finalBlob) return;
    
    const originalBase = file.originalName.substring(0, file.originalName.lastIndexOf('.'));
    const fileName = `${originalBase}.${file.finalExt}`;
    
    const url = URL.createObjectURL(file.finalBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // WaveSurfer initialization for active file
  useEffect(() => {
    const activeFile = files.find(f => f.id === activeFileId);
    
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);

    if (activeFile && activeFile.previewUrl && waveformRef.current) {
      wavesurferRef.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: 'rgba(99, 102, 241, 0.4)',
        progressColor: 'rgba(99, 102, 241, 1)',
        cursorColor: '#ffffff',
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
        normalize: true,
      });

      wavesurferRef.current.load(activeFile.previewUrl);
      
      wavesurferRef.current.on('ready', () => {
        const duration = wavesurferRef.current?.getDuration() || 0;
        setFiles(prev => prev.map(f => f.id === activeFile.id ? { 
          ...f, 
          duration,
          settings: { ...f.settings, endTime: duration } 
        } : f));
      });

      wavesurferRef.current.on('play', () => setIsPlaying(true));
      wavesurferRef.current.on('pause', () => setIsPlaying(false));
      wavesurferRef.current.on('audioprocess', (time) => setCurrentTime(time));
      wavesurferRef.current.on('seek', (time) => setCurrentTime(time));
    }
  }, [activeFileId, files.find(f => f.id === activeFileId)?.previewUrl]);

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  const updateSettings = (id: string, newSettings: Partial<ExportSettings>) => {
    setFiles(prev => prev.map(f => f.id === id ? {
      ...f,
      settings: { ...f.settings, ...newSettings }
    } : f));
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const activeFile = files.find(f => f.id === activeFileId);

  return (
    <div className="w-full flex justify-center pb-24 pt-4 px-4 sm:px-8 font-sans text-slate-200" dir="rtl">
      <div className="max-w-[1400px] w-full flex flex-col gap-8">
        
        <header className="flex justify-between items-center bg-slate-900/50 p-6 rounded-[2rem] border border-white/5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-indigo-500/20 text-indigo-400 rounded-2xl border border-indigo-500/30">
              <FileAudio className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-wide">استخراج الصوت من الفيديو</h1>
              <p className="text-sm text-slate-400 mt-1">نظام احترافي لاستخراج وتحويل المسارات الصوتية من أي فيديو.</p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10"
          >
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Files List & Uploader */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            <div 
              className={`relative border-2 border-dashed rounded-[2rem] p-8 text-center transition-all duration-300 flex flex-col items-center justify-center min-h-[200px] cursor-pointer
                ${isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-600 bg-slate-800/40 hover:bg-slate-800/60 hover:border-slate-500'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFileUpload(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                multiple 
                accept="video/*,audio/*"
                onChange={(e) => {
                  if (e.target.files) handleFileUpload(e.target.files);
                }}
              />
              <Upload className="w-12 h-12 text-indigo-400 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">ارفع الفيديوهات هنا</h3>
              <p className="text-sm text-slate-400">سحب وإفلات أو اضغط للاختيار</p>
            </div>

            {files.length > 0 && (
              <div className="bg-slate-900/50 rounded-[2rem] border border-white/5 overflow-hidden flex flex-col max-h-[600px]">
                <div className="p-5 border-b border-white/5 flex justify-between items-center bg-slate-800/50">
                  <h3 className="font-bold text-white">قائمة الملفات ({files.length})</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleExportAll}
                      disabled={isProcessingAll || !files.some(f => f.status === 'ready')}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
                    >
                      {isProcessingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                      تصدير الكل
                    </button>
                    {files.some(f => f.status === 'completed') && (
                      <button 
                        onClick={handleDownloadZip}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
                      >
                        <Archive className="w-4 h-4" />
                        ZIP
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-y-auto p-2 flex flex-col gap-2 flex-grow">
                  {files.map(file => (
                    <div 
                      key={file.id}
                      onClick={() => setActiveFileId(file.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-3 ${
                        activeFileId === file.id 
                          ? 'bg-indigo-500/20 border-indigo-500/50 shadow-lg' 
                          : 'bg-slate-800/40 border-white/5 hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-700/50 flex items-center justify-center shrink-0">
                          <Video className="w-5 h-5 text-slate-300" />
                        </div>
                        <div className="flex-grow min-w-0">
                          <p className="text-sm font-bold text-white truncate" dir="ltr" style={{ textAlign: 'right' }}>{file.originalName}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            {(file.videoFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setFiles(files.filter(f => f.id !== file.id))}}
                          className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Status / Actions */}
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center gap-2">
                          {file.status === 'pending' && <span className="text-xs text-slate-400 px-2 py-1 bg-slate-700/50 rounded-md">في الانتظار</span>}
                          {(file.status === 'extracting' || file.status === 'exporting') && (
                            <span className="text-xs text-indigo-400 px-2 py-1 bg-indigo-500/10 rounded-md flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" /> {file.progress}%
                            </span>
                          )}
                          {file.status === 'ready' && <span className="text-xs text-emerald-400 px-2 py-1 bg-emerald-500/10 rounded-md flex items-center gap-1"><CheckCircle className="w-3 h-3" /> جاهز</span>}
                          {file.status === 'completed' && <span className="text-xs text-emerald-400 px-2 py-1 bg-emerald-500/10 rounded-md flex items-center gap-1"><Download className="w-3 h-3" /> مكتمل</span>}
                          {file.status === 'error' && <span className="text-xs text-red-400 px-2 py-1 bg-red-500/10 rounded-md">{file.error}</span>}
                        </div>
                        
                        {file.status === 'pending' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleExtractPreview(file.id); }}
                            className="text-xs font-bold px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                          >
                            استخراج
                          </button>
                        )}
                        {file.status === 'completed' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDownloadSingle(file.id); }}
                            className="text-xs font-bold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                          >
                            تحميل
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Player & Settings */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {!activeFile ? (
              <div className="h-full min-h-[400px] flex flex-col justify-center items-center bg-slate-900/50 rounded-[2rem] border border-white/5">
                <Music className="w-16 h-16 text-slate-700 mb-4" />
                <p className="text-lg text-slate-400">اختر ملفاً من القائمة للبدء</p>
              </div>
            ) : (
              <>
                {/* Audio Player Section */}
                <div className="bg-slate-900/80 rounded-[2rem] border border-white/10 p-6 sm:p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                  
                  <div className="flex justify-between items-start relative z-10">
                    <div>
                      <h2 className="text-2xl font-bold text-white mb-1 truncate max-w-[300px] sm:max-w-[500px]" dir="ltr" style={{ textAlign: 'right' }}>
                        {activeFile.originalName}
                      </h2>
                      <p className="text-sm text-slate-400">
                        {activeFile.status === 'ready' || activeFile.status === 'completed' ? `مدة الصوت: ${formatTime(activeFile.duration)}` : 'جاري التحضير...'}
                      </p>
                    </div>
                    {activeFile.status === 'pending' && (
                      <button 
                        onClick={() => handleExtractPreview(activeFile.id)}
                        disabled={!isFfmpegLoaded}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:opacity-50 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg transition-all hover:scale-105"
                      >
                        {isFfmpegLoaded ? (
                          <><Scissors className="w-5 h-5" /> استخراج ومعاينة</>
                        ) : (
                          <><Loader2 className="w-5 h-5 animate-spin" /> جاري تحميل المحرك...</>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="w-full bg-slate-950/50 rounded-2xl p-4 border border-white/5 min-h-[120px] relative flex flex-col justify-center">
                    {activeFile.status === 'extracting' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 rounded-2xl backdrop-blur-sm z-20">
                        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
                        <p className="text-sm font-bold text-indigo-300">جاري استخراج المسار الصوتي... {activeFile.progress}%</p>
                      </div>
                    )}
                    <div ref={waveformRef} className="w-full" />
                  </div>

                  <div className="flex items-center justify-between">
                    <button 
                      onClick={togglePlay}
                      disabled={!activeFile.previewUrl}
                      className="w-14 h-14 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:opacity-50 text-white rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    >
                      {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                    </button>
                    <div className="text-2xl font-mono text-indigo-300 tracking-wider">
                      {formatTime(currentTime)} <span className="text-slate-500 text-lg">/ {formatTime(activeFile.duration)}</span>
                    </div>
                  </div>
                </div>

                {/* Export Settings */}
                {(activeFile.status === 'ready' || activeFile.status === 'completed' || activeFile.status === 'exporting') && (
                  <div className="bg-slate-900/50 rounded-[2rem] border border-white/5 p-6 sm:p-8 flex flex-col gap-8">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <Settings className="w-6 h-6 text-indigo-400" /> إعدادات التصدير
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      {/* Format */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-bold">الصيغة</label>
                        <select 
                          value={activeFile.settings.format}
                          onChange={(e) => updateSettings(activeFile.id, { format: e.target.value })}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        >
                          {AUDIO_FORMATS.map(fmt => (
                            <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>

                      {/* Bitrate */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-bold">الجودة (Bitrate)</label>
                        <select 
                          value={activeFile.settings.bitrate}
                          onChange={(e) => updateSettings(activeFile.id, { bitrate: e.target.value })}
                          disabled={['wav', 'flac'].includes(activeFile.settings.format)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
                        >
                          {BITRATES.map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>

                      {/* Sample Rate */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-bold">معدل العينة</label>
                        <select 
                          value={activeFile.settings.sampleRate}
                          onChange={(e) => updateSettings(activeFile.id, { sampleRate: e.target.value })}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        >
                          <option value="original">Original</option>
                          <option value="44100">44.1 kHz</option>
                          <option value="48000">48 kHz</option>
                        </select>
                      </div>

                      {/* Channels */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-bold">القنوات</label>
                        <select 
                          value={activeFile.settings.channels}
                          onChange={(e) => updateSettings(activeFile.id, { channels: e.target.value })}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        >
                          <option value="original">Original</option>
                          <option value="1">Mono (1)</option>
                          <option value="2">Stereo (2)</option>
                        </select>
                      </div>
                    </div>

                    {/* Trimming */}
                    <div className="p-5 bg-slate-800/40 rounded-2xl border border-white/5">
                      <h4 className="text-sm font-bold text-white mb-4">اقتطاع الصوت (اختياري)</h4>
                      <div className="flex flex-col sm:flex-row gap-6 items-center">
                        <div className="flex flex-col gap-2 w-full">
                          <label className="text-xs text-slate-400">البداية (ثانية)</label>
                          <input 
                            type="number"
                            min="0"
                            max={activeFile.settings.endTime || activeFile.duration}
                            step="0.1"
                            value={activeFile.settings.startTime}
                            onChange={(e) => updateSettings(activeFile.id, { startTime: Number(e.target.value) })}
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-white focus:border-indigo-500"
                          />
                        </div>
                        <ArrowRight className="w-5 h-5 text-slate-600 shrink-0 hidden sm:block rotate-180" />
                        <div className="flex flex-col gap-2 w-full">
                          <label className="text-xs text-slate-400">النهاية (ثانية)</label>
                          <input 
                            type="number"
                            min={activeFile.settings.startTime}
                            max={activeFile.duration}
                            step="0.1"
                            value={activeFile.settings.endTime}
                            onChange={(e) => updateSettings(activeFile.id, { endTime: Number(e.target.value) })}
                            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2 text-white focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="flex justify-end pt-4 mt-2 border-t border-white/10">
                      {activeFile.status === 'completed' ? (
                        <div className="flex gap-4 w-full sm:w-auto">
                          <button 
                            onClick={() => handleExportFinal(activeFile.id)}
                            className="px-6 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl flex-grow sm:flex-none transition-all flex items-center justify-center gap-2"
                          >
                            تصدير بصيغة أخرى
                          </button>
                          <button 
                            onClick={() => handleDownloadSingle(activeFile.id)}
                            className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex-grow sm:flex-none shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 flex items-center justify-center gap-2"
                          >
                            <Download className="w-5 h-5" /> تحميل الملف
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => handleExportFinal(activeFile.id)}
                          disabled={activeFile.status === 'exporting'}
                          className="w-full sm:w-auto px-10 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all hover:scale-105 flex items-center justify-center gap-2"
                        >
                          {activeFile.status === 'exporting' ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> جاري التصدير {activeFile.progress}%</>
                          ) : (
                            <><FileCode className="w-5 h-5" /> بدء التصدير</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
