import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getDb } from "../db";
import { registerRasterAssetRoutes } from "../rasterAssetRoutes";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // Rate limiting para endpoints sensíveis
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Máximo 100 requisições por IP
    message: "Muitas requisições deste IP, tente novamente em 15 minutos.",
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // Máximo 10 tentativas de login
    message: "Muitas tentativas de login, tente novamente em 15 minutos.",
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  // Headers de segurança OWASP com Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cesium.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'", "https:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Necessário para CesiumJS
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback (com rate limiting)
  app.use("/api/oauth", authLimiter);
  registerOAuthRoutes(app);
  
  // Health Check Endpoint
  app.get("/api/health", async (req, res) => {
    const startTime = Date.now();
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};
    let overallStatus = "healthy";

    // 1. Verificar banco de dados
    try {
      const dbStart = Date.now();
      const db = await getDb();
      if (db) {
        // Executar query simples para testar conexão
        await db.execute("SELECT 1");
        checks.database = { status: "healthy", latency: Date.now() - dbStart };
      } else {
        checks.database = { status: "unhealthy", error: "Database not available" };
        overallStatus = "unhealthy";
      }
    } catch (error: any) {
      checks.database = { status: "unhealthy", error: error.message };
      overallStatus = "unhealthy";
    }

    // 2. Verificar memória
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    checks.memory = {
      status: memUsedMB < memTotalMB * 0.9 ? "healthy" : "warning",
      latency: 0,
    };

    // 3. Verificar uptime
    const uptimeSeconds = Math.round(process.uptime());
    checks.uptime = {
      status: "healthy",
      latency: uptimeSeconds,
    };

    // 4. Verificar ambiente
    checks.environment = {
      status: process.env.NODE_ENV === "production" ? "production" : "development",
    };

    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      version: process.env.npm_package_version || "1.0.0",
      checks,
      metrics: {
        memoryUsedMB: memUsedMB,
        memoryTotalMB: memTotalMB,
        uptimeSeconds,
        nodeVersion: process.version,
      },
    };

    res.status(overallStatus === "healthy" ? 200 : 503).json(response);
  });

  // tRPC API (com rate limiting)
  // Bytes raster nunca são servidos por express.static: cada tile/exportação valida sessão e projeto.
  registerRasterAssetRoutes(app);
  app.use("/api/trpc", apiLimiter);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
