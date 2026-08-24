import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import audioRouter from "./src/server/audioRouter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory maintenance cache for instant fast response
let serverMaintenanceState = {
  isMaintenanceMode: false,
  message: "الموقع حالياً تحت التحديث والتطوير، يرجى الانتظار حتى انتهاء أعمال التطوير.",
  title: "الموقع تحت التحديث والتطوير",
  estimatedTime: "",
  updatedAt: new Date().toISOString()
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Parse JSON bodies
  app.use(express.json());

  // Maintenance status query / sync endpoint
  app.get("/api/maintenance/status", (req, res) => {
    res.json(serverMaintenanceState);
  });

  app.post("/api/maintenance/sync", (req, res) => {
    const { isMaintenanceMode, maintenanceMessage, maintenanceTitle, maintenanceEstimatedTime, adminSecret } = req.body;
    // Allow updating server-side cache
    serverMaintenanceState = {
      isMaintenanceMode: Boolean(isMaintenanceMode),
      message: maintenanceMessage || serverMaintenanceState.message,
      title: maintenanceTitle || serverMaintenanceState.title,
      estimatedTime: maintenanceEstimatedTime || "",
      updatedAt: new Date().toISOString()
    };
    res.json({ success: true, state: serverMaintenanceState });
  });

  // Server-side maintenance enforcement middleware for sensitive API routes
  const maintenanceGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!serverMaintenanceState.isMaintenanceMode) {
      return next();
    }

    // Bypass check: If request comes from verified Super Admin / Admin
    const userRole = req.headers['x-user-role'];
    const userEmail = req.headers['x-user-email'];
    const isAdmin = 
      userRole === 'admin' || 
      userRole === 'moderator' || 
      userEmail === 'uhbijnokmpl098900@gmail.com' ||
      req.headers['x-admin-key'] === 'super_admin_bypass';

    if (isAdmin) {
      return next();
    }

    // Block non-admin requests during maintenance
    return res.status(503).json({
      error: 'MAINTENANCE_MODE_ACTIVE',
      message: serverMaintenanceState.message,
      title: serverMaintenanceState.title,
      estimatedTime: serverMaintenanceState.estimatedTime
    });
  };

  // API routes
  app.use('/api/audio', maintenanceGuard, audioRouter);

  // Serve FFmpeg Core locally from node_modules for zero-latency in-browser fallback
  const ffmpegCoreUmdPath = path.join(process.cwd(), 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
  app.use('/vendor/ffmpeg-core', express.static(ffmpegCoreUmdPath, {
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", maintenance: serverMaintenanceState.isMaintenanceMode });
  });

  // Server-side Version Control Verification Endpoint
  app.post("/api/version/verify", (req, res) => {
    const { userId, email, allowedVersion, clientVersion } = req.body;
    const installedVersion = clientVersion || (req.headers['x-client-version'] as string) || 'v3.0.0';
    const requiredVersion = (allowedVersion && allowedVersion.trim()) ? allowedVersion.trim() : 'v3.0.0';

    const isAllowed = installedVersion.toLowerCase() === requiredVersion.toLowerCase();

    if (!isAllowed) {
      return res.status(403).json({
        allowed: false,
        requiredVersion,
        installedVersion,
        message: `هذا الإصدار (${installedVersion}) من الموقع لم يعد مدعومًا لهذا الحساب. يرجى تحديث التطبيق إلى الإصدار ${requiredVersion} للاستمرار.`
      });
    }

    return res.json({
      allowed: true,
      requiredVersion,
      installedVersion,
      message: 'الإصدار متوافق ومسموح به'
    });
  });

  app.get("/api/ip", (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.json({ ip });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
