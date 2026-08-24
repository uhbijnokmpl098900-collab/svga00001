import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, RefreshCw, X, DownloadCloud, ArrowUpCircle } from 'lucide-react';
import { checkForServerUpdate, forceAppUpdateAndClearCache } from '../utils/versionControl';

export const AppUpdateToast: React.FC = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateData, setUpdateData] = useState<{
    serverVersion?: string;
    serverBuildId?: string;
  }>({});
  const [dismissed, setDismissed] = useState(false);

  const check = async () => {
    if (dismissed) return;
    const res = await checkForServerUpdate();
    if (res.hasUpdate) {
      setUpdateAvailable(true);
      setUpdateData({
        serverVersion: res.serverVersion,
        serverBuildId: res.serverBuildId
      });
    }
  };

  useEffect(() => {
    // Initial check after 5 seconds
    const initialTimer = setTimeout(() => {
      check();
    }, 5000);

    // Periodic check every 2 minutes
    const interval = setInterval(() => {
      check();
    }, 2 * 60 * 1000);

    // Check when user returns to tab
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dismissed]);

  if (!updateAvailable || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[3000] w-[92%] max-w-lg"
        dir="rtl"
      >
        <div className="p-4 bg-slate-900/95 border-2 border-indigo-500/50 backdrop-blur-2xl rounded-2xl shadow-[0_10px_35px_rgba(79,70,229,0.35)] flex items-center justify-between gap-4 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/30 animate-bounce">
              <ArrowUpCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  تحديث جديد مباشر 🚀
                </span>
                {updateData.serverVersion && (
                  <span className="text-xs font-mono font-bold text-cyan-300 dir-ltr">
                    {updateData.serverVersion}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1 font-medium leading-relaxed">
                تم نشر تحديثات جديدة للتطبيق على الرابط. اضغط للتطبيق فوراً.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => forceAppUpdateAndClearCache()}
              className="px-3.5 py-2 bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث الآن</span>
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
