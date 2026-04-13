import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/ip", (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.json({ ip });
  });

  // Backend logic for SVGA to PAG conversion
  app.post('/api/convert', async (req, res) => {
    try {
      const { files, format } = req.body;
      
      if (!files || !Array.isArray(files)) {
        return res.status(400).json({ error: 'Invalid files data' });
      }

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 2000));

      // In a real scenario, we would use a backend library to perform the actual conversion
      // For now, we'll return a simulated success response
      res.json({ 
        status: 'success', 
        message: `Successfully processed ${files.length} files to ${format}` 
      });
    } catch (error) {
      console.error('Conversion error:', error);
      res.status(500).json({ error: 'Internal server error during conversion' });
    }
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
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
