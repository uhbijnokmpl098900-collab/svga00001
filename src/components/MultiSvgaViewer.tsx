import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Play, Pause, RotateCcw, Trash2, Maximize2, Info, Upload, X, Download, Image as ImageIcon, ShieldCheck, Monitor, Smartphone, Loader2, Camera, Video, Film, FileVideo, Volume2, Music , SquareCheck } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { PresetBackground, UserRecord } from '../types';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { loadFFmpegWithFallbacks } from '../utils/ffmpegLoader';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { createStreamingZip } from '../utils/streamZip';
import { calculateSafeDimensions } from '../utils/dimensions';
import { getPAG, convertPagToSvga } from '../utils/pagEngine';
import { ensureMp3WithId3, extractAudioFromSvga } from '../utils/svgaAudio';

const decodeDataToBytes = (data: any): Uint8Array | null => {
  if (!data) return null;
  if (data instanceof Uint8Array) return ensureMp3WithId3(data);
  if (data instanceof ArrayBuffer) return ensureMp3WithId3(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return ensureMp3WithId3(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  if (typeof data === 'string') {
    let binaryStr = '';
    if (data.startsWith('data:')) {
      const parts = data.split(',');
      binaryStr = atob(parts[1] || '');
    } else {
      try {
        binaryStr = atob(data.trim());
      } catch {
        binaryStr = data;
      }
    }
    try {
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return ensureMp3WithId3(bytes);
    } catch (e) {
      console.warn("Failed to decode audio binary string", e);
      return null;
    }
  }
  return null;
};

const WatermarkOverlay: React.FC<{
  watermark: string;
  settings: any;
}> = ({ watermark, settings }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  useEffect(() => {
    if (!settings.isAnimated || !containerRef.current || !imgRef.current) return;
    
    let animationFrameId: number;
    let startTime: number | null = null;
    
    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      // Approximate frame based on 30fps
      const frame = Math.floor((elapsed / 1000) * 30);
      
      const container = containerRef.current;
      if (!container) return;
      
      const wmSize = Math.min(container.clientWidth, container.clientHeight) * (settings.size / 100);
      const speed = settings.animationSpeed;
      const pxPerFrame = speed * 0.5;
      
      const maxX = container.clientWidth - wmSize;
      const maxY = container.clientHeight - wmSize;
      
      if (maxX > 0 && maxY > 0) {
        const distX = frame * pxPerFrame;
        const distY = frame * pxPerFrame;
        
        const modX = distX % (maxX * 2);
        const modY = distY % (maxY * 2);
        
        const x = modX > maxX ? (maxX * 2) - modX : modX;
        const y = modY > maxY ? (maxY * 2) - modY : modY;
        
        if (imgRef.current) {
          imgRef.current.style.transform = `translate(${x}px, ${y}px)`;
          imgRef.current.style.width = `${wmSize}px`;
          imgRef.current.style.height = `${wmSize}px`;
        }
      }
      
      animationFrameId = requestAnimationFrame(animate);
    };
    
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [settings]);

  if (!watermark) return null;

  const staticStyle: React.CSSProperties = {
    opacity: settings.opacity,
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 50,
  };

  if (!settings.isAnimated) {
    staticStyle.width = `${settings.size}%`;
    staticStyle.height = `${settings.size}%`;
    staticStyle.objectFit = 'contain';
    
    if (settings.position === 'top-left') { staticStyle.top = '5%'; staticStyle.left = '5%'; }
    else if (settings.position === 'top-right') { staticStyle.top = '5%'; staticStyle.right = '5%'; }
    else if (settings.position === 'bottom-left') { staticStyle.bottom = '5%'; staticStyle.left = '5%'; }
    else if (settings.position === 'bottom-right') { staticStyle.bottom = '5%'; staticStyle.right = '5%'; }
    else if (settings.position === 'center') { 
      staticStyle.top = '50%'; staticStyle.left = '50%'; 
      staticStyle.transform = 'translate(-50%, -50%)';
    }
  } else {
    staticStyle.top = 0;
    staticStyle.left = 0;
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden">
      <img ref={imgRef} src={watermark} style={staticStyle} alt="watermark" />
    </div>
  );
};

const extractAudioData = (item: any): Uint8Array | null => {
  if (!item) return null;
  if (item.type !== 'svga') return null;
  const vi = item.videoItem;
  if (!vi) return null;

  // 1. Check audios array
  if (vi.audios && Array.isArray(vi.audios) && vi.audios.length > 0) {
    for (const a of vi.audios) {
      if (a && a.audioKey && vi.images && vi.images[a.audioKey]) {
        const bytes = decodeDataToBytes(vi.images[a.audioKey]);
        if (bytes && bytes.length > 0) return bytes;
      }
    }
  }

  // 2. Check images dictionary for audio keys
  if (vi.images && typeof vi.images === 'object') {
    for (const key of Object.keys(vi.images)) {
      const lower = key.toLowerCase();
      if (
        lower.endsWith('.mp3') ||
        lower.endsWith('.wav') ||
        lower.endsWith('.ogg') ||
        lower.endsWith('.m4a') ||
        lower.endsWith('.aac') ||
        lower.includes('audio') ||
        lower.includes('sound') ||
        lower.includes('bgm') ||
        lower.includes('music')
      ) {
        const bytes = decodeDataToBytes(vi.images[key]);
        if (bytes && bytes.length > 0) return bytes;
      }
    }
  }

  return null;
};

declare var SVGA: any;

export interface MultiSvgaItem {
  id: string;
  file: File;
  url: string;
  name: string;
  size: number;
  dimensions?: { width: number; height: number };
  fps?: number;
  frames?: number;
  videoItem?: any;
  pagFile?: any;
  type: "svga" | "pag";
  presetId: string;
  folderName?: string;
  folderPath?: string;
}

interface MultiSvgaViewerProps {
  onCancel: () => void;
  currentUser: UserRecord | null;
  onSubscriptionRequired?: () => void;
}

interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  category: string;
}

const DEVICE_PRESETS: DevicePreset[] = [
  // Standard Series
  { id: 'ip8', name: '750 × 1334 (iPhone 8)', width: 750, height: 1334, category: 'Standard' },
  { id: 'sq500', name: '500 × 500 (Square)', width: 500, height: 500, category: 'Standard' },
  
  // iPhone Series
  { id: 'ip15pm', name: 'iPhone 15 Max', width: 1290, height: 2796, category: 'iPhone' },
  { id: 'ip15p', name: 'iPhone 15 pro', width: 1179, height: 2556, category: 'iPhone' },
  { id: 'ip13', name: 'iPhone 13', width: 1170, height: 2532, category: 'iPhone' },
  { id: 'ip12pm', name: 'iPhone 12 Max', width: 1284, height: 2778, category: 'iPhone' },
  { id: 'ip12p', name: 'iPhone 12 pro', width: 1170, height: 2532, category: 'iPhone' },
  { id: 'ip12', name: 'iPhone 12', width: 1170, height: 2532, category: 'iPhone' },
  { id: 'ip11', name: 'iPhone 11', width: 828, height: 1792, category: 'iPhone' },
  { id: 'ipx', name: 'iPhone X', width: 1125, height: 2436, category: 'iPhone' },
  { id: 's10', name: '三星 S10', width: 1440, height: 3040, category: 'iPhone' },
  { id: 's20', name: '三星 S20', width: 1440, height: 3200, category: 'iPhone' },
  { id: 'mate40p', name: '华为Mate40 pro', width: 1344, height: 2772, category: 'iPhone' },
  { id: 'p40p', name: '华为 P40 pro', width: 1200, height: 2640, category: 'iPhone' },
  
  // Android Series
  { id: 'mate60p', name: 'Mate 60 Pro', width: 1260, height: 2720, category: 'Android' },
  { id: 'p70', name: '华为 P70', width: 1256, height: 2760, category: 'Android' },
  { id: 'mi14', name: '小米14', width: 1200, height: 2670, category: 'Android' },
  { id: 'mi14u', name: 'Xiaomi 14 Ultra', width: 1440, height: 3200, category: 'Android' },
  { id: 's21u', name: 'Galaxy S21 Ultra', width: 1440, height: 3200, category: 'Android' },
  { id: 'oppor17', name: 'OPPO R17', width: 1080, height: 2340, category: 'Android' },
  { id: 'mi10', name: '小米10', width: 1080, height: 2340, category: 'Android' },
  { id: 'mi6', name: '小米6', width: 1080, height: 1920, category: 'Android' },
  { id: 'vivonex3s', name: 'VIVO NEX 3S', width: 1080, height: 2256, category: 'Android' },
  { id: 'vivox50', name: 'VIVO X50', width: 1080, height: 2376, category: 'Android' },
  { id: 'oneplus8t', name: '一加8T', width: 1080, height: 2400, category: 'Android' },

  // Tablet Series
  { id: 'ipadair', name: 'ipad air', width: 1640, height: 2360, category: 'Tablet' },
  { id: 'ipadpro', name: 'ipad pro', width: 2048, height: 2732, category: 'Tablet' },
  { id: 'matepadpro', name: 'MatePad Pro', width: 1600, height: 2560, category: 'Tablet' },
  { id: 'tabs7', name: 'Galaxy Tab S7', width: 1600, height: 2560, category: 'Tablet' },

  // PC Series
  { id: 'pc800', name: '800*600', width: 800, height: 600, category: 'PC' },
  { id: 'pc1280', name: '1280*800', width: 1280, height: 800, category: 'PC' },
  { id: 'pc1920', name: '1920*1080', width: 1920, height: 1080, category: 'PC' },
  { id: 'pc27', name: '27寸', width: 2560, height: 1440, category: 'PC' },
  { id: 'custom750x240', name: '750 × 240', width: 750, height: 240, category: 'Standard' },
];

import { useAccessControl } from '../hooks/useAccessControl';
import { logActivity } from '../utils/logger';

const EmbeddedAudioPlayer: React.FC<{ item: any }> = ({ item }) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let url: string | null = null;
    let isCanceled = false;

    const loadAudio = async () => {
      let data = extractAudioData(item);
      
      if (!data && item.type === 'svga') {
         // Wait for videoItem to be populated by SvgaPlayer
         // Or parse it ourselves
         if (!item.videoItem) {
            try {
              const parser = new SVGA.Parser();
              const vi = await new Promise<any>((resolve, reject) => {
                 parser.load(item.url, (videoItem: any) => resolve(videoItem), reject);
              });
              item.videoItem = vi;
              data = extractAudioData(item);
            } catch (e) {
              console.error("Failed to parse SVGA for audio", e);
            }
         }
      }

      if (isCanceled) return;
      
      if (data) {
        const blob = new Blob([data], { type: 'audio/mpeg' });
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
    };

    loadAudio();
    
    return () => {
      isCanceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  if (!audioUrl) return null;

  return (
    <div className="flex items-center gap-4 bg-slate-800 p-3 rounded-xl border border-white/10">
      <div className="text-xs text-slate-400 font-bold uppercase">الصوت المدمج</div>
      <audio ref={audioRef} src={audioUrl} autoPlay controls className="h-10 w-48" />
    </div>
  );
};

export const MultiSvgaViewer: React.FC<MultiSvgaViewerProps> = ({ onCancel, currentUser, onSubscriptionRequired }) => {
  const { checkAccess } = useAccessControl();
  const [items, setItems] = useState<MultiSvgaItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [previewBg, setPreviewBg] = useState<string | null>(null);
  const [watermark, setWatermark] = useState<string | null>(null);
  const [presetBgs, setPresetBgs] = useState<PresetBackground[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [loadProgress, setLoadProgress] = useState<{current: number, total: number} | null>(null);
  const isCanceled = useRef(false);
  const [exportDuration, setExportDuration] = useState(10);
  const [gridCols, setGridCols] = useState(3);
  const [forceMobileSize, setForceMobileSize] = useState(false);
  const [exportResolution, setExportResolution] = useState<'natural' | '720p' | '1080p'>('natural');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('auto');
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  
  const selectedPreset = useMemo(() => DEVICE_PRESETS.find(p => p.id === selectedPresetId), [selectedPresetId]);

  const [wmSettings, setWmSettings] = useState({
    position: 'bottom-right' as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center',
    size: 15,
    opacity: 0.5,
    isAnimated: false,
    animationSpeed: 5
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const watermarkInputRef = useRef<HTMLInputElement>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isFfmpegLoaded, setIsFfmpegLoaded] = useState(false);

  const ensureFFmpeg = async (): Promise<FFmpeg | null> => {
    if (ffmpegRef.current && ffmpegRef.current.loaded) {
      return ffmpegRef.current;
    }
    const ffmpeg = ffmpegRef.current || new FFmpeg();
    ffmpegRef.current = ffmpeg;
    try {
      await loadFFmpegWithFallbacks(ffmpeg);
      setIsFfmpegLoaded(true);
      return ffmpeg;
    } catch (err) {
      console.error("Failed to load FFmpeg on demand:", err);
      return null;
    }
  };

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
  }, []);

  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'presetBackgrounds'));
        const presets = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PresetBackground));
        setPresetBgs(presets);
      } catch (error) {
        console.error("Error fetching presets:", error);
      }
    };
    fetchPresets();
  }, []);

  useEffect(() => {
    // Mute Howler globally so SVGA animations in the grid do not auto-play audio
    if (typeof window !== 'undefined' && (window as any).Howler) {
      (window as any).Howler.mute(true);
    }
    return () => { 
      isCanceled.current = true; 
      if (typeof window !== 'undefined' && (window as any).Howler) {
        (window as any).Howler.mute(false);
      }
    };
  }, []);

  const handleFiles = useCallback(async (fileObjects: {file: File, folderName?: string, folderPath?: string}[]) => {
    const fileArray = fileObjects.filter(f => {
      const name = (f.file.name || '').toLowerCase();
      return name.endsWith('.svga') || name.endsWith('.pag');
    });
    if (fileArray.length === 0) return;
    
    setLoadProgress({ current: 0, total: fileArray.length });
    isCanceled.current = false;
    
    const BATCH_SIZE = 50;
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
      if (isCanceled.current) break;
      const batch = fileArray.slice(i, i + BATCH_SIZE);
      const newItems: MultiSvgaItem[] = batch.map((item) => ({
        id: Math.random().toString(36).substr(2, 9),
        file: item.file,
        url: URL.createObjectURL(item.file),
        name: item.file.name,
        size: item.file.size,
        type: item.file.name.toLowerCase().endsWith('.pag') ? 'pag' : 'svga',
        presetId: 'auto',
        folderName: item.folderName,
        folderPath: item.folderPath
      }));
      
      setItems(prev => [...prev, ...newItems]);
      setLoadProgress({ current: Math.min(i + BATCH_SIZE, fileArray.length), total: fileArray.length });
      await new Promise(r => setTimeout(r, 10));
    }
    setLoadProgress(null);
  }, []);

  const traverseFileTree = async (item: any, path: string = '', folderName: string = ''): Promise<{file: File, folderName?: string, folderPath?: string}[]> => {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file((file: File) => {
          resolve([{ file, folderName, folderPath: path }]);
        });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        dirReader.readEntries(async (entries: any[]) => {
          const promises = entries.map(entry => traverseFileTree(entry, path + item.name + '/', folderName || item.name));
          const results = await Promise.all(promises);
          resolve(results.flat());
        });
      } else {
        resolve([]);
      }
    });
  };

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.items) {
      const items = Array.from(e.dataTransfer.items);
      const promises = (items as any[]).map(item => {
        const entry = (item as any).webkitGetAsEntry();
        if (entry) {
          return traverseFileTree(entry);
        }
        return Promise.resolve([]);
      });
      const results = await Promise.all(promises);
      const allFiles = results.flat();
      if (allFiles.length > 0) {
        handleFiles(allFiles);
      }
    } else if (e.dataTransfer.files) {
      const fileObjects = Array.from(e.dataTransfer.files).map(file => ({ file }));
      handleFiles(fileObjects);
    }
  }, [handleFiles]);

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter(i => i.id !== id);
    });
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const handleToggleSelect = (id: string) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedItemIds.size === items.length && items.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(items.map(i => i.id)));
    }
  };

  const clearAll = () => {
    items.forEach(item => URL.revokeObjectURL(item.url));
    setItems([]);
    setSelectedItemIds(new Set());
  };

  const getActiveItems = () => selectedItemIds.size > 0 ? items.filter(i => selectedItemIds.has(i.id)) : items;

  const handleExportGrid = async () => {
    const activeItems = getActiveItems();
    if (activeItems.length === 0) return;

    const { allowed } = await checkAccess("Multi SVGA Export");
    if (!allowed) {
      if (onSubscriptionRequired) onSubscriptionRequired();
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    if (currentUser) {
      logActivity(currentUser, "export", `Multi SVGA Grid Export: ${activeItems.length} files`);
    }

    const renderContainer = document.createElement("div");
    renderContainer.style.position = "fixed";
    renderContainer.style.left = "-10000px";
    renderContainer.style.top = "0";
    renderContainer.style.width = "1920px";
    renderContainer.style.height = "1080px";
    renderContainer.style.overflow = "hidden";
    renderContainer.style.zIndex = "-1000";
    renderContainer.style.pointerEvents = "none";
    document.body.appendChild(renderContainer);

    try {
      const targetFps = 30;
      let canvasWidth: number;
      let canvasHeight: number;
      let cols: number;
      let rows: number;

      if (activeItems.length === 1) {
        const item = activeItems[0];
        canvasWidth = DEVICE_PRESETS.find(p => p.id === item.presetId)?.width || item.dimensions?.width || 500;
        canvasHeight = DEVICE_PRESETS.find(p => p.id === item.presetId)?.height || item.dimensions?.height || 500;
        cols = 1;
        rows = 1;
      } else {
        canvasWidth = exportResolution === "1080p" ? 1920 : (exportResolution === "720p" ? 1280 : 1080);
        canvasHeight = exportResolution === "1080p" ? 1080 : (exportResolution === "720p" ? 720 : 1080);
        if (forceMobileSize) {
          canvasWidth = exportResolution === "1080p" ? 1080 : 720;
          canvasHeight = exportResolution === "1080p" ? 1920 : 1280;
        }
        cols = Math.ceil(Math.sqrt(activeItems.length));
        rows = Math.ceil(activeItems.length / cols);
      }

      const padding = activeItems.length === 1 ? 0 : 20;
      const availableWidth = canvasWidth - (padding * (cols + 1));
      const availableHeight = canvasHeight - (padding * (rows + 1));
      const cardW = availableWidth / cols;
      const cardH = availableHeight / rows;

      const finalWidth = Math.round(canvasWidth / 2) * 2;
      const finalHeight = Math.round(canvasHeight / 2) * 2;

      const canvas = document.createElement("canvas");
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;

      let maxFrames = 0;
      activeItems.forEach(item => {
        const frames = item.frames || 1;
        const fps = item.fps || 30;
        const duration = frames / fps;
        maxFrames = Math.max(maxFrames, duration * targetFps);
      });
      const totalFrames = exportDuration ? exportDuration * targetFps : Math.min(maxFrames, 15 * targetFps);

      let bgImg: HTMLImageElement | null = null;
      if (previewBg) {
        bgImg = await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.src = previewBg;
        });
      }

      let wmImg: HTMLImageElement | null = null;
      if (watermark) {
        wmImg = await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.src = watermark;
        });
      }

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: finalWidth, height: finalHeight },
        fastStart: "in-memory"
      });

      let hasEncoderError = false;
      const videoEncoder = new VideoEncoder({
        output: (chunk, metadata) => {
          let safeMetadata: any = undefined;
          if (metadata) {
            safeMetadata = { ...metadata };
            if (safeMetadata.decoderConfig) {
              safeMetadata.decoderConfig = { ...safeMetadata.decoderConfig };
              if (safeMetadata.decoderConfig.colorSpace === null) {
                delete safeMetadata.decoderConfig.colorSpace;
              }
            } else if (safeMetadata.decoderConfig === null) {
              delete safeMetadata.decoderConfig;
            }
          }
          muxer.addVideoChunk(chunk, safeMetadata);
        },
        error: (e) => {
          console.error("Encoder Error:", e);
          hasEncoderError = true;
          if (videoEncoder.state !== "closed") alert("خطأ في ترميز الفيديو: " + e.message);
        }
      });

      const offscreenPlayers = [];
      for (let i = 0; i < activeItems.length; i++) {
        const item = activeItems[i];
        const w = activeItems.length === 1 ? (DEVICE_PRESETS.find(p => p.id === item.presetId)?.width || item.dimensions?.width || 500) : cardW;
        const h = activeItems.length === 1 ? (DEVICE_PRESETS.find(p => p.id === item.presetId)?.height || item.dimensions?.height || 500) : cardH;
        
        const div = document.createElement("div");
        div.style.width = w + "px";
        div.style.height = h + "px";
        div.style.position = "absolute";
        div.style.left = "0";
        div.style.top = "0";
        renderContainer.appendChild(div);

        let player, internalCanvas;
        try {
          if (item.type === "pag") {
            const PAG = await getPAG();
            let pagFile = item.pagFile;
            if (!pagFile) {
              pagFile = await PAG.PAGFile.load(await item.file.arrayBuffer());
              item.pagFile = pagFile;
            }
            internalCanvas = document.createElement("canvas");
            const canvasId = "pag_export_" + Math.random().toString(36).substring(2, 9);
            internalCanvas.id = canvasId;
            internalCanvas.width = item.dimensions?.width || 500;
            internalCanvas.height = item.dimensions?.height || 500;
            internalCanvas.style.width = "100%";
            internalCanvas.style.height = "100%";
            internalCanvas.style.objectFit = "contain";
            div.appendChild(internalCanvas);
            
            player = await PAG.PAGPlayer.create();
            player.setComposition(pagFile);
            const pagSurface = PAG.PAGSurface.fromCanvas('#' + canvasId);
            if (pagSurface) {
              pagSurface.updateSize();
              player.setSurface(pagSurface);
            }
            player.setVideoEnabled(true);
            player.setProgress(0);
            await player.flush();
          } else {
            const videoItem = await parseSvgaIfNeeded(item);
            player = new SVGA.Player(div);
            player.setVideoItem(videoItem);
            player.setContentMode(DEVICE_PRESETS.find(p => p.id === item.presetId) ? 'AspectFill' : 'AspectFit');
            internalCanvas = div.querySelector("canvas");
          }
          
          offscreenPlayers.push({ player, div, item, cardW, cardH, internalCanvas });
        } catch (e) {
          console.warn("Skipping item due to load error in grid export:", e);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
      for (let i = 0; i < offscreenPlayers.length; i++) {
        const { player, item } = offscreenPlayers[i];
        if (item.type === "pag") {
          player.setProgress(0);
          await player.flush();
        } else {
          player.stepToFrame(0, false);
        }
      }

      try {
        videoEncoder.configure({
          codec: "avc1.4D002A",
          width: finalWidth,
          height: finalHeight,
          bitrate: 2_500_000,
          framerate: targetFps
        });
      } catch (e) {
        console.error("Encoder Configuration Error:", e);
        alert("خطأ في إعدادات ترميز الفيديو: " + (e instanceof Error ? e.message : String(e)));
        document.body.removeChild(renderContainer);
        setIsExporting(false);
        setExportProgress(0);
        return;
      }

      for (let frame = 0; frame < totalFrames; frame++) {
        if (bgImg) {
          ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        for (let index = 0; index < offscreenPlayers.length; index++) {
          const { player, item, cardW, cardH, internalCanvas } = offscreenPlayers[index];
          let x, y;
          if (activeItems.length === 1) {
            x = 0;
            y = 0;
          } else {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const scaleX = canvas.width / canvasWidth;
            const scaleY = canvas.height / canvasHeight;
            x = (padding + col * (cardW + padding)) * scaleX;
            y = (padding + row * (cardH + padding)) * scaleY;
            const scaledCardW = cardW * scaleX;
            const scaledCardH = cardH * scaleY;
            
            ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
            ctx.beginPath();
            ctx.roundRect(x, y, scaledCardW, scaledCardH, 40 * Math.min(scaleX, scaleY));
            ctx.fill();
          }

          const elapsedSeconds = frame / targetFps;
          if (item.type === "pag") {
            const durationSec = (item.pagFile?.duration() / 1000000) || 1;
            try {
              player.setProgress((elapsedSeconds % durationSec) / durationSec);
              await player.flush();
            } catch (e) { console.warn("PAG export frame error", e); }
          } else {
            const itemFrame = Math.floor(elapsedSeconds * (item.fps || 30)) % (item.frames || 1);
            try {
              player.stepToFrame(itemFrame, false);
            } catch (e) { console.warn("SVGA export frame error", e); }
          }

          if (internalCanvas) {
            const sw = item.dimensions?.width || 500;
            const sh = item.dimensions?.height || 500;
            const scale = Math.min(cardW / sw, cardH / sh);
            const finalW = sw * scale;
            const finalH = sh * scale;
            const scaleX = canvas.width / canvasWidth;
            const scaleY = canvas.height / canvasHeight;
            const dx = (x + (cardW * scaleX - finalW * scaleX) / 2);
            const dy = (y + (cardH * scaleY - finalH * scaleY) / 2);
            
            ctx.save();
            ctx.beginPath();
            if (activeItems.length > 1) {
              ctx.roundRect(x, y, cardW * scaleX, cardH * scaleY, 40 * Math.min(scaleX, scaleY));
            } else {
              ctx.rect(x, y, canvas.width, canvas.height);
            }
            ctx.clip();
            ctx.drawImage(internalCanvas, dx, dy, finalW * scaleX, finalH * scaleY);
            ctx.restore();
          }
        }

        if (wmImg) {
          const wmSize = Math.min(canvas.width, canvas.height) * (wmSettings.size / 100);
          let wx = 0, wy = 0;
          if (wmSettings.isAnimated) {
            const speed = wmSettings.animationSpeed;
            const pxPerFrame = speed * 2;
            const maxX = canvas.width - wmSize;
            const maxY = canvas.height - wmSize;
            const distX = frame * pxPerFrame;
            const distY = frame * pxPerFrame;
            const modX = distX % (maxX * 2);
            const modY = distY % (maxY * 2);
            wx = modX > maxX ? (maxX * 2) - modX : modX;
            wy = modY > maxY ? (maxY * 2) - modY : modY;
          } else {
            switch(wmSettings.position) {
              case "top-left": wx = 40; wy = 40; break;
              case "top-right": wx = canvas.width - wmSize - 40; wy = 40; break;
              case "bottom-left": wx = 40; wy = canvas.height - wmSize - 40; break;
              case "bottom-right": wx = canvas.width - wmSize - 40; wy = canvas.height - wmSize - 40; break;
              case "center": wx = (canvas.width - wmSize) / 2; wy = (canvas.height - wmSize) / 2; break;
            }
          }
          ctx.globalAlpha = wmSettings.opacity;
          ctx.drawImage(wmImg, wx, wy, wmSize, wmSize);
          ctx.globalAlpha = 1.0;
        }

        const timestamp = (frame / targetFps) * 1_000_000;
        const videoFrame = new VideoFrame(canvas, { timestamp });

        while (videoEncoder.encodeQueueSize > 30) { await new Promise(r => setTimeout(r, 1)); }

        if (hasEncoderError) break;
        videoEncoder.encode(videoFrame, { keyFrame: frame % 30 === 0 });
        videoFrame.close();

        if (frame % 15 === 0) { await new Promise(r => setTimeout(r, 0)); setExportProgress(Math.round((frame / totalFrames) * 100));
        }
      }

      if (hasEncoderError) {
        if (videoEncoder.state !== "closed") {
          try { videoEncoder.close(); } catch(e) {}
        }
        throw new Error("حدث خطأ أثناء تشفير الفيديو. يرجى تقليل الجودة أو استخدام متصفح أحدث.");
      } else {
        if (videoEncoder.state !== "closed") {
          await videoEncoder.flush();
          videoEncoder.close();
        }
        muxer.finalize();
      }

      let { buffer } = muxer.target as ArrayBufferTarget;

      // Audio export disabled as requested by the user
      // if (itemWithAudio) { ... }

      const blob = new Blob([buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SVGA_Record_${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
      alert("حدث خطأ أثناء التصدير.");
    } finally {
      document.body.removeChild(renderContainer);
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleExportIndividualVideos = async (itemsToExport?: MultiSvgaItem[]) => {
    const list = itemsToExport || getActiveItems();
    if (list.length === 0) return;

    const nameCounts: Record<string, number> = {};
    const uniqueNames: Record<string, string> = {};
    list.forEach(item => {
      let folderPrefix = "";
      if (item.folderPath) {
        folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
      }
      const rawName = item.name.replace(/\.[^/.]+$/, "");
      const fullPath = folderPrefix + rawName;
      if (nameCounts[fullPath]) {
        nameCounts[fullPath]++;
        uniqueNames[item.id] = `${rawName}_${nameCounts[fullPath]}`;
      } else {
        nameCounts[fullPath] = 1;
        uniqueNames[item.id] = rawName;
      }
    });


    const { allowed } = await checkAccess("Multi SVGA Individual Export");
    if (!allowed) {
      if (onSubscriptionRequired) onSubscriptionRequired();
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    if (currentUser) {
      logActivity(currentUser, "export", `Individual Video Export: ${list.length} files`);
    }

    const targetFps = 30;

    let bgImg: HTMLImageElement | null = null;
    if (previewBg) {
      bgImg = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = previewBg;
      });
    }

    let wmImg: HTMLImageElement | null = null;
    if (watermark) {
      wmImg = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = watermark;
      });
    }

    let streamZip: any = null;
    if (list.length > 1) {
      try {
        streamZip = await createStreamingZip(`Individual_Videos_${Date.now()}.zip`);
      } catch (err: any) {
        if (err?.message === "USER_ABORT") {
          setIsExporting(false);
          setExportProgress(0);
          return;
        }
      }
    }

    const renderContainer = document.createElement("div");
    renderContainer.style.position = "fixed";
    renderContainer.style.left = "-10000px";
    renderContainer.style.top = "0";
    renderContainer.style.width = "1920px";
    renderContainer.style.height = "1920px";
    renderContainer.style.overflow = "hidden";
    renderContainer.style.zIndex = "-1000";
    renderContainer.style.pointerEvents = "none";
    document.body.appendChild(renderContainer);

    try {
      
      let completedCount = 0;
      const CONCURRENCY = 2; // Reduced to save memory
      for (let batchStart = 0; batchStart < list.length; batchStart += CONCURRENCY) {
        const batch = list.slice(batchStart, batchStart + CONCURRENCY);
        await Promise.all(batch.map(async (item, batchIdx) => {
          const i = batchStart + batchIdx; try {
          
        
        setExportProgress(Math.round((completedCount / list.length) * 100));

        const preset = DEVICE_PRESETS.find(p => p.id === item.presetId);
        let itemW = preset?.width || item.dimensions?.width || 500;
        let itemH = preset?.height || item.dimensions?.height || 500;

        if (forceMobileSize) {
          itemW = exportResolution === "1080p" ? 1080 : 720;
          itemH = exportResolution === "1080p" ? 1920 : 1280;
        } else if (exportResolution === "1080p") {
          if (itemH > itemW) { itemW = 1080; itemH = 1920; }
          else { itemW = 1920; itemH = 1080; }
        } else if (exportResolution === "720p") {
          if (itemH > itemW) { itemW = 720; itemH = 1280; }
          else { itemW = 1280; itemH = 720; }
        }

        const finalWidth = Math.round(itemW / 2) * 2;
        const finalHeight = Math.round(itemH / 2) * 2;

        const canvas = document.createElement("canvas");
        canvas.width = finalWidth;
        canvas.height = finalHeight;
        const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;

        const itemFrames = item.frames || 1;
        const itemFps = item.fps || 30;
        const durationSec = itemFrames / itemFps;
        const totalFrames = exportDuration ? exportDuration * targetFps : Math.min(Math.ceil(durationSec * targetFps), 15 * targetFps);

        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: "avc", width: finalWidth, height: finalHeight },
          fastStart: "in-memory"
        });

        let hasEncoderError = false;
        const videoEncoder = new VideoEncoder({
          output: (chunk, metadata) => {
            let safeMetadata: any = undefined;
            if (metadata) {
              safeMetadata = { ...metadata };
              if (safeMetadata.decoderConfig) {
                safeMetadata.decoderConfig = { ...safeMetadata.decoderConfig };
                if (safeMetadata.decoderConfig.colorSpace === null) {
                  delete safeMetadata.decoderConfig.colorSpace;
                }
              } else if (safeMetadata.decoderConfig === null) {
                delete safeMetadata.decoderConfig;
              }
            }
            muxer.addVideoChunk(chunk, safeMetadata);
          },
          error: (e) => {
            console.error("Encoder Error:", e);
            hasEncoderError = true;
          }
        });

        videoEncoder.configure({
          codec: "avc1.4D002A",
          width: finalWidth,
          height: finalHeight,
          bitrate: 2_500_000,
          framerate: targetFps
        });

        const div = document.createElement("div");
        div.style.width = finalWidth + "px";
        div.style.height = finalHeight + "px";
        div.style.position = "absolute";
        div.style.left = "0";
        div.style.top = "0";
        renderContainer.appendChild(div);

        let player: any = null;
        let internalCanvas: HTMLCanvasElement | null = null;
        let audioBytesToMux: Uint8Array | null = null;

        if (item.type === "pag") {
          const PAG = await getPAG();
          let pagFile = item.pagFile;
          if (!pagFile) {
            pagFile = await PAG.PAGFile.load(await item.file.arrayBuffer());
            item.pagFile = pagFile;
          }
          internalCanvas = document.createElement("canvas");
          const canvasId = "pag_indiv_" + Math.random().toString(36).substring(2, 9);
          internalCanvas.id = canvasId;
          internalCanvas.width = item.dimensions?.width || 500;
          internalCanvas.height = item.dimensions?.height || 500;
          internalCanvas.style.width = "100%";
          internalCanvas.style.height = "100%";
          internalCanvas.style.objectFit = "contain";
          div.appendChild(internalCanvas);

          player = await PAG.PAGPlayer.create();
          player.setComposition(pagFile);
          const pagSurface = PAG.PAGSurface.fromCanvas('#' + canvasId);
          if (pagSurface) {
            pagSurface.updateSize();
            player.setSurface(pagSurface);
          }
          player.setVideoEnabled(true);
          player.setProgress(0);
          await player.flush();
        } else {
          const videoItem = await parseSvgaIfNeeded(item);
          player = new SVGA.Player(div);
          player.setVideoItem(videoItem);
          player.setContentMode(preset ? 'AspectFill' : 'AspectFit');
          player.stepToFrame(0, false);
          internalCanvas = div.querySelector("canvas");
          
          try {
            const audioData = await extractAudioFromSvga(videoItem);
            if (audioData.audioBytes) {
               audioBytesToMux = audioData.audioBytes;
            }
          } catch (e) {
            console.warn("Could not extract audio for export", e);
          }
        }

        await new Promise(r => setTimeout(r, 200));

        for (let frame = 0; frame < totalFrames; frame++) {
          if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, finalWidth, finalHeight);
          } else {
            ctx.fillStyle = "#0f172a";
            ctx.fillRect(0, 0, finalWidth, finalHeight);
          }

          const elapsedSeconds = frame / targetFps;
          if (item.type === "pag") {
            const pagDur = (item.pagFile?.duration() / 1000000) || 1;
            try {
              player.setProgress((elapsedSeconds % pagDur) / pagDur);
              await player.flush();
            } catch (e) { console.warn("PAG export frame error", e); }
          } else {
            const itemFrame = Math.floor(elapsedSeconds * (item.fps || 30)) % (item.frames || 1);
            try {
              player.stepToFrame(itemFrame, false);
            } catch (e) { console.warn("SVGA export frame error", e); }
          }

          if (internalCanvas) {
            const sw = internalCanvas.width || item.dimensions?.width || 500;
            const sh = internalCanvas.height || item.dimensions?.height || 500;
            const scale = Math.min(finalWidth / sw, finalHeight / sh);
            const drawW = sw * scale;
            const drawH = sh * scale;
            const dx = (finalWidth - drawW) / 2;
            const dy = (finalHeight - drawH) / 2;

            ctx.drawImage(internalCanvas, dx, dy, drawW, drawH);
          }

          if (wmImg) {
            const wmSize = Math.min(finalWidth, finalHeight) * (wmSettings.size / 100);
            let wx = 0, wy = 0;
            if (wmSettings.isAnimated) {
              const speed = wmSettings.animationSpeed;
              const pxPerFrame = speed * 2;
              const maxX = finalWidth - wmSize;
              const maxY = finalHeight - wmSize;
              const distX = frame * pxPerFrame;
              const distY = frame * pxPerFrame;
              const modX = distX % (maxX * 2);
              const modY = distY % (maxY * 2);
              wx = modX > maxX ? (maxX * 2) - modX : modX;
              wy = modY > maxY ? (maxY * 2) - modY : modY;
            } else {
              switch (wmSettings.position) {
                case "top-left": wx = 20; wy = 20; break;
                case "top-right": wx = finalWidth - wmSize - 20; wy = 20; break;
                case "bottom-left": wx = 20; wy = finalHeight - wmSize - 20; break;
                case "bottom-right": wx = finalWidth - wmSize - 20; wy = finalHeight - wmSize - 20; break;
                case "center": wx = (finalWidth - wmSize) / 2; wy = (finalHeight - wmSize) / 2; break;
              }
            }
            ctx.globalAlpha = wmSettings.opacity;
            ctx.drawImage(wmImg, wx, wy, wmSize, wmSize);
            ctx.globalAlpha = 1.0;
          }

          const timestamp = (frame / targetFps) * 1_000_000;
          const videoFrame = new VideoFrame(canvas, { timestamp });

          while (videoEncoder.encodeQueueSize > 30) { await new Promise(r => setTimeout(r, 1)); }

          if (hasEncoderError) break;
          videoEncoder.encode(videoFrame, { keyFrame: frame % 30 === 0 });
          videoFrame.close();

          if (frame % 15 === 0) { await new Promise(r => setTimeout(r, 0)); }
        }

        if (hasEncoderError) {
          if (videoEncoder.state !== "closed") {
            try { videoEncoder.close(); } catch(e) {}
          }
          throw new Error("حدث خطأ أثناء تشفير الفيديو. يرجى تقليل الجودة أو استخدام متصفح أحدث.");
        } else {
          if (videoEncoder.state !== "closed") {
            await videoEncoder.flush();
            videoEncoder.close();
          }
          muxer.finalize();
        }

        let { buffer } = muxer.target as ArrayBufferTarget;
        
        let finalMp4Buffer = buffer;

        if (audioBytesToMux) {
            try {
                const ffmpeg = await ensureFFmpeg();
                if (ffmpeg) {
                    const videoName = `vid_${item.id}.mp4`;
                    const audioName = `aud_${item.id}.mp3`;
                    const outputName = `out_${item.id}.mp4`;
                    
                    await ffmpeg.writeFile(videoName, new Uint8Array(buffer));
                    await ffmpeg.writeFile(audioName, audioBytesToMux);
                    
                    const durationSec = totalFrames / targetFps;
                    
                    await ffmpeg.exec([
                        '-i', videoName,
                        '-i', audioName,
                        '-c:v', 'copy',
                        '-c:a', 'aac',
                        '-map', '0:v:0',
                        '-map', '1:a:0',
                        '-t', durationSec.toString(),
                        outputName
                    ]);
                    
                    const outData = await ffmpeg.readFile(outputName);
                    finalMp4Buffer = (outData as Uint8Array).buffer;
                    
                    ffmpeg.deleteFile(videoName);
                    ffmpeg.deleteFile(audioName);
                    ffmpeg.deleteFile(outputName);
                }
            } catch (e) {
                console.error("FFmpeg audio muxing failed for", item.name, e);
            }
        }

        renderContainer.removeChild(div);
        if (item.type === "pag" && player) {
          try { player.destroy?.(); } catch (e) {}
        }

        const cleanName = uniqueNames[item.id];
        const folderPrefix = item.folderPath ? `${item.folderPath}/` : '';
        const mp4Filename = `${folderPrefix}${cleanName}.mp4`;

        if (streamZip) {
          // ONLY Add MP4 video file to ZIP archive
          streamZip.addFile(mp4Filename, new Uint8Array(finalMp4Buffer));
        } else {
          // Single video direct download
          const blob = new Blob([finalMp4Buffer], { type: "video/mp4" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${cleanName}.mp4`;
          a.click();
          URL.revokeObjectURL(url);
        }

        if (list.length > 5) {
          item.videoItem = null;
        }
          } catch (e) { console.warn("Failed individual export", e); } completedCount++;
          setExportProgress(Math.round((completedCount / list.length) * 100));
        }));
      }


      if (streamZip) {
        await streamZip.close();
      }
    } catch (error) {
      console.error("Individual video export error:", error);
      alert("حدث خطأ أثناء تصدير الفيديوهات المستقلة.");
      if (streamZip) {
        try { await streamZip.abort(); } catch(e) {}
      }
    } finally {
      if (document.body.contains(renderContainer)) {
        document.body.removeChild(renderContainer);
      }
      setIsExporting(false);
      setExportProgress(0);
    }
  };
  const parseSvgaIfNeeded = async (item: MultiSvgaItem): Promise<any> => {
    // ensure videoItem is valid and has images before returning early
    if (item.videoItem && item.videoItem.images) return item.videoItem;
    
    return new Promise((resolve, reject) => {
      const parser = new SVGA.Parser();
      // Bypass cache just in case player.clear() destructed the cached images previously
      const bypassUrl = item.url + '#' + Math.random().toString(36).substr(2, 9);
      parser.load(bypassUrl, (videoItem: any) => {
        if (!videoItem || !videoItem.images) {
          return reject(new Error("Invalid SVGA format - missing images"));
        }
        item.videoItem = videoItem;
        item.dimensions = { 
          width: videoItem.videoSize?.width || 500, 
          height: videoItem.videoSize?.height || 500 
        };
        item.fps = videoItem.FPS || videoItem.fps || 30;
        item.frames = videoItem.frames || 1;
        resolve(videoItem);
      }, reject);
    });
  };

  const captureFrame = async (item: MultiSvgaItem, frameIndex: number = 0): Promise<Blob> => {
    let dw = selectedPreset ? selectedPreset.width : (item.dimensions?.width || 500);
    let dh = selectedPreset ? selectedPreset.height : (item.dimensions?.height || 500);

    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    
    // Create context ONCE with alpha: true
    const ctx = canvas.getContext('2d', { alpha: true })!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (item.type === 'pag') {
      const PAG = await getPAG();
      let pagFile = item.pagFile;
      if (!pagFile) {
        pagFile = await PAG.PAGFile.load(await item.file.arrayBuffer());
      }
      
      if (!item.dimensions) {
        item.dimensions = { width: pagFile.width(), height: pagFile.height() };
        if (!selectedPreset) {
          dw = item.dimensions.width;
          dh = item.dimensions.height;
          canvas.width = dw;
          canvas.height = dh;
        }
      }

      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.id = "pag_capture_" + Math.random().toString(36).substring(2, 9);
      tmpCanvas.width = item.dimensions?.width || pagFile.width();
      tmpCanvas.height = item.dimensions?.height || pagFile.height();
      tmpCanvas.style.position = 'fixed';
      tmpCanvas.style.left = '0px';
      tmpCanvas.style.top = '0px';
      tmpCanvas.style.opacity = '0.001';
      tmpCanvas.style.pointerEvents = 'none';
      document.body.appendChild(tmpCanvas);

      try {
        const pagPlayer = await PAG.PAGPlayer.create();
        pagPlayer.setComposition(pagFile);
        const pagSurface = PAG.PAGSurface.fromCanvas('#' + tmpCanvas.id);
        if (pagSurface) {
           pagPlayer.setSurface(pagSurface);
        }
        
        let targetProgress = 0.5;
        if (item.frames) {
           let framesToJump = frameIndex;
           if (frameIndex === 0) framesToJump = Math.floor(item.frames / 2);
           targetProgress = framesToJump / item.frames;
        }
        
        pagPlayer.setProgress(targetProgress);
        await pagPlayer.flush();

        const sw = tmpCanvas.width;
        const sh = tmpCanvas.height;
        const scale = Math.min(dw / sw, dh / sh);
        const finalW = sw * scale;
        const finalH = sh * scale;
        const x = (dw - finalW) / 2;
        const y = (dh - finalH) / 2;
        ctx.drawImage(tmpCanvas, x, y, finalW, finalH);

        try { pagPlayer.destroy?.(); } catch (e) {}
        try { pagSurface?.destroy?.(); } catch (e) {}
      } finally {
        document.body.removeChild(tmpCanvas);
      }
    } else {
      const videoItem = await parseSvgaIfNeeded(item);
      if (!item.dimensions) item.dimensions = { width: 500, height: 500 };
      
      const div = document.createElement('div');
      div.style.width = `${item.dimensions.width}px`;
      div.style.height = `${item.dimensions.height}px`;
      div.style.position = 'fixed';
      div.style.left = '0px';
      div.style.top = '0px';
      div.style.opacity = '0.001';
      div.style.pointerEvents = 'none';
      div.style.backgroundColor = 'transparent';
      document.body.appendChild(div);

      let player: any;
      try {
        player = new SVGA.Player(div);
        player.clearsAfterStop = false;
        
        const attemptRender = async (targetFrame: number) => {
            return new Promise<void>((resolve, reject) => {
              try {
                  player.setVideoItem(videoItem);
                  player.setContentMode('AspectFit'); 
                  
                  let resolved = false;
                  const doResolve = () => {
                    if (!resolved) { resolved = true; resolve(); }
                  };
        
                  player.onFrame = (frame: number) => {
                      if (frame === targetFrame) {
                           setTimeout(doResolve, 50);
                           player.pauseAnimation();
                      }
                  };
                  
                  player.stepToFrame(targetFrame, true); 
                  setTimeout(doResolve, 500);
              } catch(err) {
                  reject(err);
              }
            });
        };

        let framesToJump = 0;
        if (frameIndex > 0) {
          framesToJump = Math.min(frameIndex, (item.frames || 1) - 1);
        }

        try {
            await attemptRender(framesToJump);
        } catch (e) {
            console.warn("Failed to render frame", framesToJump, "falling back to frame 0", e);
            if (framesToJump !== 0) {
                await attemptRender(0);
            }
        }
        
        const svgaCanvas = div.querySelector('canvas');
        if (svgaCanvas) {
          const sw = item.dimensions.width;
          const sh = item.dimensions.height;
          // Manual AspectFit calculation
          const scale = Math.min(dw / sw, dh / sh);
          const finalW = sw * scale;
          const finalH = sh * scale;
          const x = (dw - finalW) / 2;
          const y = (dh - finalH) / 2;
          ctx.drawImage(svgaCanvas, x, y, finalW, finalH);
        }
        
        // Drop videoItem reference specifically for large exports to save memory!
        if ((items as any[]).length > 50) { 
           item.videoItem = undefined;
        }
      } finally {
        if (player) {
          try { player.clear(); } catch(e) {}
        }
        document.body.removeChild(div);
      }
    }

    // Draw Watermark
    if (watermark) {
      try {
        const wmImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = watermark;
        });
        ctx.globalAlpha = wmSettings.opacity;
        const wmSize = Math.min(canvas.width, canvas.height) * (wmSettings.size / 100);
        let wx = 0, wy = 0;
        
        // For static image capture, if animated we just place it in center or a calculated position
        // Since it's a single frame, we just use a default or frame 0 position
        if (wmSettings.isAnimated) {
           wx = (canvas.width - wmSize) / 2;
           wy = (canvas.height - wmSize) / 2;
        } else {
          switch(wmSettings.position) {
            case 'top-left': wx = 20; wy = 20; break;
            case 'top-right': wx = canvas.width - wmSize - 20; wy = 20; break;
            case 'bottom-left': wx = 20; wy = canvas.height - wmSize - 20; break;
            case 'bottom-right': wx = canvas.width - wmSize - 20; wy = canvas.height - wmSize - 20; break;
            case 'center': wx = (canvas.width - wmSize) / 2; wy = (canvas.height - wmSize) / 2; break;
          }
        }
        
        ctx.drawImage(wmImg, wx, wy, wmSize, wmSize);
        ctx.globalAlpha = 1.0;
      } catch (e) {
        console.error("Failed to load watermark for capture", e);
      }
    }

    return new Promise((resolve) => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  };

  const handleDownloadAllImages = async () => {
    const activeItems = getActiveItems();
    if (activeItems.length === 0) return;

    const nameCounts: Record<string, number> = {};
    const uniqueNames: Record<string, string> = {};
    activeItems.forEach(item => {
      let folderPrefix = "";
      if (item.folderPath) {
        folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
      }
      const rawName = item.name.replace(/\.[^/.]+$/, "");
      const fullPath = folderPrefix + rawName;
      if (nameCounts[fullPath]) {
        nameCounts[fullPath]++;
        uniqueNames[item.id] = `${rawName}_${nameCounts[fullPath]}`;
      } else {
        nameCounts[fullPath] = 1;
        uniqueNames[item.id] = rawName;
      }
    });

    
    let zipStream;
    try {
        zipStream = await createStreamingZip(`SVGA_Images_${Date.now()}.zip`);
    } catch (e: any) {
        if (e.message === "USER_ABORT") return;
        console.error(e);
        return;
    }

    const { allowed } = await checkAccess('Multi SVGA ZIP Export');
    if (!allowed) {
      if (zipStream.abort) await zipStream.abort();
      if (onSubscriptionRequired) onSubscriptionRequired();
      return;
    }

    setIsZipping(true);
    setExportProgress(0);
    
    if (currentUser) {
      logActivity(currentUser, 'export', `Multi SVGA ZIP Export: ${activeItems.length} files`);
    }

    try {
        for (let i = 0; i < activeItems.length; i++) {
          const item = activeItems[i];
          let folderPrefix = "";
          if (item.folderPath) {
            folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
          }
    
          const blob = await captureFrame(item, Math.floor(item.frames / 2));
          const arrayBuffer = await blob.arrayBuffer();
          const baseName = uniqueNames[item.id];
          
          zipStream.addFile(`${folderPrefix}${baseName}.png`, new Uint8Array(arrayBuffer));
          setExportProgress(Math.round(((i + 1) / activeItems.length) * 100));
          
          // Allow GC
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        await zipStream.close();
    } catch (e) {
        console.error("Export failed", e);
    } finally {
        setIsZipping(false);
    }
  };

  const handleDownloadAllSvga = async () => {
    const activeItems = getActiveItems();
    if (activeItems.length === 0) return;

    const nameCounts: Record<string, number> = {};
    const uniqueNames: Record<string, string> = {};
    activeItems.forEach(item => {
      let folderPrefix = "";
      if (item.folderPath) {
        folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
      }
      const rawName = item.name.replace(/\.[^/.]+$/, "");
      const fullPath = folderPrefix + rawName;
      if (nameCounts[fullPath]) {
        nameCounts[fullPath]++;
        uniqueNames[item.id] = `${rawName}_${nameCounts[fullPath]}`;
      } else {
        nameCounts[fullPath] = 1;
        uniqueNames[item.id] = rawName;
      }
    });


    let zipStream;
    try {
        zipStream = await createStreamingZip(`SVGA_Files_${Date.now()}.zip`);
    } catch (e: any) {
        if (e.message === "USER_ABORT") return;
        console.error(e);
        return;
    }

    const { allowed } = await checkAccess('Multi SVGA Files Export');
    if (!allowed) {
      if (zipStream.abort) await zipStream.abort();
      if (onSubscriptionRequired) onSubscriptionRequired();
      return;
    }

    setIsZipping(true);
    setExportProgress(0);
    
    if (currentUser) {
      logActivity(currentUser, 'export', `Multi SVGA Files Export: ${activeItems.length} files`);
    }

    try {
        for (let i = 0; i < activeItems.length; i++) {
          const item = activeItems[i];
          let folderPrefix = "";
          if (item.folderPath) {
            folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
          }
    
          const baseName = uniqueNames[item.id];
    
          if (item.type === "pag") {
            const result = await convertPagToSvga(item.file, { targetFps: item.fps || 30, compressionQuality: 100, onProgress: (p) => setExportProgress(Math.round(((i + p/100) / activeItems.length) * 100)) });
            const arrayBuffer = await result.svgaBlob.arrayBuffer();
            zipStream.addFile(`${folderPrefix}${baseName}.svga`, new Uint8Array(arrayBuffer));
          } else {
            const arrayBuffer = await item.file.arrayBuffer();
            zipStream.addFile(`${folderPrefix}${baseName}.svga`, new Uint8Array(arrayBuffer));
          }

          // ADD IMAGES AS REQUESTED
          try {
             const blob = await captureFrame(item, 0);
             const pngArrayBuffer = await blob.arrayBuffer();
             zipStream.addFile(`${folderPrefix}${baseName}.png`, new Uint8Array(pngArrayBuffer));
          } catch(err) {
             console.error("Failed to capture PNG for", item.name, err);
          }

          setExportProgress(Math.round(((i + 1) / activeItems.length) * 100));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        await zipStream.close();
    } catch (e) {
        console.error("Export failed", e);
    } finally {
        setIsZipping(false);
    }
  };

  const handleDownloadAllCombined = async () => {
    const activeItems = getActiveItems();
    if (activeItems.length === 0) return;

    const nameCounts: Record<string, number> = {};
    const uniqueNames: Record<string, string> = {};
    activeItems.forEach(item => {
      let folderPrefix = "";
      if (item.folderPath) {
        folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
      }
      const rawName = item.name.replace(/\.[^/.]+$/, "");
      const fullPath = folderPrefix + rawName;
      if (nameCounts[fullPath]) {
        nameCounts[fullPath]++;
        uniqueNames[item.id] = `${rawName}_${nameCounts[fullPath]}`;
      } else {
        nameCounts[fullPath] = 1;
        uniqueNames[item.id] = rawName;
      }
    });

    
    let zipStream;
    try {
        zipStream = await createStreamingZip(`SVGA_Full_Package_${Date.now()}.zip`);
    } catch (e: any) {
        if (e.message === "USER_ABORT") return;
        console.error(e);
        return;
    }

    const { allowed } = await checkAccess('Multi SVGA Combined Export', { subscriptionOnly: true });
    if (!allowed) {
      if (zipStream.abort) await zipStream.abort();
      if (onSubscriptionRequired) onSubscriptionRequired();
      return;
    }

    setIsZipping(true);
    setExportProgress(0);

    try {
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
        let isFirstPage = true;

        for (let i = 0; i < activeItems.length; i++) {
          const item = activeItems[i];
          let folderPrefix = "";
          if (item.folderPath) {
            folderPrefix = item.folderPath.split('/').filter(Boolean).join('/') + "/";
          }
    
          const baseName = uniqueNames[item.id];
    
          // 1. Add SVGA file
          if (item.type === "pag") {
            const result = await convertPagToSvga(item.file, { targetFps: item.fps || 30, compressionQuality: 100, onProgress: (p) => setExportProgress(Math.round(((i + p/100) / activeItems.length) * 100)) });
            const arrayBuffer = await result.svgaBlob.arrayBuffer();
            zipStream.addFile(`${folderPrefix}${baseName}.svga`, new Uint8Array(arrayBuffer));
          } else {
            const arrayBuffer = await item.file.arrayBuffer();
            zipStream.addFile(`${folderPrefix}${baseName}.svga`, new Uint8Array(arrayBuffer));
          }
    
          // 2. Add PNG capture
          const blob = await captureFrame(item, Math.floor(item.frames / 2));
          const pngArrayBuffer = await blob.arrayBuffer();
          const pngUint8 = new Uint8Array(pngArrayBuffer);
          zipStream.addFile(`${folderPrefix}${baseName}.png`, pngUint8);

          // 3. Add to PDF
          let dw = selectedPreset ? selectedPreset.width : (item.dimensions?.width || 500);
          let dh = selectedPreset ? selectedPreset.height : (item.dimensions?.height || 500);
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = pdf.internal.pageSize.getHeight();
          const ratio = Math.min(pdfWidth / dw, pdfHeight / dh);
          
          const finalWidth = dw * ratio;
          const finalHeight = dh * ratio;
          const x = (pdfWidth - finalWidth) / 2;
          const y = (pdfHeight - finalHeight) / 2;

          if (!isFirstPage) {
              pdf.addPage();
          }
          
          pdf.addImage(pngUint8, 'PNG', x, y, finalWidth, finalHeight);
          isFirstPage = false;
    
          setExportProgress(Math.round(((i + 1) / activeItems.length) * 100));
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        // Add PDF to Zip
        const pdfArrayBuffer = pdf.output('arraybuffer');
        zipStream.addFile(`All_Images.pdf`, new Uint8Array(pdfArrayBuffer as ArrayBuffer));

        await zipStream.close();
    } catch (e) {
        console.error("Export failed", e);
    } finally {
        setIsZipping(false);
    }
  };

  const handleDownloadSingleImage = async (item: MultiSvgaItem) => {
    if (currentUser) {
      logActivity(currentUser, 'export', `Single SVGA Image Export: ${item.name}`);
    }
    const blob = await captureFrame(item, Math.floor(item.frames / 2));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.name.replace('.svga', '')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSvga = async (item: MultiSvgaItem) => {
    if (currentUser) {
      logActivity(currentUser, "export", `Single SVGA/PAG File Download: ${item.name}`);
    }
    let url = "";
    let downloadName = item.name;
    if (item.type === "pag") {
      setIsExporting(true);
      try {
        const result = await convertPagToSvga(item.file, { targetFps: item.fps || 30, compressionQuality: 100, onProgress: (p) => setExportProgress(p) });
        url = URL.createObjectURL(result.svgaBlob);
        downloadName = item.name.replace(/\.[^/.]+$/, "") + ".svga";
      } catch (e) {
        console.error(e);
        alert("Failed to convert");
        setIsExporting(false);
        return;
      }
      setIsExporting(false);
    } else {
      url = URL.createObjectURL(item.file);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  };


  const selectedItem = useMemo(() => items.find(i => i.id === selectedItemId), [items, selectedItemId]);

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-6">
        <div>
          <h2 className="text-3xl font-black text-white flex items-center gap-3">
            <Layers className="w-8 h-8 text-indigo-500" />
            نظام العرض الذكي لملفات SVGA
            {(items as any[]).length > 0 && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full"
              >
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                <span className="text-xs font-black text-indigo-400 uppercase tracking-widest">
                  {(items as any[]).length} {(items as any[]).length === 1 ? 'ملف مرفوع' : 'ملفات مرفوعة'}
                </span>
              </motion.div>
            )}
          </h2>
          <p className="text-slate-500 font-bold mt-1 uppercase tracking-widest text-xs">
            دعم كامل لجميع المقاسات (500×500, 750×1334, 2000×2000) مع الحفاظ على الجودة
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {(items as any[]).length > 0 && (
            <>
              {/* Standard Sizes */}
              <div className="flex items-center gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/10">
                <button 
                  onClick={() => {
                    setSelectedPresetId('ip8');
                    setItems(prev => prev.map(i => ({ ...i, presetId: 'ip8' })));
                  }}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${selectedPresetId === 'ip8' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white'}`}
                >
                  750 × 1334
                </button>
                <button 
                  onClick={() => {
                    setSelectedPresetId('sq500');
                    setItems(prev => prev.map(i => ({ ...i, presetId: 'sq500' })));
                  }}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${selectedPresetId === 'sq500' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white'}`}
                >
                  500 × 500
                </button>
                <button 
                  onClick={() => {
                    setSelectedPresetId('custom750x240');
                    setItems(prev => prev.map(i => ({ ...i, presetId: 'custom750x240' })));
                  }}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${selectedPresetId === 'custom750x240' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white'}`}
                >
                  750 × 240
                </button>
                <button 
                  onClick={() => {
                    setSelectedPresetId('auto');
                    setItems(prev => prev.map(i => ({ ...i, presetId: 'auto' })));
                  }}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${selectedPresetId === 'auto' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  تلقائي
                </button>
              </div>

              <div className="h-8 w-px bg-white/10 mx-1" />

              <div className="relative">
                <button 
                  onClick={() => setShowPresetMenu(!showPresetMenu)}
                  className={`px-6 py-3 rounded-2xl border font-black text-sm transition-all flex items-center gap-2 ${selectedPresetId !== 'auto' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                >
                  <Smartphone className="w-4 h-4" />
                  {selectedPreset ? selectedPreset.name : 'تلقائي (Native)'}
                </button>

                <AnimatePresence>
                  {showPresetMenu && (
                    <>
                      <div className="fixed inset-0 z-[100]" onClick={() => setShowPresetMenu(false)} />
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-4 w-[600px] max-h-[500px] bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden z-[110] flex flex-col"
                      >
                        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/2">
                          <h4 className="text-white font-black text-sm flex items-center gap-2">
                            <Monitor className="w-4 h-4 text-indigo-500" />
                            اختر مقاس العرض المفضل
                          </h4>
                          <button onClick={() => setSelectedPresetId('auto')} className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest">
                            إعادة للوضع التلقائي
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                          {['iPhone', 'Android', 'Tablet', 'PC'].map(cat => (
                            <div key={cat} className="mb-8 last:mb-0">
                              <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                                {cat === 'iPhone' ? 'سلسلة آيفون' : cat === 'Android' ? 'سلسلة أندرويد' : cat === 'Tablet' ? 'سلسلة الأجهزة اللوحية' : 'سلسلة الكمبيوتر'}
                              </h5>
                              <div className="grid grid-cols-3 gap-2">
                                {DEVICE_PRESETS.filter(p => p.category === cat).map(preset => (
                                  <button
                                    key={preset.id}
                                    onClick={() => {
                                      setSelectedPresetId(preset.id);
                                      setShowPresetMenu(false);
                                    }}
                                    className={`px-3 py-2.5 rounded-xl text-[10px] font-bold text-right transition-all border ${selectedPresetId === preset.id ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                                  >
                                    <div className="flex flex-col">
                                      <span>{preset.name}</span>
                                      <span className="text-[8px] opacity-50">{preset.width} × {preset.height}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              <div className="h-8 w-px bg-white/10 mx-2" />

              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">عدد الأعمدة:</span>
                <input 
                  type="number" 
                  min="1" 
                  max="5"
                  value={gridCols}
                  onChange={(e) => setGridCols(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                  className="w-16 bg-transparent text-white font-black text-sm focus:outline-none text-center"
                />
              </div>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={forceMobileSize}
                    onChange={(e) => setForceMobileSize(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">تصدير لمقاس جوال (9:16)</span>
                </label>
              </div>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">الدقة:</span>
                <select 
                  value={exportResolution}
                  onChange={(e) => setExportResolution(e.target.value as 'natural' | '720p' | '1080p')}
                  className="bg-transparent text-white font-black text-xs focus:outline-none"
                >
                  <option value="natural">طبيعي</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">مدة الفيديو (ثواني):</span>
                <input 
                  type="number" 
                  min="1" 
                  max="60"
                  value={exportDuration}
                  onChange={(e) => setExportDuration(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 bg-transparent text-white font-black text-sm focus:outline-none text-center"
                />
              </div>
              <button 
                onClick={handleDownloadAllCombined}
                disabled={isZipping || isExporting}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-600/20 font-black text-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isZipping ? `جاري التحضير ${exportProgress}%` : 'تنزيل الكل (SVGA + صور + PDF)'}
              </button>
              <button 
                onClick={handleDownloadAllSvga}
                disabled={isZipping || isExporting}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl shadow-lg shadow-blue-600/20 font-black text-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isZipping ? `جاري التحضير ${exportProgress}%` : 'تنزيل كل ملفات SVGA (ZIP)'}
              </button>

              <button 
                onClick={() => handleExportIndividualVideos()}
                disabled={isExporting || isZipping}
                className="relative overflow-hidden group px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl shadow-lg shadow-purple-600/20 font-black text-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                {isExporting ? `جاري التصدير ${exportProgress}%` : 'تصدير كل ملف فيديو منفصل (ZIP)'}
              </button>

              <button 
                onClick={handleExportGrid}
                disabled={isExporting || isZipping}
                className="relative overflow-hidden group px-8 py-3 bg-red-600/20 border border-red-500/30 rounded-full text-red-400 font-black text-xs uppercase tracking-[0.2em] hover:bg-red-600/30 transition-all flex items-center gap-3 disabled:opacity-50"
              >
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                {isExporting ? `جاري التسجيل ${exportProgress}%` : 'تسجيل فيديو مجمع (كل الملفات فيديو واحد)'}
                {isExporting && (
                  <motion.div 
                    className="absolute bottom-0 left-0 h-1 bg-red-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${exportProgress}%` }}
                  />
                )}
              </button>
              <button 
                onClick={handleSelectAll}
                className="px-6 py-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-2xl border border-indigo-500/20 font-black text-sm transition-all flex items-center gap-2"
              >
                <SquareCheck className="w-4 h-4" />
                {selectedItemIds.size === (items as any[]).length && (items as any[]).length > 0 ? 'إلغاء التحديد' : 'تحديد الكل'}
              </button>
              <button 
                onClick={clearAll}
                className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl border border-red-500/20 font-black text-sm transition-all flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                مسح الكل
              </button>
            </>
          )}
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl shadow-lg shadow-indigo-600/20 font-black text-sm transition-all flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            رفع ملفات
          </button>
          <button 
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.webkitdirectory = true;
              input.onchange = (e: any) => {
                if (e.target.files) {
                  const fileObjects = Array.from(e.target.files as FileList).map(file => ({
                    file,
                    folderPath: file.webkitRelativePath.split('/').slice(0, -1).join('/'),
                    folderName: file.webkitRelativePath.split('/').slice(-2, -1)[0]
                  }));
                  handleFiles(fileObjects);
                }
              };
              input.click();
            }}
            className="px-6 py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-2xl shadow-lg shadow-fuchsia-600/20 font-black text-sm transition-all flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            رفع مجلدات
          </button>
          <input 
            ref={fileInputRef}
            type="file" 
            multiple 
            accept=".svga,.pag" 
            className="hidden" 
            onChange={(e) => {
              if (e.target.files) {
                const fileObjects = Array.from(e.target.files).map(file => ({ file }));
                handleFiles(fileObjects);
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>

        {/* Toolbar: Background & Watermark */}
      <div className="flex flex-col gap-6 mb-6 bg-white/5 p-6 rounded-[2.5rem] border border-white/10">
        
        {loadProgress && (
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 flex flex-col gap-2 mb-4">
            <div className="flex justify-between items-center text-xs font-black">
              <span className="text-white flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> جاري التحميل...</span>
              <span className="text-indigo-400">{loadProgress.current} / {loadProgress.total}</span>
            </div>
            <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${(loadProgress.current / loadProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-8">
          <div className="flex items-center gap-3 border-r border-white/10 pr-6">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">الخلفية:</span>
            <div className="flex gap-2">
              <button 
                onClick={() => setPreviewBg(null)}
                className={`w-10 h-10 rounded-xl border transition-all ${!previewBg ? 'border-indigo-500 bg-indigo-500/20' : 'border-white/10 bg-white/5'}`}
                title="شفاف"
              >
                <X className="w-4 h-4 mx-auto text-slate-400" />
              </button>
              {presetBgs.slice(0, 5).map(bg => (
                <button 
                  key={bg.id}
                  onClick={() => setPreviewBg(bg.url)}
                  className={`w-10 h-10 rounded-xl border bg-cover bg-center transition-all ${previewBg === bg.url ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-white/10'}`}
                  style={{ backgroundImage: `url(${bg.url})` }}
                />
              ))}
              <button 
                onClick={() => bgInputRef.current?.click()}
                className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
                title="خلفية مخصصة"
              >
                <ImageIcon className="w-4 h-4 text-slate-400" />
              </button>
              <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && setPreviewBg(URL.createObjectURL(e.target.files[0]))} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">العلامة المائية:</span>
            <button 
              onClick={() => watermarkInputRef.current?.click()}
              className={`px-5 py-2.5 rounded-xl border text-[10px] font-black uppercase transition-all flex items-center gap-2 ${watermark ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/5 text-slate-400'}`}
            >
              <ShieldCheck className="w-4 h-4" />
              {watermark ? 'تم التحديد' : 'رفع شعار'}
            </button>
            {watermark && (
              <div className="flex items-center gap-4 ml-2">
                <select 
                  value={wmSettings.position}
                  onChange={(e) => setWmSettings(prev => ({ ...prev, position: e.target.value as any }))}
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white focus:outline-none"
                  disabled={wmSettings.isAnimated}
                >
                  <option value="top-left">أعلى يسار</option>
                  <option value="top-right">أعلى يمين</option>
                  <option value="bottom-left">أسفل يسار</option>
                  <option value="bottom-right">أسفل يمين</option>
                  <option value="center">منتصف</option>
                </select>
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] text-slate-500 uppercase font-black">الحجم</span>
                  <input 
                    type="range" min="5" max="100" value={wmSettings.size} 
                    onChange={(e) => setWmSettings(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                    className="w-16 accent-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[8px] text-slate-500 uppercase font-black">الشفافية</span>
                  <input 
                    type="range" min="0.1" max="1" step="0.1" value={wmSettings.opacity} 
                    onChange={(e) => setWmSettings(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))}
                    className="w-16 accent-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-2 border-r border-white/10 pr-4 ml-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={wmSettings.isAnimated}
                      onChange={(e) => setWmSettings(prev => ({ ...prev, isAnimated: e.target.checked }))}
                      className="accent-indigo-500"
                    />
                    <span className="text-[10px] text-slate-300 font-bold">متحرك</span>
                  </label>
                  {wmSettings.isAnimated && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] text-slate-500 uppercase font-black">السرعة</span>
                      <input 
                        type="range" min="1" max="10" value={wmSettings.animationSpeed} 
                        onChange={(e) => setWmSettings(prev => ({ ...prev, animationSpeed: parseInt(e.target.value) }))}
                        className="w-16 accent-indigo-500"
                      />
                    </div>
                  )}
                </div>
                <button onClick={() => setWatermark(null)} className="text-red-500 hover:text-red-400 ml-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <input type="file" ref={watermarkInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && setWatermark(URL.createObjectURL(e.target.files[0]))} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        className={`flex-1 min-h-[400px] rounded-[3rem] border-2 border-dashed transition-all duration-500 relative overflow-hidden
          ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/5 bg-white/2'}
          ${(items as any[]).length === 0 ? 'flex items-center justify-center' : ''}
        `}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        {(items as any[]).length === 0 ? (
          <div className="text-center p-12">
            <div className="w-24 h-24 bg-white/5 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-white/10">
              <Upload className="w-10 h-10 text-slate-500" />
            </div>
            <h3 className="text-xl font-black text-white mb-2">اسحب الملفات هنا للبدء</h3>
            <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">يدعم جميع المقاسات بما فيها 750×1334 الطولية</p>
          </div>
        ) : (
          <div className="p-8 overflow-y-auto max-h-[calc(100vh-320px)] custom-scrollbar flex flex-col gap-12">
            {Object.entries(
              items.reduce((acc, item) => {
                const folder = item.folderPath || 'الملفات العامة';
                if (!acc[folder]) acc[folder] = [];
                acc[folder].push(item);
                return acc;
              }, {} as Record<string, MultiSvgaItem[]>)
            ).map(([folderPath, folderItems]) => (
              <div key={folderPath} className="flex flex-col gap-4">
                {folderPath !== 'الملفات العامة' && (
                  <div className="flex items-center gap-3 border-b border-white/5 pb-2">
                    <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-white">{folderPath.split('/').pop()}</h3>
                    <span className="text-xs text-slate-400 font-bold bg-white/5 px-2 py-1 rounded-md">{(folderItems as any[]).length} ملفات</span>
                  </div>
                )}
                <div 
                  className="grid gap-8"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                >
                  <AnimatePresence mode="popLayout">
                    {(folderItems as any[]).map((item) => (
                      <SvgaCard 
                        key={`${item.id}-${item.presetId}`} 
                        item={item} 
                        onRemove={() => removeItem(item.id)} 
                        onMaximize={() => setSelectedItemId(item.id)}
                        onDownload={() => handleDownloadSingleImage(item)}
                        onDownloadSvga={() => handleDownloadSvga(item)}
                        onExportVideo={() => handleExportIndividualVideos([item])}
                        previewBg={previewBg}
                        watermark={watermark}
                        wmSettings={wmSettings}
                        onUpdatePreset={(presetId) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, presetId } : i))}
                        isSelected={selectedItemIds.has(item.id)}
                        onToggleSelect={() => handleToggleSelect(item.id)}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Modal */}
      <AnimatePresence>
        {selectedItemId && selectedItem && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 sm:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemId(null)}
              className="absolute inset-0 bg-black/95 backdrop-blur-xl"
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-5xl aspect-video sm:aspect-auto sm:h-full bg-slate-900 rounded-[3rem] border border-white/10 overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center">
                    <Maximize2 className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white">{selectedItem.name}</h3>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">عرض كامل للملف بالمقاس الأصلي</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedItemId(null)}
                  className="w-12 h-12 bg-white/5 hover:bg-white/10 text-white rounded-full flex items-center justify-center transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 relative flex items-center justify-center p-10 overflow-hidden">
                <div 
                  className="relative shadow-2xl rounded-2xl overflow-hidden flex items-center justify-center"
                  style={{ 
                    width: '100%',
                    height: '100%',
                    maxWidth: selectedItem.dimensions?.width || 500,
                    maxHeight: selectedItem.dimensions?.height || 500,
                    aspectRatio: `${selectedItem.dimensions?.width || 500} / ${selectedItem.dimensions?.height || 500}`,
                    backgroundImage: previewBg ? `url(${previewBg})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  <SvgaPlayer item={selectedItem} />
                  {watermark && <WatermarkOverlay watermark={watermark} settings={wmSettings} />}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-8 bg-white/5 border-t border-white/5 flex flex-col sm:flex-row gap-6 items-center justify-between">
                <div className="flex gap-6">
                  <InfoItem label="المقاس" value={`${selectedItem.dimensions?.width || 500} × ${selectedItem.dimensions?.height || 500}`} />
                  <InfoItem label="الإطارات" value={selectedItem.frames} />
                  <InfoItem label="السرعة" value={`${selectedItem.fps} FPS`} />
                  <InfoItem label="المدة" value={`${(selectedItem.frames / selectedItem.fps).toFixed(2)}s`} />
                </div>
                
                {/* Audio Extractor display */}
                <EmbeddedAudioPlayer item={selectedItem} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const InfoItem: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="text-center sm:text-right">
    <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">{label}</p>
    <p className="text-lg text-white font-black">{value}</p>
  </div>
);

const SvgaPlayer: React.FC<{ item: any }> = ({ item }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const selectedPreset = useMemo(() => DEVICE_PRESETS.find(p => p.id === item.presetId), [item.presetId]);

  const pagSurfaceRef = useRef<any>(null);

  useEffect(() => {
    let isCanceled = false;

    const loadAndPlay = async () => {
      if (!containerRef.current || !wrapperRef.current) return;
      
      if (item.type === "pag") {
        let pagFile = item.pagFile;
        if (!pagFile) {
          try {
            const PAG = await getPAG();
            pagFile = await PAG.PAGFile.load(await item.file.arrayBuffer());
            item.pagFile = pagFile;
            if (!item.dimensions) {
              item.dimensions = { width: pagFile.width(), height: pagFile.height() };
              item.fps = pagFile.frameRate() || 30;
              item.frames = Math.floor((pagFile.duration() / 1000000) * item.fps);
            }
            if (!isCanceled) setIsLoaded(true);
          } catch(e) {
            console.error(e);
            return;
          }
        }
        if (isCanceled || !containerRef.current) return;
        
        if (!playerRef.current) {
          containerRef.current.innerHTML = "";
          const canvas = document.createElement("canvas");
          const canvasId = "pag_player_" + Math.random().toString(36).substring(2, 9);
          canvas.id = canvasId;
          canvas.width = item.dimensions?.width || 500;
          canvas.height = item.dimensions?.height || 500;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.objectFit = "contain";
          containerRef.current.appendChild(canvas);
          
          const PAG = await getPAG();
          const pagPlayer = await PAG.PAGPlayer.create();
          pagPlayer.setComposition(pagFile);
          const pagSurface = PAG.PAGSurface.fromCanvas('#' + canvasId);
          if (pagSurface) {
            pagSurface.updateSize();
            pagSurfaceRef.current = pagSurface;
            pagPlayer.setSurface(pagSurface);
          }
          pagPlayer.setVideoEnabled(true);
          pagPlayer.setProgress(0);
          await pagPlayer.flush();
          playerRef.current = pagPlayer;
          
          const durationMs = (pagFile.duration() / 1000) || 3000;
          let accumulatedTime = 0;
          let lastTime = Date.now();
          
          const renderLoop = async () => {
            if (isCanceled) return;
            const now = Date.now();
            const delta = now - lastTime;
            lastTime = now;
            
            if (playerRef.current) {
              accumulatedTime += delta;
              const progress = (accumulatedTime % durationMs) / durationMs;
              playerRef.current.setProgress(progress);
              await playerRef.current.flush();
            }
            requestAnimationFrame(renderLoop);
          };
          renderLoop();
        }
        return;
      }

      let videoItem = item.videoItem;
      if (!videoItem) {
        try {
          videoItem = await new Promise((resolve, reject) => {
            const parser = new SVGA.Parser();
            const bypassUrl = item.url + "#" + Math.random().toString(36).substr(2, 9);
            parser.load(bypassUrl, (vi: any) => {
              if (!vi || !vi.images) return reject(new Error("Invalid SVGA"));
              resolve(vi);
            }, reject);
          });
          item.videoItem = videoItem;
          if (!isCanceled) setIsLoaded(true);
        } catch(e) {
          console.error(e);
          return;
        }
      }

      if (isCanceled || !containerRef.current) return;
      
      if (!playerRef.current) {
        containerRef.current.innerHTML = "";
        const player = new SVGA.Player(containerRef.current);
        playerRef.current = player;
        player.setContentMode("Fill");
        player.setVideoItem(videoItem);
        player.startAnimation();
      }
    };

    loadAndPlay();
    return () => { 
      isCanceled = true; 
      if (playerRef.current) {
        if (item.type === "pag") {
          try { playerRef.current.destroy?.(); } catch (e) {}
          try { pagSurfaceRef.current?.destroy?.(); } catch (e) {}
        }
        else playerRef.current.stopAnimation();
        playerRef.current = null;
        pagSurfaceRef.current = null;
      }
    };
  }, [item.url, item.type]); // Removed isLoaded
  useEffect(() => {
    const updateCanvasStyles = () => {
      if (!wrapperRef.current || !containerRef.current) return;
      
      const wrapperWidth = wrapperRef.current.clientWidth;
      const wrapperHeight = wrapperRef.current.clientHeight;
      const sw = item.dimensions?.width || item.videoItem?.videoSize?.width || 500;
      const sh = item.dimensions?.height || item.videoItem?.videoSize?.height || 500;

      // Fixed container dimensions as requested
      const containerWidth = selectedPreset ? selectedPreset.width : sw;
      const containerHeight = selectedPreset ? selectedPreset.height : sh;

      // 1. Scale the SVGA to fit inside the fixed 1334x750 container
      const svgaScale = Math.min(containerWidth / sw, containerHeight / sh);
      const finalSvgaWidth = sw * svgaScale;
      const finalSvgaHeight = sh * svgaScale;

      // 2. Scale the fixed 1334x750 container to fit inside the screen wrapper
      const wrapperScale = Math.min(wrapperWidth / containerWidth, wrapperHeight / containerHeight);

      // Size the inner container to exactly match the scaled SVGA dimensions
      // and scale it down to fit the wrapper
      Object.assign(containerRef.current.style, {
        width: `${finalSvgaWidth}px`,
        height: `${finalSvgaHeight}px`,
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) scale(${wrapperScale})`,
        transformOrigin: 'center center',
        zIndex: '1'
      });

      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) {
        Object.assign(canvas.style, {
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'fill'
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasStyles();
    });

    resizeObserver.observe(wrapperRef.current);

    const mutationObserver = new MutationObserver(() => {
      updateCanvasStyles();
    });
    
    mutationObserver.observe(containerRef.current, { childList: true, subtree: true });

    updateCanvasStyles();
    const timer = setTimeout(updateCanvasStyles, 100);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearTimeout(timer);
    };
  }, [item.videoItem, selectedPreset, isLoaded]); // Re-run when videoItem is loaded

  return (
    <div ref={wrapperRef} className="w-full h-full relative overflow-hidden flex items-center justify-center">
      <div ref={containerRef} className="relative" />
    </div>
  );
};

const SvgaCard: React.FC<{ 
  item: MultiSvgaItem; 
  onRemove: () => void; 
  onMaximize: () => void;
  onDownload: () => void;
  onDownloadSvga: () => void;
  onExportVideo?: () => void;
  previewBg: string | null;
  watermark: string | null;
  wmSettings: any;
  onUpdatePreset: (presetId: string) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}> = ({ item, onRemove, onMaximize, onDownload, onDownloadSvga, onExportVideo, previewBg, watermark, wmSettings, onUpdatePreset, isSelected, onToggleSelect }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
    
  // Derived properties
  const itemWidth = item.dimensions?.width || 500;
  const itemHeight = item.dimensions?.height || 500;
  const itemFrames = item.frames || 1;
  const itemFps = item.fps || 30;
  const isPortrait = itemHeight > itemWidth;
  const selectedPreset = useMemo(() => DEVICE_PRESETS.find(p => p.id === item.presetId), [item.presetId]);

    const [isVisible, setIsVisible] = useState(false);

  const isPlayingRef = useRef(isPlaying);
  const pagSurfaceRef = useRef<any>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        setIsVisible(entry.isIntersecting);
      });
    }, { threshold: 0, rootMargin: '300px' });
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let isCanceled = false;

    const loadAndPlay = async () => {
      if (!isVisible) {
        if (playerRef.current) {
          if (item.type === "pag") {
            try { playerRef.current.destroy?.(); } catch (e) {}
            try { pagSurfaceRef.current?.destroy?.(); } catch (e) {}
          }
          else playerRef.current.stopAnimation();
          playerRef.current = null;
          pagSurfaceRef.current = null;
        }
        if (containerRef.current) containerRef.current.innerHTML = "";
        return;
      }

      if (item.type === "pag") {
        let pagFile = item.pagFile;
        if (!pagFile) {
          try {
            const PAG = await getPAG();
            pagFile = await PAG.PAGFile.load(await item.file.arrayBuffer());
            item.pagFile = pagFile;
            if (!item.dimensions) {
              item.dimensions = { width: pagFile.width(), height: pagFile.height() };
              item.fps = pagFile.frameRate() || 30;
              item.frames = Math.floor((pagFile.duration() / 1000000) * item.fps);
            }
            if (!isCanceled) setIsLoaded(true);
          } catch (e) {
            console.error("PAG load error", e);
            return;
          }
        }
        
        if (isCanceled || !containerRef.current) return;
        
        if (!playerRef.current) {
          containerRef.current.innerHTML = "";
          const canvas = document.createElement("canvas");
          const canvasId = "pag_card_" + Math.random().toString(36).substring(2, 9);
          canvas.id = canvasId;
          canvas.width = item.dimensions?.width || 500;
          canvas.height = item.dimensions?.height || 500;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.objectFit = "contain";
          containerRef.current.appendChild(canvas);
          
          const PAG = await getPAG();
          const pagPlayer = await PAG.PAGPlayer.create();
          pagPlayer.setComposition(pagFile);
          const pagSurface = PAG.PAGSurface.fromCanvas('#' + canvasId);
          if (pagSurface) {
            pagSurface.updateSize();
            pagSurfaceRef.current = pagSurface;
            pagPlayer.setSurface(pagSurface);
          }
          pagPlayer.setVideoEnabled(true);
          pagPlayer.setProgress(0);
          await pagPlayer.flush();
          playerRef.current = pagPlayer;
          
          const durationMs = (pagFile.duration() / 1000) || 3000;
          let accumulatedTime = 0;
          let lastTime = Date.now();
          
          const renderLoop = async () => {
            if (isCanceled) return;
            const now = Date.now();
            const delta = now - lastTime;
            lastTime = now;
            
            if (isPlayingRef.current && playerRef.current) {
              accumulatedTime += delta;
              const progress = (accumulatedTime % durationMs) / durationMs;
              playerRef.current.setProgress(progress);
              await playerRef.current.flush();
            }
            requestAnimationFrame(renderLoop);
          };
          renderLoop();
        }
        return;
      }

      let videoItem = item.videoItem;
      if (videoItem && (videoItem.audios?.length > 0 || extractAudioData(item) !== null)) {
        setHasAudio(true);
      }
      if (!videoItem || !videoItem.images) {
        try {
          videoItem = await new Promise((resolve, reject) => {
            const parser = new SVGA.Parser();
            const bypassUrl = item.url + "#" + Math.random().toString(36).substr(2, 9);
            parser.load(bypassUrl, (vi: any) => {
              if (!vi || !vi.images) return reject(new Error("Invalid SVGA"));
              resolve(vi);
            }, reject);
          });
          item.videoItem = videoItem;
          if (!item.dimensions) {
            item.dimensions = { width: videoItem.videoSize?.width || 500, height: videoItem.videoSize?.height || 500 };
            item.fps = videoItem.FPS || videoItem.fps || 30;
            item.frames = videoItem.frames || 1;
          }
          if (videoItem && (videoItem.audios?.length > 0 || extractAudioData({ ...item, videoItem }) !== null)) {
            setHasAudio(true);
          }
          if (!isCanceled) setIsLoaded(true);
        } catch(e) {
          console.error("SVGA load error", e);
          return;
        }
      }

      if (isCanceled || !containerRef.current) return;
      
      if (!playerRef.current) {
        containerRef.current.innerHTML = "";
        const player = new SVGA.Player(containerRef.current);
        playerRef.current = player;
        player.loops = 0;
        player.clearsAfterStop = false;
        player.setContentMode("AspectFit");
        player.setVideoItem(videoItem);
      }
      
      if (isPlayingRef.current) playerRef.current.startAnimation();
      else playerRef.current.pauseAnimation();
    };

    loadAndPlay();
    return () => {
      isCanceled = true;
      if (playerRef.current) {
        if (item.type === "pag") {
          try { playerRef.current.destroy?.(); } catch (e) {}
          try { pagSurfaceRef.current?.destroy?.(); } catch (e) {}
        }
        else playerRef.current.stopAnimation();
      }
      playerRef.current = null;
      pagSurfaceRef.current = null;
    };
  }, [item.url, item.type, isVisible]); // Removed isLoaded and isPlaying from dependencies


    // Separate effect for Zoom and Preset style updates - much faster and smoother
    useEffect(() => {
    const updateCanvasStyles = () => {
        if (!wrapperRef.current || !containerRef.current) return;
        
        const wrapperWidth = wrapperRef.current.clientWidth;
        const wrapperHeight = wrapperRef.current.clientHeight;
        const svgaWidth = item.dimensions?.width || 500;
        const svgaHeight = item.dimensions?.height || 500;
  
        // Fixed container dimensions as requested
        const containerWidth = selectedPreset ? selectedPreset.width : svgaWidth;
        const containerHeight = selectedPreset ? selectedPreset.height : svgaHeight;
  
        // 1. Scale the SVGA to fit inside the fixed 1334x750 container
        const svgaScale = Math.min(containerWidth / svgaWidth, containerHeight / svgaHeight);
        const finalSvgaWidth = svgaWidth * svgaScale;
        const finalSvgaHeight = svgaHeight * svgaScale;
  
        // 2. Scale the fixed 1334x750 container to fit inside the card wrapper
        const wrapperScale = Math.min(wrapperWidth / containerWidth, wrapperHeight / containerHeight);
  
        // Size the inner container to exactly match the scaled SVGA dimensions
        // and scale it down to fit the wrapper
        Object.assign(containerRef.current.style, {
          width: `${finalSvgaWidth}px`,
          height: `${finalSvgaHeight}px`,
          position: 'absolute',
          top: '50%',
          left: '50%',
          // Combine the wrapper scale and the user zoom
          transform: `translate(-50%, -50%) scale(${wrapperScale * zoom})`,
          transformOrigin: 'center center',
          zIndex: '1'
        });
  
        const canvas = containerRef.current.querySelector('canvas');
        if (canvas) {
          Object.assign(canvas.style, {
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'fill'
          });
        }
      };
  
      const resizeObserver = new ResizeObserver(() => {
        updateCanvasStyles();
      });
  
      if (wrapperRef.current) {
        resizeObserver.observe(wrapperRef.current);
      }
  
      // Use MutationObserver to catch when SVGA.Player adds the canvas
      const mutationObserver = new MutationObserver(() => {
        updateCanvasStyles();
      });
      
      if (containerRef.current) {
        mutationObserver.observe(containerRef.current, { childList: true, subtree: true });
      }
  
      updateCanvasStyles();
      const timer = setTimeout(updateCanvasStyles, 100);
      
      return () => {
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        clearTimeout(timer);
      };
    }, [selectedPreset, zoom, item.dimensions]);

  const togglePlay = () => {
    if (item.type === 'pag') {
      setIsPlaying(!isPlaying);
    } else {
      if (isPlaying) {
        playerRef.current?.pauseAnimation();
      } else {
        playerRef.current?.startAnimation();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const replay = () => {
    if (item.type === 'pag') {
      if (playerRef.current) {
        playerRef.current.setProgress(0);
        playerRef.current.flush();
      }
      setIsPlaying(true);
    } else {
      playerRef.current?.stopAnimation();
      playerRef.current?.startAnimation();
      setIsPlaying(true);
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      className={`group relative bg-white/5 rounded-[3rem] border border-white/10 overflow-hidden hover:border-indigo-500/50 transition-all duration-500 hover:shadow-2xl hover:shadow-indigo-500/10 flex flex-col shrink-0 ${selectedPreset ? 'w-[350px]' : 'w-[400px]'}`}
    >
      {/* Preview Area - Forced Ratio */}
      <div 
        ref={wrapperRef}
        className={`relative bg-slate-950/50 flex items-center justify-center overflow-hidden w-full`}
        style={{
          height: selectedPreset ? `${(selectedPreset.height / selectedPreset.width) * 350}px` : `${(itemHeight / itemWidth) * 350}px`,
          backgroundImage: previewBg ? `url(${previewBg})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        <div 
          ref={containerRef} 
          className="relative"
        />

        {/* Watermark */}
        {watermark && <WatermarkOverlay watermark={watermark} settings={wmSettings} />}
        
        {/* Selection Checkbox */}
        {onToggleSelect && (
          <div className={`absolute top-4 left-4 z-30 transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <button
              onClick={onToggleSelect}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                isSelected ? "bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "bg-black/40 backdrop-blur-md border-white/50 hover:border-white hover:bg-black/60 text-transparent"
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
          </div>
        )}
        
        {/* Audio Badge */}
        {hasAudio && (
          <div className={`absolute ${onToggleSelect ? 'top-14' : 'top-4'} left-4 z-20 px-3 py-1.5 bg-indigo-500/80 backdrop-blur-md border border-indigo-400/50 rounded-xl flex items-center gap-2 shadow-lg`}>
            <Volume2 className="w-4 h-4 text-white" />
            <span className="text-[10px] font-black text-white uppercase tracking-wider">يحتوي صوت</span>
          </div>
        )}

        {/* Info Badge */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-20">
          <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl flex items-center gap-2">
            <span className="text-[10px] font-black text-white">
              {selectedPreset ? `${selectedPreset.width} × ${selectedPreset.height}` : `${itemWidth} × ${itemHeight}`}
            </span>
            {isPortrait ? <Smartphone className="w-3 h-3 text-sky-400" /> : <Monitor className="w-3 h-3 text-indigo-400" />}
          </div>
          {selectedPreset && (
            <div className="px-2 py-0.5 bg-indigo-500/20 border border-indigo-500/30 rounded-lg text-[8px] font-black text-indigo-300 uppercase tracking-tighter text-center">
              مقاس إجباري (Fill)
            </div>
          )}
        </div>
        
        {/* Overlay Controls */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-6 z-20">
          <div className="flex items-center gap-4">
            <button 
              onClick={togglePlay}
              className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
            </button>
            <button 
              onClick={replay}
              className="w-12 h-12 bg-white/20 backdrop-blur-md text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform"
            >
              <RotateCcw className="w-6 h-6" />
            </button>
          </div>

          {/* Zoom Slider */}
          <div className="w-48 px-4 py-3 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-white uppercase tracking-widest">تكبير العرض (Zoom)</span>
              <span className="text-[10px] font-black text-indigo-400">{Math.round(zoom * 100)}%</span>
            </div>
            <input 
              type="range" 
              min="0.5" 
              max="3" 
              step="0.1" 
              value={zoom} 
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
          <button 
            onClick={onRemove}
            className="w-10 h-10 bg-red-500/20 backdrop-blur-md text-red-500 rounded-xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <button 
            onClick={onMaximize}
            className="w-10 h-10 bg-indigo-500/20 backdrop-blur-md text-indigo-400 rounded-xl flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          <button 
            onClick={onDownload}
            className="w-10 h-10 bg-emerald-500/20 backdrop-blur-md text-emerald-400 rounded-xl flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all"
            title="تنزيل صورة"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button 
            onClick={onDownloadSvga}
            className="w-10 h-10 bg-blue-500/20 backdrop-blur-md text-blue-400 rounded-xl flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"
            title="تنزيل ملف SVGA"
          >
            <Download className="w-5 h-5" />
          </button>
          {onExportVideo && (
            <button 
              onClick={onExportVideo}
              className="w-10 h-10 bg-purple-500/20 backdrop-blur-md text-purple-400 rounded-xl flex items-center justify-center hover:bg-purple-500 hover:text-white transition-all"
              title="تصدير كفيديو MP4"
            >
              <Video className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={() => setShowInfo(!showInfo)}
            className={`w-10 h-10 backdrop-blur-md rounded-xl flex items-center justify-center transition-all ${showInfo ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Info Footer */}
      <div className="p-5 bg-white/[0.02] z-10">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-white font-black text-sm truncate max-w-[150px]" title={item.name}>
            {item.name}
          </h4>
          <span className="text-[10px] text-slate-500 font-bold">
            {(item.size / 1024).toFixed(1)} KB
          </span>
        </div>
        
        {/* Preset Selector */}
        <select 
          value={item.presetId}
          onChange={(e) => onUpdatePreset(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[10px] text-white font-black uppercase tracking-widest focus:outline-none focus:border-indigo-500 transition-all mb-4"
        >
          <option value="auto">تلقائي (Native)</option>
          {DEVICE_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        
        <AnimatePresence>
          {showInfo && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-4 mt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">Frames</p>
                  <p className="text-xs text-white font-bold">{item.frames}</p>
                </div>
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">FPS</p>
                  <p className="text-xs text-white font-bold">{item.fps}</p>
                </div>
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">Duration</p>
                  <p className="text-xs text-white font-bold">{(item.frames / item.fps).toFixed(2)}s</p>
                </div>
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">Ratio</p>
                  <p className="text-xs text-white font-bold">{(itemWidth / itemHeight).toFixed(2)}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default MultiSvgaViewer;
