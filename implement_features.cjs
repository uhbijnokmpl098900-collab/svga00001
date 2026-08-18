const fs = require('fs');
let content = fs.readFileSync('src/components/UniversalMotionTools.tsx', 'utf8');

// 1. Add background image and audio extraction states
const stateOld = `  // Background Customization
  const [bgMode, setBgMode] = useState<'checker' | 'color'>('checker');
  const [bgColor, setBgColor] = useState<string>('#0B0C10');
  const customColorInputRef = useRef<HTMLInputElement>(null);`;

const stateNew = `  // Background Customization
  const [bgMode, setBgMode] = useState<'checker' | 'color' | 'image'>('checker');
  const [bgColor, setBgColor] = useState<string>('#0B0C10');
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const customColorInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const [isExtractingAudio, setIsExtractingAudio] = useState<boolean>(false);`;
content = content.replace(stateOld, stateNew);

// 2. Add handleBgImageUpload and handleDownloadOriginalAudio
const handlersOld = `  const handleTogglePlaybackMute = () => {`;
const handlersNew = `  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBgImageUrl(URL.createObjectURL(file));
      setBgMode('image');
    }
  };

  const handleDownloadOriginalAudio = async () => {
    if (!sourceFile) return;
    setIsExtractingAudio(true);
    try {
      const formData = new FormData();
      formData.append('video', sourceFile);
      formData.append('format', 'mp3');
      formData.append('quality', '192k');

      const res = await fetch('/api/audio/extract', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      const jobId = data.jobId;
      if (!jobId) throw new Error("No Job ID");

      const checkStatus = async () => {
        try {
          const statusRes = await fetch(\`/api/audio/status/\${jobId}\`);
          const statusData = await statusRes.json();
          if (statusData.status === 'completed') {
            window.location.href = \`/api/audio/download/\${jobId}\`;
            setIsExtractingAudio(false);
          } else if (statusData.status === 'failed') {
            alert('فشل استخراج الصوت');
            setIsExtractingAudio(false);
          } else {
            setTimeout(checkStatus, 1000);
          }
        } catch (e) {
          setTimeout(checkStatus, 1000);
        }
      };
      checkStatus();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء محاولة استخراج الصوت.');
      setIsExtractingAudio(false);
    }
  };

  const handleTogglePlaybackMute = () => {`;
content = content.replace(handlersOld, handlersNew);

// 3. Audio UI modifications (download button + default mute behavior)
// Wait, the user said "انا عايز لما اعمل حفظ للملف الصوت ما يتحفظش تلقائي غير لما اعمل حذف للصوت"
// This actually implies that the original audio IS saved automatically unless they explicitly click "Mute Original Audio" (which sets muteOriginalAudio to true).
// This is exactly how the code works right now! 
// Let's add the "Download Audio" button.

const audioUIOld = `              {/* Original VAP Audio Control */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
                <span className="text-sm font-bold text-slate-300">
                  كتم الصوت الأصلي
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={muteOriginalAudio}
                    onChange={(e) => setMuteOriginalAudio(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                </label>
              </div>`;

const audioUINew = `              {/* Original VAP Audio Control */}
              <div className="flex flex-col gap-2 p-3 rounded-2xl bg-white/5 border border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-300">
                    إلغاء حفظ الصوت مع الفيديو (كتم)
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={muteOriginalAudio}
                      onChange={(e) => setMuteOriginalAudio(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                  </label>
                </div>
                <button 
                  onClick={handleDownloadOriginalAudio}
                  disabled={isExtractingAudio}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold rounded-xl transition-all border border-indigo-500/20"
                >
                  <Music className="w-4 h-4" />
                  {isExtractingAudio ? 'جاري التحميل...' : 'تنزيل الصوت الأصلي (MP3)'}
                </button>
              </div>`;
content = content.replace(audioUIOld, audioUINew);


// 4. Background UI modifications
const bgUIOld = `                {/* Custom Color Button */}
                <button
                  onClick={() => {
                    customColorInputRef.current?.click();
                    setBgMode('color');
                  }}
                  title="لون مخصص"
                  className={\`h-9 rounded-xl border transition-all flex items-center justify-center relative overflow-hidden bg-gradient-to-tr from-pink-500 via-indigo-500 to-emerald-400 \${
                    bgMode === 'color' && !presetColors.some(p => !p.isChecker && p.value.toLowerCase() === bgColor.toLowerCase())
                      ? 'border-white ring-2 ring-purple-500/50 scale-105'
                      : 'border-white/10 hover:border-white/20'
                  }\`}
                >
                  <Sparkles className="w-4 h-4 text-white drop-shadow" />
                  <input
                    ref={customColorInputRef}
                    type="color"
                    value={bgColor}
                    onChange={(e) => {
                      setBgColor(e.target.value);
                      setBgMode('color');
                    }}
                    className="absolute opacity-0 w-full h-full cursor-pointer"
                  />
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 bg-white/2 px-3 py-1.5 rounded-lg border border-white/5">
                <span>الخلفية الحالية:</span>
                <span className="font-mono text-indigo-300 font-bold">
                  {bgMode === 'checker' ? 'شبكة الشفافية (Checkerboard)' : bgColor}
                </span>
              </div>`;

const bgUINew = `                {/* Custom Color Button */}
                <button
                  onClick={() => {
                    customColorInputRef.current?.click();
                    setBgMode('color');
                  }}
                  title="لون مخصص"
                  className={\`h-9 rounded-xl border transition-all flex items-center justify-center relative overflow-hidden bg-gradient-to-tr from-pink-500 via-indigo-500 to-emerald-400 \${
                    bgMode === 'color' && !presetColors.some(p => !p.isChecker && p.value.toLowerCase() === bgColor.toLowerCase())
                      ? 'border-white ring-2 ring-purple-500/50 scale-105'
                      : 'border-white/10 hover:border-white/20'
                  }\`}
                >
                  <Sparkles className="w-4 h-4 text-white drop-shadow" />
                  <input
                    ref={customColorInputRef}
                    type="color"
                    value={bgColor}
                    onChange={(e) => {
                      setBgColor(e.target.value);
                      setBgMode('color');
                    }}
                    className="absolute opacity-0 w-full h-full cursor-pointer"
                  />
                </button>

                {/* Upload Image Button */}
                <button
                  onClick={() => bgImageInputRef.current?.click()}
                  title="صورة مخصصة"
                  className={\`h-9 rounded-xl border transition-all flex items-center justify-center overflow-hidden bg-white/5 \${
                    bgMode === 'image'
                      ? 'border-indigo-400 ring-2 ring-indigo-500/40 scale-105'
                      : 'border-white/10 hover:border-white/20 hover:bg-white/10'
                  }\`}
                >
                  <Plus className="w-4 h-4 text-white" />
                  <input
                    ref={bgImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBgImageUpload}
                    className="hidden"
                  />
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 bg-white/2 px-3 py-1.5 rounded-lg border border-white/5">
                <span>الخلفية الحالية:</span>
                <span className="font-mono text-indigo-300 font-bold truncate max-w-[120px] text-left">
                  {bgMode === 'checker' ? 'شبكة الشفافية' : bgMode === 'image' ? 'صورة مخصصة' : bgColor}
                </span>
              </div>`;
content = content.replace(bgUIOld, bgUINew);


// 5. Canvas preview style update
const previewStyleOld = `                style={{ 
                  backgroundColor: bgMode === 'color' ? bgColor : '#0E1017' 
                }}`;
const previewStyleNew = `                style={{ 
                  backgroundColor: bgMode === 'color' ? bgColor : '#0E1017',
                  backgroundImage: bgMode === 'image' && bgImageUrl ? \`url(\${bgImageUrl})\` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}`;
content = content.replace(previewStyleOld, previewStyleNew);


// 6. Support Standard MP4 Export feature
// First, add target format enum
content = content.replace(
  "const [exportTargetFormat, setExportTargetFormat] = useState<'svga' | 'vap'>('svga');",
  "const [exportTargetFormat, setExportTargetFormat] = useState<'svga' | 'vap' | 'mp4'>('svga');"
);

// Add the MP4 Export button
const exportButtonsOld = `              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExportTargetFormat('vap')}
                  className={\`flex-1 py-3 rounded-2xl font-bold text-sm transition-all flex flex-col items-center justify-center gap-1.5 border \${
                    exportTargetFormat === 'vap' 
                      ? 'bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/25 scale-105 z-10' 
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }\`}
                >
                  <div className="flex items-center gap-1.5">
                    <Film className="w-4 h-4" />
                    صيغة VAP (MP4)
                  </div>
                </button>
                <button
                  onClick={() => setExportTargetFormat('svga')}
                  className={\`flex-1 py-3 rounded-2xl font-bold text-sm transition-all flex flex-col items-center justify-center gap-1.5 border \${
                    exportTargetFormat === 'svga' 
                      ? 'bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-500/25 scale-105 z-10' 
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }\`}
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    صيغة SVGA 2.0
                  </div>
                </button>
              </div>`;

const exportButtonsNew = `              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExportTargetFormat('vap')}
                  className={\`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-1 border \${
                    exportTargetFormat === 'vap' 
                      ? 'bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/25 scale-105 z-10' 
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }\`}
                  title="تصدير كملف VAP للبرمجة مع شفافية"
                >
                  <Film className="w-4 h-4" />
                  VAP
                </button>
                <button
                  onClick={() => setExportTargetFormat('svga')}
                  className={\`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-1 border \${
                    exportTargetFormat === 'svga' 
                      ? 'bg-emerald-500 text-white border-emerald-400 shadow-lg shadow-emerald-500/25 scale-105 z-10' 
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }\`}
                  title="تصدير كملف SVGA 2.0 مع شفافية نظيفة"
                >
                  <Sparkles className="w-4 h-4" />
                  SVGA
                </button>
                <button
                  onClick={() => setExportTargetFormat('mp4')}
                  className={\`flex-1 py-2.5 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-1 border \${
                    exportTargetFormat === 'mp4' 
                      ? 'bg-pink-500 text-white border-pink-400 shadow-lg shadow-pink-500/25 scale-105 z-10' 
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }\`}
                  title="تصدير كفيديو عادي (بدون شفافية) مع الخلفية الحالية"
                >
                  <Video className="w-4 h-4" />
                  MP4 عادي
                </button>
              </div>`;
content = content.replace(exportButtonsOld, exportButtonsNew);

// Need to import Video
if (!content.includes('Video, ')) {
    content = content.replace("Film, HelpCircle", "Film, HelpCircle, Video");
}

fs.writeFileSync('src/components/UniversalMotionTools.tsx', content);
console.log("Features injected part 1");
