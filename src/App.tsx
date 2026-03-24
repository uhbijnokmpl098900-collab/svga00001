import React, { useState, useCallback } from 'react';
import { Upload, FileVideo, Sparkles, Layers, Download } from 'lucide-react';
import { SVGAViewer } from './components/SVGAViewer';
import { SVGAFileInfo } from './types';

export default function App() {
  const [fileInfo, setFileInfo] = useState<SVGAFileInfo | null>(null);
  const [originalFile, setOriginalFile] = useState<File | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setFileInfo({ name: file.name, url });
      setOriginalFile(file);
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.svga')) {
      const url = URL.createObjectURL(file);
      setFileInfo({ name: file.name, url });
      setOriginalFile(file);
    } else if (file) {
      alert('Please select an SVGA file');
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClear = useCallback(() => {
    if (fileInfo?.url) {
      URL.revokeObjectURL(fileInfo.url);
    }
    setFileInfo(null);
    setOriginalFile(undefined);
  }, [fileInfo]);

  if (fileInfo) {
    return <SVGAViewer file={fileInfo} onClear={handleClear} originalFile={originalFile} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] font-sans selection:bg-blue-500/30 flex flex-col" dir="ltr">
      {/* Header */}
      <header className="border-b border-[#262626] bg-[#0a0a0a] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 22h20L12 2z"/></svg>
            </div>
            <span className="font-bold text-white text-sm">MotionTools</span>
          </div>
          <div className="text-xs font-medium text-[#a3a3a3]">Pro Version</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6 relative overflow-hidden bg-[#0f0f0f]">
        {/* Background Effects */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-600/5 rounded-full blur-[120px] pointer-events-none"></div>
        
        <div className="max-w-5xl w-full grid md:grid-cols-2 gap-12 items-center relative z-10">
          
          {/* Left/Right Content */}
          <div className="space-y-6 md:space-y-8 flex flex-col items-center md:items-start text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1a1a] border border-[#333] text-xs md:text-sm font-medium text-purple-400">
              <Sparkles size={14} />
              <span>Advanced Tool for Developers & Designers</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-white">
              Analyze & Edit <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-500">SVGA</span> easily
            </h1>
            
            <p className="text-base md:text-lg text-[#a3a3a3] leading-relaxed max-w-lg">
              A professional tool that allows you to extract images, control layers, and export projects to After Effects or as high-quality image sequences.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 md:pt-4 w-full">
              <div className="bg-[#111] border border-[#262626] rounded-2xl p-4 flex flex-col gap-2 md:gap-3 items-center md:items-start">
                <Layers className="text-purple-400" size={24} />
                <div className="font-medium text-[#e5e5e5]">Layer Control</div>
                <div className="text-xs md:text-sm text-[#a3a3a3]">Easily hide and show dynamic elements</div>
              </div>
              <div className="bg-[#111] border border-[#262626] rounded-2xl p-4 flex flex-col gap-2 md:gap-3 items-center md:items-start">
                <Download className="text-blue-400" size={24} />
                <div className="font-medium text-[#e5e5e5]">Multiple Export</div>
                <div className="text-xs md:text-sm text-[#a3a3a3]">Extract as PNG or After Effects project</div>
              </div>
            </div>
          </div>

          {/* Upload Area */}
          <div 
            className={`relative group rounded-[2rem] border-2 border-dashed transition-all duration-300 ease-out bg-[#111] overflow-hidden w-full
              ${isDragging 
                ? 'border-purple-500 bg-purple-500/5 scale-[1.02]' 
                : 'border-[#333] hover:border-[#555] hover:bg-[#1a1a1a]'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            
            <div className="p-12 flex flex-col items-center justify-center text-center min-h-[400px] relative z-10">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-8 transition-all duration-500
                ${isDragging ? 'bg-purple-500 text-white scale-110 shadow-[0_0_40px_rgba(168,85,247,0.3)]' : 'bg-[#262626] text-[#a3a3a3] group-hover:bg-[#333] group-hover:text-white group-hover:scale-105'}
              `}>
                <Upload size={40} className={isDragging ? 'animate-bounce' : ''} />
              </div>
              
              <h3 className="text-2xl font-bold mb-3 text-white">Drag & Drop File Here</h3>
              <p className="text-[#a3a3a3] mb-8 max-w-[250px]">
                Supports SVGA files version 1.0 and 2.0
              </p>
              
              <label className="relative overflow-hidden group/btn cursor-pointer rounded-lg">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600 transition-transform duration-300 group-hover/btn:scale-105"></div>
                <div className="relative px-8 py-4 flex items-center gap-2 font-medium text-white">
                  <span>Browse Files</span>
                </div>
                <input 
                  type="file" 
                  accept=".svga" 
                  className="hidden" 
                  onChange={handleFileUpload} 
                />
              </label>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
