
import React, { useState } from 'react';

interface UploaderProps {
  onUpload: (files: File[]) => void;
  isUploading: boolean;
  onConverterOpen?: () => void;
  onMultiSvgaOpen?: () => void;
  onBatchImageOpen?: () => void;
  onPagConverterOpen?: () => void;
  globalQuality?: 'low' | 'medium' | 'high';
  setGlobalQuality?: (q: 'low' | 'medium' | 'high') => void;
}

export const Uploader: React.FC<UploaderProps> = ({ onUpload, isUploading, onConverterOpen, onMultiSvgaOpen, onBatchImageOpen, onPagConverterOpen, globalQuality = 'high', setGlobalQuality }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div 
      className={`relative max-w-5xl mx-auto min-h-[350px] sm:h-[450px] rounded-3xl sm:rounded-[4rem] border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center gap-6 sm:gap-10 p-6 sm:p-12 cursor-pointer shadow-3xl overflow-hidden
        ${isDragOver ? 'border-sky-500 bg-sky-500/10 scale-[1.01] shadow-glow-sky' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => document.getElementById('file-input')?.click()}
    >
      <input 
        id="file-input"
        type="file" 
        accept=".svga,.mp4,.webm,.mov,.json,application/json"
        className="hidden"
        onChange={handleFileChange}
        multiple
      />

      <div className="absolute -top-24 -left-24 w-64 h-64 bg-sky-500/5 blur-[100px] rounded-full"></div>
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-indigo-600/5 blur-[100px] rounded-full"></div>
      
      <div className="relative group">
         <div className="absolute inset-0 bg-sky-500 blur-2xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
         <div className="relative w-20 h-20 sm:w-28 sm:h-28 bg-slate-950 rounded-2xl sm:rounded-3xl flex items-center justify-center text-sky-400 border border-white/10 shadow-2xl transition-transform duration-500 group-hover:scale-110">
            <svg className="w-10 h-10 sm:w-12 sm:h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
         </div>
      </div>
      
      <div className="text-center relative z-10 px-4">
        <h3 className="text-2xl sm:text-4xl font-black text-white mb-3 tracking-tighter uppercase">Quantum SVGA Processor</h3>
        <p className="text-slate-500 font-black uppercase tracking-[0.2em] sm:tracking-[0.4em] text-[8px] sm:text-[10px]">اضغط أو اسحب الملف للدخول إلى مساحة العمل</p>
      </div>



      <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 relative z-10 w-full px-4 sm:px-0">
        <div className="flex items-center justify-center gap-3 px-6 py-3 bg-slate-800/80 rounded-xl sm:rounded-2xl border-t border-white/10 border-b-4 border-b-slate-950 shadow-[0_8px_16px_rgba(0,0,0,0.4)] transform transition-transform">
           <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse shadow-[0_0_8px_rgba(14,165,233,0.8)]"></div>
           <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest">SVGA 1.0 / 2.0</span>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); onConverterOpen?.(); }}
          className="flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-b from-sky-500/20 to-sky-600/10 hover:from-sky-400/30 hover:to-sky-500/20 rounded-xl sm:rounded-2xl border-t border-sky-400/30 border-b-4 border-b-sky-900/50 shadow-[0_8px_16px_rgba(14,165,233,0.15)] hover:shadow-[0_12px_24px_rgba(14,165,233,0.25)] hover:-translate-y-1 active:translate-y-1 active:border-b-0 transition-all group/btn"
        >
           <span className="text-xl group-hover/btn:scale-110 transition-transform drop-shadow-md">⚡</span>
           <span className="text-[10px] text-sky-300 font-black uppercase tracking-widest drop-shadow-sm">محول الفيديو المباشر</span>
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onMultiSvgaOpen?.(); }}
          className="flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-b from-indigo-500/20 to-indigo-600/10 hover:from-indigo-400/30 hover:to-indigo-500/20 rounded-xl sm:rounded-2xl border-t border-indigo-400/30 border-b-4 border-b-indigo-900/50 shadow-[0_8px_16px_rgba(99,102,241,0.15)] hover:shadow-[0_12px_24px_rgba(99,102,241,0.25)] hover:-translate-y-1 active:translate-y-1 active:border-b-0 transition-all group/btn"
        >
           <span className="text-xl group-hover/btn:scale-110 transition-transform drop-shadow-md">🖼️</span>
           <span className="text-[10px] text-indigo-300 font-black uppercase tracking-widest drop-shadow-sm">معاينة متعددة</span>
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onBatchImageOpen?.(); }}
          className="flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-b from-emerald-500/20 to-emerald-600/10 hover:from-emerald-400/30 hover:to-emerald-500/20 rounded-xl sm:rounded-2xl border-t border-emerald-400/30 border-b-4 border-b-emerald-900/50 shadow-[0_8px_16px_rgba(16,185,129,0.15)] hover:shadow-[0_12px_24px_rgba(16,185,129,0.25)] hover:-translate-y-1 active:translate-y-1 active:border-b-0 transition-all group/btn"
        >
           <span className="text-xl group-hover/btn:scale-110 transition-transform drop-shadow-md">📸</span>
           <span className="text-[10px] text-emerald-300 font-black uppercase tracking-widest drop-shadow-sm">المحول الجماعي للصور</span>
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onPagConverterOpen?.(); }}
          className="flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-b from-purple-500/20 to-purple-600/10 hover:from-purple-400/30 hover:to-purple-500/20 rounded-xl sm:rounded-2xl border-t border-purple-400/30 border-b-4 border-b-purple-900/50 shadow-[0_8px_16px_rgba(168,85,247,0.15)] hover:shadow-[0_12px_24px_rgba(168,85,247,0.25)] hover:-translate-y-1 active:translate-y-1 active:border-b-0 transition-all group/btn"
        >
           <span className="text-xl group-hover/btn:scale-110 transition-transform drop-shadow-md">📑</span>
           <span className="text-[10px] text-purple-300 font-black uppercase tracking-widest drop-shadow-sm">استخراج طبقات SVGA</span>
        </button>
      </div>
      
      <style>{`
        .shadow-3xl { box-shadow: 0 50px 100px -30px rgba(0, 0, 0, 0.8); }
        .shadow-glow-sky { box-shadow: 0 0 50px rgba(14, 165, 233, 0.2); }
      `}</style>
    </div>
  );
};
