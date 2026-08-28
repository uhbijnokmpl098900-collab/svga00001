export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // in degrees
  opacity: number;  // 0 to 100
}

export interface SVGAKeyframeSummary {
  startFrame: number;
  endFrame: number;
  hasShapes: boolean;
  hasTransform: boolean;
}

export interface EditableLayer {
  id: string;
  originalIndex: number;
  imageKey: string;
  name: string;
  type: 'image' | 'shape' | 'composite';
  visible: boolean;
  locked: boolean;
  thumbnailUrl?: string;
  
  // Transform properties
  transform: LayerTransform;
  initialBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  // Aspect ratio lock toggle
  aspectRatioLocked: boolean;
  
  // Associated sprite data
  spriteRef: any;
  matteKey?: string;
  framesCount: number;
  keyframeSummary: SVGAKeyframeSummary;
}

export interface SVGAProjectData {
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  durationSec: number;
  imagesMap: Record<string, string>; // key -> DataURL
  rawImages: Record<string, Uint8Array>; // key -> bytes
  audios: any[];
  rawMovie: any; // Raw protobuf object
}

export interface GuideLine {
  type: 'vertical' | 'horizontal';
  position: number;
}

export type CanvasTool = 'select' | 'hand' | 'zoom';
