import React, { useState, useRef, useEffect } from 'react';
import { UserRecord } from '../types';
import { Download, Upload, X, Sliders, Image as ImageIcon, Sparkles, Wand2, Plus, User, Square, Circle, Trash2, Maximize } from 'lucide-react';

interface ImageEditorProps {
  currentUser: UserRecord | null;
  onCancel: () => void;
  onLoginRequired: () => void;
  onSubscriptionRequired: () => void;
}

export const ImageEditor: React.FC<ImageEditorProps> = ({ onCancel }) => {
  const [mainImage, setMainImage] = useState<HTMLImageElement | null>(null);
  const [width, setWidth] = useState<number>(500);
  const [height, setHeight] = useState<number>(500);
  
  const [borderRadius, setBorderRadius] = useState<number>(30); // %
  const [edgeSoftness, setEdgeSoftness] = useState<number>(0);
  const [autoTransparent, setAutoTransparent] = useState<boolean>(false);
  
  const [mainImageScale, setMainImageScale] = useState<number>(100);
  const [mainImageX, setMainImageX] = useState<number>(50);
  const [mainImageY, setMainImageY] = useState<number>(50);
  
  const [shadowStrength, setShadowStrength] = useState<number>(0); // opacity
  const [shadowBlur, setShadowBlur] = useState<number>(10);
  const [shadowDistance, setShadowDistance] = useState<number>(5);

  const [overlayImage, setOverlayImage] = useState<HTMLImageElement | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(100);
  const [overlayScale, setOverlayScale] = useState<number>(100);
  const [overlayTop, setOverlayTop] = useState<number>(50);
  const [overlayLeft, setOverlayLeft] = useState<number>(50);

  const [exportQuality, setExportQuality] = useState<'HIGH_PNG' | 'MEDIUM_WEBP' | 'LOW_WEBP'>('HIGH_PNG');
  
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const processImage = () => {
    if (!mainImage) {
      setPreviewUrl(null);
      return;
    }
    
    // 1. Process Auto Transparency on Main Image
    let sourceImage: CanvasImageSource = mainImage;
    if (autoTransparent) {
      const tCanvas = document.createElement('canvas');
      tCanvas.width = width;
      tCanvas.height = height;
      const tCtx = tCanvas.getContext('2d')!;
      tCtx.drawImage(mainImage, 0, 0, width, height);
      
      const imgData = tCtx.getImageData(0, 0, width, height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) {
          data[i+3] = 0; // Alpha
        }
      }
      tCtx.putImageData(imgData, 0, 0);
      sourceImage = tCanvas;
    }

    // 2. Prepare Mask for Border Radius & Edge Softness
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mCtx = maskCanvas.getContext('2d')!;
    
    // Draw the shape mask (white)
    mCtx.fillStyle = 'white';
    mCtx.beginPath();
    if (borderRadius > 0) {
      const radius = (borderRadius / 100) * (Math.min(width, height) / 2);
      mCtx.moveTo(radius, 0);
      mCtx.lineTo(width - radius, 0);
      mCtx.quadraticCurveTo(width, 0, width, radius);
      mCtx.lineTo(width, height - radius);
      mCtx.quadraticCurveTo(width, height, width - radius, height);
      mCtx.lineTo(radius, height);
      mCtx.quadraticCurveTo(0, height, 0, height - radius);
      mCtx.lineTo(0, radius);
      mCtx.quadraticCurveTo(0, 0, radius, 0);
    } else {
      mCtx.rect(0, 0, width, height);
    }
    mCtx.closePath();
    mCtx.fill();

    // If edge softness exists, blur the mask
    if (edgeSoftness > 0) {
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = width;
      blurCanvas.height = height;
      const bCtx = blurCanvas.getContext('2d')!;
      bCtx.filter = `blur(${edgeSoftness}px)`;
      // To pull the blur inwards, we draw the original shape, then we draw a slightly inset/blurred mask
      bCtx.drawImage(maskCanvas, 0, 0);
      
      mCtx.clearRect(0, 0, width, height);
      mCtx.drawImage(blurCanvas, 0, 0);
    }

    // Process Pan & Zoom onto mask via source-in
    mCtx.globalCompositeOperation = 'source-in';
    
    const iw = mainImage.width;
    const ih = mainImage.height;
    
    // Default fit: scale the image to cover the canvas
    const defaultScale = Math.max(width / iw, height / ih);
    const renderScale = defaultScale * (mainImageScale / 100);
    
    const swo = iw * renderScale;
    const sho = ih * renderScale;
    
    // Position (50% is center)
    const px = (mainImageX / 100) * width - swo / 2;
    const py = (mainImageY / 100) * height - sho / 2;
    
    mCtx.drawImage(sourceImage, px, py, swo, sho);

    // 3. Final Canvas Composition
    const canvas = document.createElement('canvas');
    // Add extra padding for shadows so they don't clip at boundaries instantly if distance is large
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    if (shadowStrength > 0) {
      ctx.shadowColor = `rgba(0,0,0,${shadowStrength / 100})`;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = shadowDistance;
      ctx.shadowOffsetY = shadowDistance;
    }
    
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();

    // 4. Draw Overlay Image
    if (overlayImage) {
      ctx.save();
      ctx.globalAlpha = overlayOpacity / 100;
      
      const ow = overlayImage.width * (overlayScale / 100);
      const oh = overlayImage.height * (overlayScale / 100);
      
      const px = (overlayLeft / 100) * width - ow / 2;
      const py = (overlayTop / 100) * height - oh / 2;
      
      ctx.drawImage(overlayImage, px, py, ow, oh);
      ctx.restore();
    }
    
    try {
      setPreviewUrl(canvas.toDataURL('image/png'));
    } catch(e) {
      // tainted canvas if cross-origin
    }
  };

  useEffect(() => {
    processImage();
  }, [mainImage, width, height, borderRadius, edgeSoftness, autoTransparent, shadowStrength, shadowBlur, shadowDistance, overlayImage, overlayOpacity, overlayScale, overlayTop, overlayLeft, mainImageScale, mainImageX, mainImageY]);

  const handleMainImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setMainImage(img);
        setWidth(img.width);
        setHeight(img.height);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleOverlayUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setOverlayImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleDownload = () => {
    if (!previewUrl) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const finalImg = new Image();
    finalImg.onload = () => {
       ctx.drawImage(finalImg, 0, 0);
       
       let mime = 'image/png';
       let qual = 1.0;
       let ext = 'png';
       
       if (exportQuality === 'MEDIUM_WEBP') {
          mime = 'image/webp'; qual = 0.7; ext = 'webp';
       } else if (exportQuality === 'LOW_WEBP') {
          mime = 'image/webp'; qual = 0.4; ext = 'webp';
       }
       
       const url = canvas.toDataURL(mime, qual);
       const link = document.createElement('a');
       link.download = `edited_image.${ext}`;
       link.href = url;
       link.click();
    };
    finalImg.src = previewUrl;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0f1c] flex flex-col font-sans transition-colors duration-300">
      
      {/* Top Header */}
      <div className="h-16 bg-[#040812] border-b border-indigo-500/10 flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold tracking-wide">Smart Image Editor</h1>
            <p className="text-[10px] text-indigo-400 font-medium tracking-wide">.Create rounded images with overlays and shadows easily</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="flex items-center gap-2 px-4 py-1.5 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-full transition-colors border border-white/10">
            <X className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-4 md:p-6 gap-6 justify-center items-start max-w-7xl mx-auto w-full">
        {/* Left Sidebar - Properties Panel */}
        <div className="w-[420px] bg-[#0d1425] border border-white/5 flex flex-col shrink-0 rounded-3xl overflow-hidden shadow-2xl">
          <div className="p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar h-[calc(100vh-100px)]">
            
            {/* Main Image */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm font-black text-white">
                 <span>1. Main Image</span>
                 <button onClick={() => setAutoTransparent(!autoTransparent)} className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-full transition-colors border ${autoTransparent ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'bg-[#1a233a] text-slate-400 border-transparent hover:text-white'}`}>
                   <Sparkles className="w-3 h-3" /> Auto Transparency
                 </button>
              </div>
              <div className="flex items-center gap-3 bg-[#0a0f1c] p-2 flex-wrap rounded-xl border border-white/5">
                 <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleMainImageUpload} />
                 <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-[#1a233a] hover:bg-[#222e4a] text-xs font-bold text-slate-200 rounded-lg transition-colors whitespace-nowrap">
                    Choose File
                 </button>
                 <span className="text-[11px] text-slate-400 truncate flex-1" dir="auto">{mainImage ? 'Image loaded' : 'No file chosen'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1 text-right">
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">Height (px)</label>
                    <input type="number" value={height} onChange={e => setHeight(Number(e.target.value))} className="w-full bg-[#0a0f1c] border border-white/10 rounded-xl px-3 py-2 text-sm text-right text-white font-mono focus:border-indigo-500 outline-none transition-colors" />
                 </div>
                 <div className="space-y-1 text-right">
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">Width (px)</label>
                    <input type="number" value={width} onChange={e => setWidth(Number(e.target.value))} className="w-full bg-[#0a0f1c] border border-white/10 rounded-xl px-3 py-2 text-sm text-right text-white font-mono focus:border-indigo-500 outline-none transition-colors" />
                 </div>
              </div>

              {mainImage && (
                <div className="space-y-4 pt-2 bg-white/[0.02] p-3 rounded-xl border border-white/5">
                   <div>
                     <div className="flex justify-between text-[11px] font-bold mb-2 text-emerald-400">
                       <span className="font-mono">{mainImageScale}%</span><span>Scale (Zoom)</span>
                     </div>
                     <input type="range" min="10" max="300" value={mainImageScale} onChange={e => setMainImageScale(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between text-[11px] font-bold mb-2 text-emerald-400"><span>Pos X</span><span className="font-mono">{mainImageX}%</span></div>
                        <input type="range" min="0" max="100" value={mainImageX} onChange={e => setMainImageX(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-emerald-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full" />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] font-bold mb-2 text-emerald-400"><span>Pos Y</span><span className="font-mono">{mainImageY}%</span></div>
                        <input type="range" min="0" max="100" value={mainImageY} onChange={e => setMainImageY(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-emerald-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full" />
                      </div>
                   </div>
                </div>
              )}
            </div>

            <div className="h-px bg-white/5 w-full"></div>

            {/* Edge Control & Shapes */}
            <div className="space-y-5">
              <div className="flex justify-between items-center text-sm font-black text-white">
                 <span>2. Shape & Edges</span>
              </div>
              
              <div className="grid grid-cols-4 gap-2">
                 <button onClick={() => { setBorderRadius(0); }} className="py-2 flex flex-col items-center justify-center gap-1 bg-[#0a0f1c] hover:bg-[#1a233a] rounded-xl border border-white/5 text-slate-400 hover:text-white transition-colors">
                    <Square className="w-4 h-4" /> <span className="text-[9px] font-bold">Square</span>
                 </button>
                 <button onClick={() => { setBorderRadius(25); }} className="py-2 flex flex-col items-center justify-center gap-1 bg-[#0a0f1c] hover:bg-[#1a233a] rounded-xl border border-white/5 text-slate-400 hover:text-white transition-colors">
                    <div className="w-4 h-4 border-2 border-current rounded-md"></div> <span className="text-[9px] font-bold">Rounded</span>
                 </button>
                 <button onClick={() => { setBorderRadius(100); }} className="py-2 flex flex-col items-center justify-center gap-1 bg-[#0a0f1c] hover:bg-[#1a233a] rounded-xl border border-white/5 text-slate-400 hover:text-white transition-colors">
                    <Circle className="w-4 h-4" /> <span className="text-[9px] font-bold">Circle</span>
                 </button>
                 <button onClick={() => { setBorderRadius(100); setEdgeSoftness(15); }} className="py-2 flex flex-col items-center justify-center gap-1 bg-[#0a0f1c] hover:bg-[#1a233a] rounded-xl border border-white/5 text-slate-400 hover:text-white transition-colors">
                    <Wand2 className="w-4 h-4" /> <span className="text-[9px] font-bold">Soft</span>
                 </button>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-bold mb-2">
                  <span className="text-pink-500 font-mono">{borderRadius}%</span>
                  <span className="text-slate-200">Border Radius</span>
                </div>
                <input type="range" min="0" max="100" value={borderRadius} onChange={(e) => setBorderRadius(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:rounded-full cursor-pointer accent-pink-500" />
              </div>
              
              <div>
                <div className="flex justify-between text-[11px] font-bold mb-2">
                  <span className="text-pink-500 font-mono">{edgeSoftness}px</span>
                  <span className="text-slate-200">Edge Softness (Blur)</span>
                </div>
                <input type="range" min="0" max="100" value={edgeSoftness} onChange={(e) => setEdgeSoftness(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:rounded-full cursor-pointer accent-pink-500" />
              </div>
            </div>

            <div className="h-px bg-white/5 w-full"></div>

            {/* Smart Shadow */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm font-black text-white">
                 <span>3. Smart Shadow</span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-2 text-cyan-400">
                      <span className="font-mono">{shadowStrength}%</span><span>Strength (Opacity)</span>
                    </div>
                    <input type="range" min="0" max="100" value={shadowStrength} onChange={e => setShadowStrength(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:rounded-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <div className="flex justify-between text-[11px] font-bold mb-2 text-cyan-400"><span>Blur</span><span className="font-mono">{shadowBlur}px</span></div>
                       <input type="range" min="0" max="100" value={shadowBlur} onChange={e => setShadowBlur(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:rounded-full" />
                     </div>
                     <div>
                       <div className="flex justify-between text-[11px] font-bold mb-2 text-cyan-400"><span>Distance</span><span className="font-mono">{shadowDistance}px</span></div>
                       <input type="range" min="-50" max="50" value={shadowDistance} onChange={e => setShadowDistance(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:rounded-full" />
                     </div>
                  </div>
              </div>
            </div>

            <div className="h-px bg-white/5 w-full"></div>

            {/* Overlay */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm font-black text-white">
                 <span>4. Overlay (Optional)</span>
              </div>
              <div className="flex items-center gap-3 bg-[#0a0f1c] p-2 rounded-xl border border-white/5 flex-wrap">
                 <input type="file" ref={overlayInputRef} className="hidden" accept="image/*" onChange={handleOverlayUpload} />
                 <button onClick={() => overlayInputRef.current?.click()} className="px-4 py-2 bg-[#1a233a] hover:bg-[#222e4a] text-xs font-bold text-slate-200 rounded-lg transition-colors whitespace-nowrap">
                    Choose File
                 </button>
                 <span className="text-[11px] text-slate-400 truncate flex-1" dir="auto">{overlayImage ? 'Overlay loaded' : 'No file'}</span>
                 {overlayImage && (
                    <button onClick={() => setOverlayImage(null)} className="p-1 px-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">
                       <Trash2 className="w-3.5 h-3.5" />
                    </button>
                 )}
              </div>
              
              {overlayImage && (
                <div className="space-y-4 p-3 bg-white/[0.02] rounded-xl border border-white/5">
                   <div>
                     <div className="flex justify-between text-[11px] font-bold mb-2 text-indigo-400">
                       <span className="font-mono">{overlayOpacity}%</span><span>Opacity</span>
                     </div>
                     <input type="range" min="0" max="100" value={overlayOpacity} onChange={e => setOverlayOpacity(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full" />
                   </div>
                   <div>
                     <div className="flex justify-between text-[11px] font-bold mb-2 text-indigo-400">
                       <span className="font-mono">{overlayScale}%</span><span>Scale</span>
                     </div>
                     <input type="range" min="10" max="300" value={overlayScale} onChange={e => setOverlayScale(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full" />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between text-[11px] font-bold mb-2 text-indigo-400"><span>Pos X</span><span className="font-mono">{overlayLeft}%</span></div>
                        <input type="range" min="0" max="100" value={overlayLeft} onChange={e => setOverlayLeft(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full" />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] font-bold mb-2 text-indigo-400"><span>Pos Y</span><span className="font-mono">{overlayTop}%</span></div>
                        <input type="range" min="0" max="100" value={overlayTop} onChange={e => setOverlayTop(Number(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:rounded-full" />
                      </div>
                   </div>
                </div>
              )}
            </div>

            <div className="h-px bg-white/5 w-full"></div>

            {/* Export & Download */}
            <div className="space-y-4 pb-4">
              <div className="flex justify-between items-center text-sm font-black text-white">
                 <span>5. Export</span>
              </div>
              
              <div className="flex bg-[#0a0f1c] rounded-xl p-1 border border-white/5 gap-1">
                 <button onClick={() => setExportQuality('HIGH_PNG')} className={`flex-1 py-2 text-[9px] lg:text-[10px] font-black rounded-lg transition-colors ${exportQuality === 'HIGH_PNG' ? 'bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20 shadow-sm' : 'text-slate-500 border border-transparent hover:bg-white/5'}`}>HIGH (PNG)</button>
                 <button onClick={() => setExportQuality('MEDIUM_WEBP')} className={`flex-1 py-2 text-[9px] lg:text-[10px] font-black rounded-lg transition-colors ${exportQuality === 'MEDIUM_WEBP' ? 'bg-[#1a233a] border border-white/10 text-white shadow-sm' : 'text-slate-500 border border-transparent hover:bg-white/5'}`}>MEDIUM (WEBP)</button>
                 <button onClick={() => setExportQuality('LOW_WEBP')} className={`flex-1 py-2 text-[9px] lg:text-[10px] font-black rounded-lg transition-colors ${exportQuality === 'LOW_WEBP' ? 'bg-[#1a233a] border border-white/10 text-white shadow-sm' : 'text-slate-500 border border-transparent hover:bg-white/5'}`}>LOW (WEBP)</button>
              </div>
              
              <button 
                onClick={handleDownload} 
                disabled={!previewUrl} 
                className={`w-full py-4 mt-2 text-sm font-black tracking-wide rounded-xl transition-colors shadow-lg ${
                  previewUrl ? 'bg-[#2d3748] hover:bg-[#3a475c] text-white cursor-pointer active:scale-95' : 'bg-[#1a233a] text-slate-600 cursor-not-allowed'
                }`}
              >
                DOWNLOAD {exportQuality.includes('PNG') ? 'PNG' : 'WEBP'}
              </button>
            </div>
            
          </div>
        </div>

        {/* Center Canvas Area (Interactive Stage) */}
        <div className="flex-1 bg-[#0d1425] rounded-3xl border border-white/5 overflow-auto relative flex flex-col items-center justify-center shadow-2xl p-6 h-[calc(100vh-100px)]">
          
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            <div className="absolute inset-4 bg-[#0a0f1c]/50 rounded-2xl border border-white/5"></div>
            
            {!mainImage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-500 z-10 pointer-events-none">
                 <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 border-dashed">
                   <ImageIcon className="w-8 h-8 opacity-50" />
                 </div>
                 <div className="text-center font-medium">
                   <p className="text-sm text-slate-300">Upload an image to start editing</p>
                   <p className="text-[10px] mt-1 opacity-70">Checkerboard pattern below indicates transparent areas</p>
                 </div>
              </div>
            )}
            
            {previewUrl && (
              <div 
                className="relative max-w-[90%] max-h-[90%] object-contain rounded-xl drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-20 pointer-events-none checker-bg-div" 
                style={{
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h10v10H0zm10 10h10v10H10z\' fill=\'%231a233a\'/%3E%3Cpath d=\'M10 0h10v10H10zM0 10h10v10H0z\' fill=\'%230f172a\'/%3E%3C/svg%3E")'
                }}
              >
                <img src={previewUrl} alt="Preview" className="max-w-full max-h-[70vh] object-contain rounded" style={{ animation: 'fadeIn 0.3s ease-out forwards' }} />
              </div>
            )}
          </div>
          
          <style>{`
            @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
            .checker-bg-div { box-shadow: 0 0 0 1px rgba(255,255,255,0.05); }
          `}</style>
          
          <div className="absolute bottom-6 flex items-center gap-2 text-xs font-medium text-slate-500 bg-[#0a0f1c] px-4 py-2 rounded-full border border-white/5 shadow-xl">
             <div className="w-3 h-3 rounded-[2px] opacity-70 bg-[#1a233a]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'6\' height=\'6\' viewBox=\'0 0 6 6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h3v3H0zm3 3h3v3H3z\' fill=\'%233a475c\'/%3E%3C/svg%3E")' }}></div>
             Preview renders real-time
          </div>
          
        </div>
      </div>
    </div>
  );
};
