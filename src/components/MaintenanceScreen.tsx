import React from 'react';
import { Hammer, Settings } from 'lucide-react';
import { motion } from 'framer-motion';

interface MaintenanceScreenProps {
  message?: string;
  appName?: string;
}

export function MaintenanceScreen({ message, appName = "VAP & SVGA Studio" }: MaintenanceScreenProps) {
  return (
    <div className="min-h-screen bg-[#070a12] flex items-center justify-center p-4 relative overflow-hidden" dir="rtl">
      {/* Background patterns */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5" />
        <div className="absolute top-1/4 -right-20 w-96 h-96 bg-orange-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-lg bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 sm:p-12 text-center shadow-2xl"
      >
        <div className="flex justify-center mb-6">
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="w-24 h-24 rounded-full border-4 border-orange-500/30 border-t-orange-500 flex items-center justify-center"
            >
              <Settings className="w-10 h-10 text-orange-400 opacity-50" />
            </motion.div>
            <motion.div 
              initial={{ rotate: -20 }}
              animate={{ rotate: 10 }}
              transition={{ duration: 1, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Hammer className="w-12 h-12 text-orange-500" />
            </motion.div>
          </div>
        </div>

        <h1 className="text-3xl font-black text-white mb-2">تحديث وتطوير</h1>
        <h2 className="text-lg font-medium text-orange-400 mb-6">{appName}</h2>
        
        <div className="bg-slate-950/50 rounded-xl p-6 border border-white/5">
          <p className="text-slate-300 leading-relaxed text-lg">
            {message || "الموقع حالياً تحت التحديث والتطوير، يرجى الانتظار حتى انتهاء أعمال التطوير."}
          </p>
        </div>

        <div className="mt-8 flex justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </motion.div>
    </div>
  );
}
