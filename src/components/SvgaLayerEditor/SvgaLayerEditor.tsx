import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  EditableLayer, SVGAProjectData, CanvasTool, LayerKeyframe 
} from './types';
import { parseSvgaToProject } from './svgaParserEngine';
import { exportEditedSvga } from './svgaExportEngine';
import { fileToImageBuffer, createImageLayer, createShapeLayer } from './layerFactory';
import { SvgaDesignCanvas } from './SvgaDesignCanvas';
import { SvgaLayersList } from './SvgaLayersList';
import { SvgaPropertiesPanel } from './SvgaPropertiesPanel';
import { SvgaMotionTimeline } from './SvgaMotionTimeline';
import { 
  Upload, Layers, Download, ArrowLeft, RotateCcw, 
  Sparkles, MousePointer, Hand, ZoomIn, Grid, Compass, 
  FileCode, Check, AlertCircle, RefreshCw, X, Shield, Eye,
  Sliders, Play, Film, CheckCircle2, Music
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SvgaLayerEditorProps {
  initialFile?: File;
  onClose: () => void;
  onOpenViewer?: (file: File) => void;
}

export const SvgaLayerEditor: React.FC<SvgaLayerEditorProps> = ({
  initialFile,
  onClose,
  onOpenViewer
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Project Data & Layers
  const [project, setProject] = useState<SVGAProjectData | null>(null);
  const [layers, setLayers] = useState<EditableLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Undo / Redo History Stack
  const [history, setHistory] = useState<EditableLayer[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Canvas Viewport State
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [zoom, setZoom] = useState<number>(100);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showRulers, setShowRulers] = useState<boolean>(true);
  const [showGuides, setShowGuides] = useState<boolean>(true);
  const [bgColor, setBgColor] = useState<string>('transparent');

  // Animation & Timeline State
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoop, setIsLoop] = useState<boolean>(true);

  // Status & Export State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportFileName, setExportFileName] = useState<string>('');
  const [lastExportedBlob, setLastExportedBlob] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Push State to History
  const pushHistory = useCallback((newLayers: EditableLayer[]) => {
    setHistory(prev => {
      const upToCurrent = prev.slice(0, historyIndex + 1);
      return [...upToCurrent, JSON.parse(JSON.stringify(newLayers))];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Load File
  const loadSvgaFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const { project: parsedProject, layers: parsedLayers } = await parseSvgaToProject(file);
      setProject(parsedProject);
      setLayers(parsedLayers);
      setSelectedLayerId(parsedLayers[0]?.id || null);
      setCurrentFrame(0);
      setIsPlaying(false);
      setExportFileName(file.name.replace(/\.svga$/i, '') + '_edited.svga');
      
      // Auto-fit zoom based on screen size
      const maxW = window.innerWidth - 700;
      const maxH = window.innerHeight - 200;
      const scaleW = maxW / (parsedProject.width || 1);
      const scaleH = maxH / (parsedProject.height || 1);
      const fitZoom = Math.min(100, Math.max(25, Math.floor(Math.min(scaleW, scaleH) * 100)));
      setZoom(fitZoom);
      setPanOffset({ x: 0, y: 0 });

      // Init history
      setHistory([JSON.parse(JSON.stringify(parsedLayers))]);
      setHistoryIndex(0);

      setSuccessToast(`تم فتح الملف بنجاح (${parsedLayers.length} طبقة)`);
    } catch (err: any) {
      console.error("Failed to parse SVGA file:", err);
      setErrorMessage(err.message || 'حدث خطأ أثناء قراءة ملف SVGA.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle Initial File
  useEffect(() => {
    if (initialFile) {
      loadSvgaFile(initialFile);
    }
  }, [initialFile, loadSvgaFile]);

  // Animation Frame Playback Loop
  useEffect(() => {
    if (!isPlaying || !project || project.totalFrames <= 1) return;

    const interval = setInterval(() => {
      setCurrentFrame(prev => {
        if (prev >= project.totalFrames - 1) {
          if (isLoop) return 0;
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000 / (project.fps || 30));

    return () => clearInterval(interval);
  }, [isPlaying, project, isLoop]);

  // Auto-dismiss toast
  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => setSuccessToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [successToast]);

  // Layer Update Handlers
  const handleUpdateLayerTransform = useCallback((layerId: string, deltaTransform: Partial<EditableLayer['transform']>) => {
    setLayers(prev => prev.map(l => {
      if (l.id === layerId) {
        return {
          ...l,
          transform: {
            ...l.transform,
            ...deltaTransform
          }
        };
      }
      return l;
    }));
  }, []);

  // Keyframes Update Handler
  const handleUpdateLayerKeyframes = useCallback((layerId: string, keyframes: LayerKeyframe[]) => {
    setLayers(prev => prev.map(l => {
      if (l.id === layerId) {
        return {
          ...l,
          keyframes
        };
      }
      return l;
    }));
  }, []);

  const handleToggleVisibility = useCallback((layerId: string) => {
    setLayers(prev => {
      const updated = prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l);
      pushHistory(updated);
      return updated;
    });
  }, [pushHistory]);

  const handleToggleAllVisibility = useCallback((makeVisible?: boolean) => {
    setLayers(prev => {
      const targetState = makeVisible !== undefined 
        ? makeVisible 
        : !prev.every(l => l.visible);
      const updated = prev.map(l => ({ ...l, visible: targetState }));
      pushHistory(updated);
      setSuccessToast(targetState ? 'تم إظهار جميع الطبقات' : 'تم إخفاء جميع الطبقات');
      return updated;
    });
  }, [pushHistory]);

  const handleToggleLock = useCallback((layerId: string) => {
    setLayers(prev => {
      const updated = prev.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l);
      pushHistory(updated);
      return updated;
    });
  }, [pushHistory]);

  const handleToggleAllLock = useCallback((makeLocked?: boolean) => {
    setLayers(prev => {
      const targetState = makeLocked !== undefined 
        ? makeLocked 
        : !prev.every(l => l.locked);
      const updated = prev.map(l => ({ ...l, locked: targetState }));
      pushHistory(updated);
      setSuccessToast(targetState ? 'تم قفل جميع الطبقات' : 'تم فتح قفل جميع الطبقات');
      return updated;
    });
  }, [pushHistory]);

  const handleToggleAspectLock = useCallback(() => {
    if (!selectedLayerId) return;
    setLayers(prev => {
      const updated = prev.map(l => l.id === selectedLayerId ? { ...l, aspectRatioLocked: !l.aspectRatioLocked } : l);
      pushHistory(updated);
      return updated;
    });
  }, [selectedLayerId, pushHistory]);

  const handleReorderLayer = useCallback((layerId: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId);
      if (idx === -1) return prev;

      const newLayers = [...prev];
      const [moved] = newLayers.splice(idx, 1);

      if (direction === 'up' && idx > 0) {
        newLayers.splice(idx - 1, 0, moved);
      } else if (direction === 'down' && idx < prev.length - 1) {
        newLayers.splice(idx + 1, 0, moved);
      } else if (direction === 'top') {
        newLayers.unshift(moved);
      } else if (direction === 'bottom') {
        newLayers.push(moved);
      } else {
        newLayers.splice(idx, 0, moved);
      }

      pushHistory(newLayers);
      return newLayers;
    });
  }, [pushHistory]);

  // Direct move / Drag and drop layer above or below any target layer
  const handleMoveLayer = useCallback((sourceId: string, targetId: string, position: 'above' | 'below') => {
    setLayers(prev => {
      const sourceIndex = prev.findIndex(l => l.id === sourceId);
      if (sourceIndex === -1) return prev;
      const targetIndex = prev.findIndex(l => l.id === targetId);
      if (targetIndex === -1 || sourceIndex === targetIndex) return prev;

      const newLayers = [...prev];
      const [moved] = newLayers.splice(sourceIndex, 1);

      // Find new target index after removing source
      const newTargetIndex = newLayers.findIndex(l => l.id === targetId);
      if (newTargetIndex === -1) return prev;

      const insertIndex = position === 'above' ? newTargetIndex : newTargetIndex + 1;
      newLayers.splice(insertIndex, 0, moved);

      pushHistory(newLayers);
      setSuccessToast(`تم نقل الطبقة "${moved.name}" ${position === 'above' ? 'فوق' : 'تحت'} "${newLayers[newTargetIndex]?.name}"`);
      return newLayers;
    });
  }, [pushHistory]);

  const handleDuplicateLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const target = prev.find(l => l.id === layerId);
      if (!target) return prev;

      const newId = `layer_${Date.now()}_copy`;
      const cloned: EditableLayer = {
        ...JSON.parse(JSON.stringify(target)),
        id: newId,
        name: `${target.name} (نسخة)`,
        transform: {
          ...target.transform,
          x: target.transform.x + 20,
          y: target.transform.y + 20
        }
      };

      const updated = [cloned, ...prev];
      setSelectedLayerId(newId);
      pushHistory(updated);
      setSuccessToast(`تم تكرار الطبقة: ${target.name}`);
      return updated;
    });
  }, [pushHistory]);

  const handleDeleteLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const updated = prev.filter(l => l.id !== layerId);
      if (selectedLayerId === layerId) {
        setSelectedLayerId(updated[0]?.id || null);
      }
      pushHistory(updated);
      setSuccessToast('تم حذف الطبقة بنجاح');
      return updated;
    });
  }, [selectedLayerId, pushHistory]);

  const handleRenameLayer = useCallback((layerId: string, newName: string) => {
    setLayers(prev => {
      const updated = prev.map(l => l.id === layerId ? { ...l, name: newName } : l);
      pushHistory(updated);
      return updated;
    });
  }, [pushHistory]);

  const handleResetTransform = useCallback(() => {
    if (!selectedLayerId) return;
    setLayers(prev => {
      const updated = prev.map(l => {
        if (l.id === selectedLayerId) {
          return {
            ...l,
            transform: {
              ...l.transform,
              x: l.initialBounds.x,
              y: l.initialBounds.y,
              width: l.initialBounds.width,
              height: l.initialBounds.height,
              scaleX: 1,
              scaleY: 1,
              rotation: 0,
              opacity: 100
            }
          };
        }
        return l;
      });
      pushHistory(updated);
      setSuccessToast('تمت استعادة الإحداثيات الأصلية للطبقة');
      return updated;
    });
  }, [selectedLayerId, pushHistory]);

  const handleReplaceAsset = useCallback((file: File) => {
    if (!selectedLayerId || !project) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const layer = layers.find(l => l.id === selectedLayerId);
      if (!layer) return;

      // Update in project imagesMap
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          imagesMap: {
            ...prev.imagesMap,
            [layer.imageKey]: dataUrl
          }
        };
      });

      // Update layer thumbnail
      setLayers(prev => {
        const updated = prev.map(l => l.id === selectedLayerId ? { ...l, thumbnailUrl: dataUrl } : l);
        pushHistory(updated);
        return updated;
      });

      setSuccessToast(`تم استبدال أصل الصورة للطبقة: ${layer.name}`);
    };
    reader.readAsDataURL(file);
  }, [selectedLayerId, project, layers, pushHistory]);

  // Add New Image Layer
  const handleAddImageLayer = useCallback(async (file: File) => {
    if (!project) return;
    try {
      const { dataUrl, bytes, width, height } = await fileToImageBuffer(file);
      const imageKey = `img_custom_${Date.now()}`;
      const layerName = file.name.replace(/\.[^/.]+$/, '') || 'صورة مخصصة';

      // Update project images
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          images: {
            ...prev.images,
            [imageKey]: bytes
          },
          imagesMap: {
            ...prev.imagesMap,
            [imageKey]: dataUrl
          }
        };
      });

      // Create new layer
      const newLayer = createImageLayer(
        imageKey,
        layerName,
        dataUrl,
        width,
        height,
        project.width,
        project.height,
        project.totalFrames
      );

      setLayers(prev => {
        const updated = [newLayer, ...prev];
        pushHistory(updated);
        return updated;
      });

      setSelectedLayerId(newLayer.id);
      setSuccessToast(`تمت إضافة طبقة جديدة بنجاح: ${layerName}`);
    } catch (err: any) {
      console.error("Failed to add image layer:", err);
      alert(`فشل إضافة الصورة: ${err.message || 'خطأ غير متوقع'}`);
    }
  }, [project, pushHistory]);

  // Add New Shape / Text Layer
  const handleAddShapeLayer = useCallback(async (shapeType: 'rect' | 'circle' | 'star' | 'badge' | 'text', customText?: string) => {
    if (!project) return;
    try {
      const { layer, dataUrl, bytes } = await createShapeLayer(
        shapeType,
        project.width,
        project.height,
        project.totalFrames,
        customText
      );

      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          images: {
            ...prev.images,
            [layer.imageKey]: bytes
          },
          imagesMap: {
            ...prev.imagesMap,
            [layer.imageKey]: dataUrl
          }
        };
      });

      setLayers(prev => {
        const updated = [layer, ...prev];
        pushHistory(updated);
        return updated;
      });

      setSelectedLayerId(layer.id);
      setSuccessToast(`تمت إضافة طبقة جديدة: ${layer.name}`);
    } catch (err: any) {
      console.error("Failed to add shape layer:", err);
      alert(`فشل إضافة الشكل: ${err.message || 'خطأ غير متوقع'}`);
    }
  }, [project, pushHistory]);

  // Update Layer Active Frame Range
  const handleUpdateFrameRange = useCallback((startFrame: number, endFrame: number) => {
    if (!selectedLayerId || !project) return;
    setLayers(prev => {
      const updated = prev.map(l => {
        if (l.id !== selectedLayerId) return l;

        const updatedFrames = l.spriteRef?.frames ? l.spriteRef.frames.map((fr: any, idx: number) => {
          const isVisible = idx >= startFrame && idx <= endFrame;
          return {
            ...fr,
            alpha: isVisible ? (fr.alpha && fr.alpha > 0 ? fr.alpha : 1.0) : 0.0
          };
        }) : [];

        return {
          ...l,
          keyframeSummary: {
            ...l.keyframeSummary,
            startFrame,
            endFrame
          },
          spriteRef: {
            ...l.spriteRef,
            frames: updatedFrames
          }
        };
      });
      pushHistory(updated);
      return updated;
    });
  }, [selectedLayerId, project, pushHistory]);

  // Undo / Redo Actions
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setLayers(JSON.parse(JSON.stringify(history[newIdx])));
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setLayers(JSON.parse(JSON.stringify(history[newIdx])));
    }
  }, [history, historyIndex]);

  // Perform SVGA Export and Download
  const handleExport = async () => {
    if (!project) return;
    setIsExporting(true);
    try {
      const { blob, fileName } = await exportEditedSvga(project, layers, exportFileName);
      setLastExportedBlob({ blob, fileName });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      
      setSuccessToast(`تم تصدير وحفظ ملف SVGA بنجاح: ${fileName}`);
      setShowExportModal(false);
    } catch (err: any) {
      console.error("Export error:", err);
      alert(`فشل تصدير الملف: ${err.message || 'خطأ غير متوقع'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Preview Exported File in SVGA Viewer
  const handlePreviewExported = async () => {
    if (!project) return;
    setIsExporting(true);
    try {
      const { blob, fileName } = await exportEditedSvga(project, layers, exportFileName);
      const exportedFile = new File([blob], fileName, { type: 'application/octet-stream' });
      if (onOpenViewer) {
        onOpenViewer(exportedFile);
      }
    } catch (err: any) {
      console.error("Preview error:", err);
      alert(`فشل إعداد المعاينة: ${err.message || 'خطأ'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;

  // Background Swatches
  const bgSwatches = [
    { label: 'Transparent', value: 'transparent', isChecker: true },
    { label: 'Dark Slate', value: '#070b14' },
    { label: 'Pitch Black', value: '#000000' },
    { label: 'Pure White', value: '#ffffff' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#070b14] text-white flex flex-col font-sans overflow-hidden select-none" dir="ltr">
      <input
        type="file"
        ref={fileInputRef}
        accept=".svga"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadSvgaFile(f);
        }}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {successToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 border border-indigo-400/50 text-white text-xs font-bold px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2"
          >
            <Check size={14} className="text-white" />
            <span>{successToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Navbar */}
      <header className="h-14 bg-[#0a0f1d] border-b border-white/10 px-6 flex items-center justify-between shrink-0 z-30">
        {/* Left: Brand & Back */}
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 transition-all cursor-pointer"
          >
            <ArrowLeft size={14} /> خروج
          </button>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-glow-indigo">
              <Layers size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-sm tracking-tight text-white">تحرير طبقات SVGA</span>
                <span className="text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  Pro Layer Studio
                </span>
              </div>
              {project && (
                <p className="text-[10px] text-slate-400 font-mono">
                  {project.fileName} • {(project.fileSize / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Center: Canvas View Controls & Tools */}
        {project && (
          <div className="hidden lg:flex items-center gap-3 bg-white/5 p-1 rounded-2xl border border-white/5">
            {/* Tool Modes */}
            <div className="flex items-center gap-1 pr-2 border-r border-white/10">
              <button
                onClick={() => setActiveTool('select')}
                className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === 'select' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                title="أداة التحديد والتحريك (Select Tool)"
              >
                <MousePointer size={14} />
              </button>
              <button
                onClick={() => setActiveTool('hand')}
                className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === 'hand' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                title="أداة تحريك مساحة العمل (Hand Tool)"
              >
                <Hand size={14} />
              </button>
            </div>

            {/* Grid & Guides Toggles */}
            <div className="flex items-center gap-1 pr-2 border-r border-white/10">
              <button
                onClick={() => setShowGrid(!showGrid)}
                className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                  showGrid ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'
                }`}
                title="إظهار/إخفاء الشبكة (Grid)"
              >
                <Grid size={14} />
              </button>
              <button
                onClick={() => setShowGuides(!showGuides)}
                className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                  showGuides ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'
                }`}
                title="إظهار/إخفاء خطوط المحاذاة الذكية (Smart Guides)"
              >
                <Compass size={14} />
              </button>
            </div>

            {/* Background Color Swatches */}
            <div className="flex items-center gap-1.5 pl-1">
              {bgSwatches.map(swatch => (
                <button
                  key={swatch.label}
                  onClick={() => setBgColor(swatch.value)}
                  className={`w-4 h-4 rounded-full border transition-all cursor-pointer ${
                    bgColor === swatch.value ? 'scale-125 border-white ring-2 ring-indigo-500/50' : 'border-white/20 hover:scale-110'
                  }`}
                  style={{
                    backgroundColor: swatch.isChecker ? '#1e293b' : swatch.value,
                    backgroundImage: swatch.isChecker ? 'radial-gradient(circle, #475569 20%, transparent 20%)' : 'none',
                    backgroundSize: '4px 4px'
                  }}
                  title={swatch.label}
                />
              ))}
            </div>
          </div>
        )}

        {/* Right Actions: Undo, Redo, Open, Export */}
        <div className="flex items-center gap-2">
          {project && (
            <>
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 rounded-xl transition-all cursor-pointer"
                title="تراجع (Undo - Ctrl+Z)"
              >
                <RotateCcw size={14} />
              </button>

              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 rounded-xl transition-all cursor-pointer"
                title="إعادة (Redo - Ctrl+Y)"
              >
                <RotateCcw size={14} className="scale-x-[-1]" />
              </button>
            </>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 px-3.5 py-1.5 rounded-xl border border-white/10 transition-all cursor-pointer"
          >
            <Upload size={13} className="text-indigo-400" /> فتح SVGA
          </button>

          {project && (
            <button
              onClick={() => setShowExportModal(true)}
              disabled={isExporting}
              className="flex items-center gap-1.5 text-xs font-black text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 px-4 py-1.5 rounded-xl shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-105"
            >
              <Download size={13} /> {isExporting ? 'جاري المعالجة...' : 'تصدير SVGA'}
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Body */}
      {project ? (
        <div className="flex flex-1 overflow-hidden relative">
          {/* Left Panel: Layers */}
          <aside className="w-[360px] 2xl:w-[400px] h-full shrink-0 border-r border-white/10 z-10 flex flex-col">
            <SvgaLayersList
              layers={layers}
              selectedLayerId={selectedLayerId}
              currentFrame={currentFrame}
              onSelectLayer={setSelectedLayerId}
              onToggleVisibility={handleToggleVisibility}
              onToggleAllVisibility={handleToggleAllVisibility}
              onToggleLock={handleToggleLock}
              onToggleAllLock={handleToggleAllLock}
              onReorderLayer={handleReorderLayer}
              onMoveLayer={handleMoveLayer}
              onDuplicateLayer={handleDuplicateLayer}
              onDeleteLayer={handleDeleteLayer}
              onRenameLayer={handleRenameLayer}
              onAddImageLayer={handleAddImageLayer}
              onAddShapeLayer={handleAddShapeLayer}
            />
          </aside>

          {/* Center Viewport: Interactive Canvas + Timeline */}
          <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#070b14]">
            <div className="flex-1 relative overflow-hidden">
              <SvgaDesignCanvas
                project={project}
                layers={layers}
                selectedLayerId={selectedLayerId}
                currentFrame={currentFrame}
                activeTool={activeTool}
                zoom={zoom}
                panOffset={panOffset}
                showGrid={showGrid}
                showRulers={showRulers}
                showGuides={showGuides}
                bgColor={bgColor}
                onSelectLayer={setSelectedLayerId}
                onUpdateLayerTransform={handleUpdateLayerTransform}
                onZoomChange={setZoom}
                onPanChange={setPanOffset}
                onDeleteLayer={handleDeleteLayer}
              />
            </div>

            {/* Bottom Keyframe & Motion Timeline */}
            <SvgaMotionTimeline
              totalFrames={project.totalFrames}
              currentFrame={currentFrame}
              fps={project.fps}
              isPlaying={isPlaying}
              isLoop={isLoop}
              selectedLayer={selectedLayer}
              layers={layers}
              onSelectLayer={setSelectedLayerId}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onStepFrame={(delta) => {
                setIsPlaying(false);
                setCurrentFrame(prev => Math.max(0, Math.min(project.totalFrames - 1, prev + delta)));
              }}
              onSeekFrame={(f) => {
                setIsPlaying(false);
                setCurrentFrame(Math.max(0, Math.min(project.totalFrames - 1, f)));
              }}
              onToggleLoop={() => setIsLoop(!isLoop)}
              onUpdateLayerTransform={handleUpdateLayerTransform}
              onUpdateLayerKeyframes={handleUpdateLayerKeyframes}
            />
          </main>

          {/* Right Panel: Properties */}
          <aside className="w-[320px] h-full shrink-0">
            <SvgaPropertiesPanel
              project={project}
              layer={selectedLayer}
              currentFrame={currentFrame}
              onUpdateTransform={(t) => selectedLayerId && handleUpdateLayerTransform(selectedLayerId, t)}
              onToggleAspectLock={handleToggleAspectLock}
              onReplaceAsset={handleReplaceAsset}
              onResetTransform={handleResetTransform}
              onUpdateFrameRange={handleUpdateFrameRange}
            />
          </aside>
        </div>
      ) : (
        /* Empty State / Initial Drop Zone */
        <div 
          className="flex-1 flex flex-col items-center justify-center p-8 bg-[#070b14]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadSvgaFile(f);
          }}
        >
          <div className="max-w-md w-full bg-slate-900/60 border border-white/10 rounded-3xl p-8 text-center space-y-6 shadow-2xl backdrop-blur-xl">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500/20 to-purple-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto shadow-glow-indigo">
              <Layers size={36} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">محرر طبقات SVGA الاحترافي</h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                افتح أي ملف SVGA لتعديل الطبقات، التحكم بالموضع والحجم والتدوير بالماوس مباشرة على الكانفاس مع الحفاظ التام على الحركة الأصلية والأصوات.
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2 text-right" dir="rtl">
                <AlertCircle size={16} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-2xl p-6 transition-all cursor-pointer space-y-2 group"
            >
              <Upload size={24} className="text-indigo-400 mx-auto group-hover:scale-110 transition-transform" />
              <div className="text-xs font-bold text-white">اسحب وأفلت ملف SVGA هنا</div>
              <div className="text-[10px] text-slate-500">أو انقر لاختيار ملف من جهازك</div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-[1.02]"
            >
              اختر ملف SVGA للبدء
            </button>
          </div>
        </div>
      )}

      {/* Export Confirmation & Download Modal */}
      <AnimatePresence>
        {showExportModal && project && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" dir="rtl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#0b1020] border border-white/15 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                    <Download size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">تصدير ملف SVGA المعدل</h3>
                    <p className="text-[11px] text-slate-400">تصدير الأنميشن بصيغة SVGA 2.0 مع كامل الحركات والأصوات</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* File details summary cards */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-900/80 border border-white/5 rounded-2xl p-3">
                  <span className="text-[10px] text-slate-400 block mb-1">الأبعاد</span>
                  <span className="text-xs font-mono font-bold text-white">{project.width} × {project.height}</span>
                </div>
                <div className="bg-slate-900/80 border border-white/5 rounded-2xl p-3">
                  <span className="text-[10px] text-slate-400 block mb-1">عدد الفريمات / FPS</span>
                  <span className="text-xs font-mono font-bold text-white">{project.totalFrames} F @ {project.fps} fps</span>
                </div>
                <div className="bg-slate-900/80 border border-white/5 rounded-2xl p-3">
                  <span className="text-[10px] text-slate-400 block mb-1">عدد الطبقات</span>
                  <span className="text-xs font-mono font-bold text-indigo-400">{layers.filter(l => l.visible).length} طبقة</span>
                </div>
              </div>

              {/* File Name Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300">اسم الملف عند الحفظ:</label>
                <div className="bg-slate-900 border border-white/10 focus-within:border-indigo-500 rounded-2xl px-4 py-2.5 flex items-center gap-2">
                  <FileCode size={16} className="text-indigo-400 shrink-0" />
                  <input
                    type="text"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="my_animation_edited.svga"
                    className="w-full bg-transparent text-xs font-mono text-white outline-none"
                  />
                </div>
              </div>

              {/* Features preserved pill */}
              <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-2xl p-3 space-y-1.5 text-[11px] text-indigo-200">
                <div className="flex items-center gap-2 font-bold text-indigo-300">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span>الميزات المحفوظة في التصدير:</span>
                </div>
                <ul className="grid grid-cols-2 gap-1 text-[10px] text-slate-300 pr-5 list-disc">
                  <li>مسارات وتحولات الحركة الأصلية</li>
                  <li>المسارات الصوتية المدمجة ({project.audios?.length || 0})</li>
                  <li>الشفافية والتأثيرات النواقل (Shapes)</li>
                  <li>الصور والطبقات المستبدلة</li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-2xl shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer hover:scale-[1.02] disabled:opacity-50"
                >
                  <Download size={15} /> {isExporting ? 'جاري إنشاء الملف...' : 'تصدير وتحميل الآن'}
                </button>

                {onOpenViewer && (
                  <button
                    onClick={handlePreviewExported}
                    disabled={isExporting}
                    className="px-4 py-3 bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white text-xs font-bold rounded-2xl border border-white/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    title="معاينة الملف المعدل في مشغل SVGA"
                  >
                    <Play size={14} /> معاينة في المشغل
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
