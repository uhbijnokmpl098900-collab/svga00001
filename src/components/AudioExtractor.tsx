import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Music, Settings, Download, Trash2, Loader2, FileAudio, AlertCircle, Video, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserRecord } from '../types';
import { logActivity } from '../utils/logger';

interface AudioExtractorProps {
  currentUser: UserRecord | null;
  onCancel: () => void;
  onSubscriptionRequired: () => void;
}

interface ExportSettings {
  format: string;
  bitrate: string;
}

interface AudioFileItem {
  id: string;
  originalName: string;
  videoFile: File;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  finalExt?: string;
  jobId?: string;
  error?: string;
  settings: ExportSettings;
}

const AUDIO_FORMATS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'];
const BITRATES = ['96k', '128k', '192k', '256k', '320k'];

export const AudioExtractor: React.FC<AudioExtractorProps> = ({ currentUser, onCancel }) => {
  const [files, setFiles] = useState<AudioFileItem[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pollIntervalRefs = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const handleFileUpload = (newFiles: FileList | File[]) => {
    const validExtensions = /\.(mp4|mov|mkv|avi)$/i;
    const newItems: AudioFileItem[] = Array.from(newFiles)
      .filter(f => f.type.startsWith('video/') || f.name.match(validExtensions))
      .map(file => ({
        id: Math.random().toString(36).substring(2, 9),
        originalName: file.name,
        videoFile: file,
        status: 'pending',
        progress: 0,
        settings: {
          format: 'mp3',
          bitrate: '192k'
        }
      }));
      
    if (newItems.length > 0) {
      setFiles(prev => [...prev, ...newItems]);
      if (!activeFileId) {
        setActiveFileId(newItems[0].id);
      }
    } else {
      alert("الرجاء رفع ملف فيديو صالح (MP4, MOV, MKV, AVI).");
    }
  };

  const startExtraction = (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (!fileItem || fileItem.status === 'uploading' || fileItem.status === 'processing') return;

    if (fileItem.videoFile.size > 500 * 1024 * 1024) {
      updateFile(id, { status: 'error', error: 'حجم الملف يتجاوز 500 ميغابايت.' });
      return;
    }

    updateFile(id, { status: 'uploading', progress: 0, error: undefined });

    const formData = new FormData();
    formData.append('video', fileItem.videoFile);
    formData.append('format', fileItem.settings.format);
    if (fileItem.settings.format === 'mp3' || fileItem.settings.format === 'aac' || fileItem.settings.format === 'm4a' || fileItem.settings.format === 'opus') {
      formData.append('quality', fileItem.settings.bitrate);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/audio/extract', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        updateFile(id, { progress: percentComplete });
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        updateFile(id, { status: 'processing', progress: 0, jobId: response.jobId });
        pollStatus(id, response.jobId);
        logActivity(currentUser, 'feature_usage', `Audio Extracted: ${fileItem.originalName}`);
      } else {
        const response = JSON.parse(xhr.responseText);
        updateFile(id, { status: 'error', error: response.error || 'حدث خطأ أثناء رفع الملف.' });
      }
    };

    xhr.onerror = () => {
      updateFile(id, { status: 'error', error: 'فشل الاتصال بالخادم. تأكد من اتصالك بالإنترنت.' });
    };

    xhr.send(formData);
  };

  const pollStatus = (fileId: string, jobId: string) => {
    if (pollIntervalRefs.current[fileId]) clearInterval(pollIntervalRefs.current[fileId]);

    pollIntervalRefs.current[fileId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/audio/status/${jobId}`);
        if (!res.ok) throw new Error('Failed to fetch status');
        const job = await res.json();

        updateFile(fileId, { progress: job.progress });

        if (job.status === 'completed') {
          clearInterval(pollIntervalRefs.current[fileId]);
          updateFile(fileId, { status: 'completed', progress: 100, finalExt: job.format });
        } else if (job.status === 'failed') {
          clearInterval(pollIntervalRefs.current[fileId]);
          updateFile(fileId, { status: 'error', error: job.error || 'فشل استخراج الصوت' });
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);
  };

  const updateFile = (id: string, updates: Partial<AudioFileItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const updateSettings = (id: string, newSettings: Partial<ExportSettings>) => {
    setFiles(prev => prev.map(f => f.id === id ? {
      ...f,
      settings: { ...f.settings, ...newSettings }
    } : f));
  };

  const handleDownloadSingle = (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (!fileItem || !fileItem.jobId) return;
    window.location.href = `/api/audio/download/${fileItem.jobId}`;
  };

  const handleExportAll = () => {
    files.forEach(f => {
      if (f.status === 'pending' || f.status === 'error') {
        startExtraction(f.id);
      }
    });
  };

  useEffect(() => {
    return () => {
      Object.values(pollIntervalRefs.current).forEach(clearInterval);
    };
  }, []);

  const activeFile = files.find(f => f.id === activeFileId);

  return (
    <div className="w-full flex justify-center pb-24 pt-4 px-4 sm:px-8 font-sans text-slate-200" dir="rtl">
      {/* Dynamic 3D Background Objects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
        <div className="absolute top-[20%] right-[10%] w-[30vw] h-[30vw] bg-fuchsia-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[20%] left-[10%] w-[40vw] h-[40vw] bg-blue-600/20 blur-[150px] rounded-full mix-blend-screen" />
      </div>

      <div className="max-w-[1400px] w-full flex flex-col gap-8 relative z-10">
        
        <header className="flex justify-between items-center bg-[#0d1220]/70 p-6 rounded-3xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-gradient-to-br from-fuchsia-500/20 to-blue-500/20 text-fuchsia-400 rounded-2xl border border-fuchsia-500/30 shadow-[0_0_20px_rgba(217,70,239,0.15)] relative overflow-hidden group">
              <div className="absolute inset-0 bg-fuchsia-400/20 scale-0 group-hover:scale-150 transition-transform duration-500 rounded-full" />
              <FileAudio className="w-8 h-8 relative z-10" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-wide bg-gradient-to-l from-white to-slate-400 bg-clip-text text-transparent">استوديو الصوت الذكي</h1>
              <p className="text-sm text-slate-400 mt-1">نظام سحابي متطور لاستخراج الصوتيات ومعالجتها بسرعة فائقة.</p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all border border-white/10 hover:border-white/20 hover:scale-105 active:scale-95"
          >
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Files List & Uploader */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            <div 
              className={`relative rounded-3xl p-8 text-center transition-all duration-300 flex flex-col items-center justify-center min-h-[220px] cursor-pointer overflow-hidden group
                ${isDragging ? 'border-2 border-fuchsia-500 bg-fuchsia-500/10 scale-[1.02] shadow-[0_0_30px_rgba(217,70,239,0.2)]' : 'border border-white/10 bg-[#0d1220]/60 hover:bg-[#131b2f]/80 hover:border-fuchsia-500/50 backdrop-blur-xl'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFileUpload(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0d1220] opacity-50" />
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                multiple 
                accept="video/mp4,video/x-m4v,video/quicktime,.mkv,.avi"
                onChange={(e) => {
                  if (e.target.files) handleFileUpload(e.target.files);
                }}
              />
              <div className="relative z-10 flex flex-col items-center">
                <div className="w-20 h-20 mb-4 bg-gradient-to-br from-fuchsia-500/20 to-blue-500/20 rounded-full flex items-center justify-center border border-white/5 shadow-inner group-hover:shadow-[0_0_20px_rgba(217,70,239,0.3)] transition-all">
                  <Upload className="w-10 h-10 text-fuchsia-400 group-hover:-translate-y-1 transition-transform" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">ارفع الفيديوهات هنا</h3>
                <p className="text-sm text-slate-400">سحب وإفلات أو اضغط للاختيار</p>
                <div className="mt-3 text-xs text-slate-500 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                  أقصى حجم: 500MB | MP4, MKV, AVI
                </div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="bg-[#0d1220]/70 rounded-3xl border border-white/10 overflow-hidden flex flex-col max-h-[600px] backdrop-blur-xl shadow-2xl">
                <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/5">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.8)]" />
                    قائمة المعالجة ({files.length})
                  </h3>
                  <button 
                    onClick={handleExportAll}
                    disabled={!files.some(f => f.status === 'pending' || f.status === 'error')}
                    className="px-4 py-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-fuchsia-600/20"
                  >
                    استخراج الكل
                  </button>
                </div>
                <div className="overflow-y-auto p-3 flex flex-col gap-3 flex-grow">
                  <AnimatePresence>
                    {files.map(file => (
                      <motion.div 
                        key={file.id}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9, height: 0 }}
                        onClick={() => setActiveFileId(file.id)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-3 relative overflow-hidden group ${
                          activeFileId === file.id 
                            ? 'bg-gradient-to-br from-fuchsia-500/10 to-blue-500/10 border-fuchsia-500/30 shadow-[0_4px_20px_rgba(217,70,239,0.1)]' 
                            : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        {activeFileId === file.id && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-fuchsia-500 to-cyan-500" />
                        )}
                        
                        <div className="flex items-center gap-3 relative z-10">
                          <div className="w-12 h-12 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center shrink-0 shadow-inner">
                            <Video className="w-6 h-6 text-slate-300" />
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className="text-sm font-bold text-white truncate" dir="ltr" style={{ textAlign: 'right' }}>{file.originalName}</p>
                            <p className="text-xs text-slate-400 mt-1 font-mono">
                              {(file.videoFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setFiles(files.filter(f => f.id !== file.id))}}
                            className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Status / Actions */}
                        <div className="flex items-center justify-between mt-1 relative z-10">
                          <div className="flex items-center gap-2">
                            {file.status === 'pending' && <span className="text-xs text-slate-400 px-2 py-1 bg-black/30 rounded-md border border-white/5">في الانتظار</span>}
                            {file.status === 'uploading' && (
                              <span className="text-xs text-blue-400 px-2 py-1 bg-blue-500/10 rounded-md border border-blue-500/20 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> الرفع {file.progress}%
                              </span>
                            )}
                            {file.status === 'processing' && (
                              <span className="text-xs text-fuchsia-400 px-2 py-1 bg-fuchsia-500/10 rounded-md border border-fuchsia-500/20 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> معالجة {file.progress}%
                              </span>
                            )}
                            {file.status === 'completed' && <span className="text-xs text-emerald-400 px-2 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> مكتمل</span>}
                            {file.status === 'error' && <span className="text-xs text-red-400 px-2 py-1 bg-red-500/10 rounded-md border border-red-500/20">خطأ</span>}
                          </div>
                          
                          {(file.status === 'pending' || file.status === 'error') && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); startExtraction(file.id); }}
                              className="text-xs font-bold px-4 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg transition-colors shadow-lg shadow-fuchsia-600/20"
                            >
                              استخراج
                            </button>
                          )}
                          {file.status === 'completed' && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDownloadSingle(file.id); }}
                              className="text-xs font-bold px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors shadow-lg shadow-emerald-600/20"
                            >
                              تحميل
                            </button>
                          )}
                        </div>
                        
                        {/* Error Message inside card */}
                        {file.error && (
                          <div className="text-[10px] text-red-300 bg-red-500/10 p-2 rounded-lg mt-1">
                            {file.error}
                          </div>
                        )}
                        
                        {/* 3D Energy Progress Bar */}
                        {(file.status === 'uploading' || file.status === 'processing') && (
                          <div className="mt-4 flex flex-col gap-2 relative z-10">
                            <div className="w-full h-3 sm:h-4 bg-white/5 rounded-full overflow-hidden border border-white/10 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] backdrop-blur-md relative">
                              <motion.div 
                                className="h-full bg-gradient-to-r from-[#4DA3FF] via-[#8B5CF6] to-[#22D3EE] bg-[length:200%_100%] animate-[colorGradient_2s_linear_infinite] shadow-[0_0_15px_rgba(77,163,255,0.6)] relative"
                                initial={{ width: 0 }}
                                animate={{ width: `${file.progress}%` }}
                              >
                                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 mix-blend-overlay"></div>
                                <div className="absolute top-0 inset-x-0 h-[1px] bg-white/50"></div>
                              </motion.div>
                            </div>
                            <div className="flex justify-between items-center px-1">
                              <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">
                                {file.status === 'uploading' ? 'Uploading Media...' : 'Processing Audio...'}
                              </span>
                              <span className="text-[10px] sm:text-xs font-black text-[#4DA3FF] drop-shadow-[0_0_5px_rgba(77,163,255,0.5)]">
                                {file.progress}%
                              </span>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Settings */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {!activeFile ? (
              <div className="h-full min-h-[500px] flex flex-col justify-center items-center bg-[#0d1220]/50 rounded-3xl border border-white/5 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-fuchsia-900/10 via-[#0d1220]/0 to-transparent pointer-events-none" />
                <Music className="w-20 h-20 text-white/5 mb-6 animate-pulse" />
                <p className="text-xl text-slate-500 font-bold">اختر ملفاً من القائمة للإعدادات</p>
                <div className="mt-8 flex gap-4">
                  <div className="w-16 h-1 bg-gradient-to-r from-transparent via-fuchsia-500/30 to-transparent rounded-full" />
                  <div className="w-16 h-1 bg-gradient-to-r from-transparent via-blue-500/30 to-transparent rounded-full" />
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div 
                  key={activeFile.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-[#0d1220]/80 rounded-3xl border border-white/10 p-8 flex flex-col gap-8 shadow-2xl relative overflow-hidden backdrop-blur-xl h-full"
                >
                  <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-fuchsia-500/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none z-0" />
                  
                  <div className="flex justify-between items-start relative z-10 border-b border-white/10 pb-6">
                    <div>
                      <h2 className="text-3xl font-black text-white mb-2 truncate max-w-[300px] sm:max-w-[500px] drop-shadow-md" dir="ltr" style={{ textAlign: 'right' }}>
                        {activeFile.originalName}
                      </h2>
                      <p className="text-sm text-fuchsia-400 font-mono flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)] animate-pulse" />
                        الإعدادات النشطة
                      </p>
                    </div>
                  </div>

                  {/* Export Settings */}
                  <div className="relative z-10 flex flex-col gap-8 flex-grow">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      
                      {/* Format Selection */}
                      <div className="bg-black/20 p-6 rounded-2xl border border-white/5">
                        <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                          <Settings className="w-5 h-5 text-cyan-400" />
                          صيغة التصدير
                        </h4>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {AUDIO_FORMATS.map(fmt => (
                            <button
                              key={fmt}
                              onClick={() => updateSettings(activeFile.id, { format: fmt })}
                              disabled={activeFile.status === 'uploading' || activeFile.status === 'processing'}
                              className={`py-3 rounded-xl text-sm font-black transition-all uppercase tracking-wider relative overflow-hidden group
                                ${activeFile.settings.format === fmt 
                                  ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(34,211,238,0.3)] border-transparent' 
                                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-50'
                                }`}
                            >
                              {activeFile.settings.format === fmt && (
                                <div className="absolute inset-0 bg-white/20 mix-blend-overlay" />
                              )}
                              <span className="relative z-10">{fmt}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Quality Selection */}
                      <div className={`bg-black/20 p-6 rounded-2xl border border-white/5 transition-opacity duration-300 ${['mp3', 'aac', 'm4a', 'opus'].includes(activeFile.settings.format) ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                        <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                          <Music className="w-5 h-5 text-fuchsia-400" />
                          جودة الصوت (Bitrate)
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          {BITRATES.map(b => (
                            <button
                              key={b}
                              onClick={() => updateSettings(activeFile.id, { bitrate: b })}
                              disabled={activeFile.status === 'uploading' || activeFile.status === 'processing'}
                              className={`py-3 rounded-xl text-sm font-bold transition-all uppercase tracking-wider relative overflow-hidden
                                ${activeFile.settings.bitrate === b 
                                  ? 'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-[0_0_20px_rgba(217,70,239,0.3)] border-transparent' 
                                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-50'
                                }`}
                            >
                              <span className="relative z-10">{b}</span>
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                          جودة 128k تعتبر جيدة للاستماع العادي، 192k جودة عالية ممتازة، بينما 320k تقدم أعلى جودة ممكنة للمحترفين.
                        </p>
                      </div>

                    </div>
                    
                    {/* Action Area */}
                    <div className="mt-auto pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
                      
                      <div className="text-sm text-slate-400 flex items-center gap-3 w-full md:w-auto">
                        <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                          الحجم الأصلي: <span className="text-white font-mono ml-1">{(activeFile.videoFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                        </div>
                        <div className="p-3 bg-black/30 rounded-xl border border-white/5 hidden sm:block">
                          الصيغة الناتجة: <span className="text-fuchsia-400 font-black ml-1 uppercase">{activeFile.settings.format}</span>
                        </div>
                      </div>

                      <div className="w-full md:w-auto flex gap-3">
                        {activeFile.status === 'completed' ? (
                          <button 
                            onClick={() => handleDownloadSingle(activeFile.id)}
                            className="w-full md:w-auto px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 flex items-center justify-center gap-3 group"
                          >
                            <Download className="w-6 h-6 group-hover:-translate-y-1 transition-transform" />
                            تحميل الملف الصوتي
                          </button>
                        ) : (
                          <button 
                            onClick={() => startExtraction(activeFile.id)}
                            disabled={activeFile.status === 'uploading' || activeFile.status === 'processing'}
                            className="w-full md:w-auto px-10 py-4 bg-gradient-to-r from-fuchsia-600 to-blue-600 hover:from-fuchsia-500 hover:to-blue-500 disabled:opacity-50 disabled:grayscale text-white font-black rounded-2xl shadow-[0_0_30px_rgba(217,70,239,0.3)] transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-3 group"
                          >
                            {(activeFile.status === 'uploading' || activeFile.status === 'processing') ? (
                              <><Loader2 className="w-6 h-6 animate-spin" /> جاري المعالجة السحابية {activeFile.progress}%</>
                            ) : (
                              <><Settings className="w-6 h-6 group-hover:rotate-90 transition-transform duration-500" /> استخراج ومعالجة</>
                            )}
                          </button>
                        )}
                      </div>

                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
