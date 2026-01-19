/**
 * Worker Stub - Sprint A
 * 
 * Este é um worker simplificado que apenas:
 * 1. Conecta no Redis
 * 2. Conecta no PostGIS
 * 3. Expõe endpoint /health para healthcheck
 * 
 * Em sprints futuras, este worker processará jobs assíncronos:
 * - Conversão de Shapefiles
 * - Geração de mapas ABNT
 * - Processamento de atlas
 * - Validação de arquivos geoespaciais
 */

const http = require('http');
const { createClient } = require('redis');
const { Client } = require('pg');

// Configuração
const config = {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'postgis',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'arqueo_gis',
    user: process.env.POSTGRES_USER || 'gis_user',
    password: process.env.POSTGRES_PASSWORD || 'gis_password',
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
    logLevel: process.env.WORKER_LOG_LEVEL || 'info',
  },
};

// Estado do worker
const state = {
  redis: { connected: false, error: null },
  postgres: { connected: false, error: null },
  startedAt: new Date(),
  jobsProcessed: 0,
};

// Logger simples
const log = {
  info: (...args) => console.log(`[INFO] [${new Date().toISOString()}]`, ...args),
  error: (...args) => console.error(`[ERROR] [${new Date().toISOString()}]`, ...args),
  warn: (...args) => console.warn(`[WARN] [${new Date().toISOString()}]`, ...args),
};

// Cliente Redis
let redisClient;

// Cliente PostgreSQL
let pgClient;

// Conectar Redis
async function connectRedis() {
  try {
    redisClient = createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
      },
    });

    redisClient.on('error', (err) => {
      log.error('Redis error:', err);
      state.redis.error = err.message;
      state.redis.connected = false;
    });

    redisClient.on('connect', () => {
      log.info('Redis connected');
      state.redis.connected = true;
      state.redis.error = null;
    });

    await redisClient.connect();
    
    // Testar ping
    const pong = await redisClient.ping();
    log.info('Redis ping:', pong);
    
  } catch (error) {
    log.error('Failed to connect to Redis:', error);
    state.redis.error = error.message;
    state.redis.connected = false;
  }
}

// Conectar PostgreSQL
async function connectPostgres() {
  try {
    pgClient = new Client(config.postgres);
    
    pgClient.on('error', (err) => {
      log.error('PostgreSQL error:', err);
      state.postgres.error = err.message;
      state.postgres.connected = false;
    });

    await pgClient.connect();
    
    // Testar query
    const result = await pgClient.query('SELECT version(), postgis_version()');
    log.info('PostgreSQL connected:', result.rows[0]);
    
    state.postgres.connected = true;
    state.postgres.error = null;
    
  } catch (error) {
    log.error('Failed to connect to PostgreSQL:', error);
    state.postgres.error = error.message;
    state.postgres.connected = false;
  }
}

// Health check server
const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    const isHealthy = state.redis.connected && state.postgres.connected;
    
    res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: isHealthy ? 'healthy' : 'unhealthy',
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      connections: {
        redis: {
          connected: state.redis.connected,
          error: state.redis.error,
        },
        postgres: {
          connected: state.postgres.connected,
          error: state.postgres.error,
        },
      },
      worker: {
        concurrency: config.worker.concurrency,
        jobsProcessed: state.jobsProcessed,
      },
      timestamp: new Date().toISOString(),
    }, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Inicializar worker
async function start() {
  log.info('Starting worker...');
  log.info('Config:', JSON.stringify(config, null, 2));
  
  // Conectar serviços
  await connectRedis();
  await connectPostgres();
  
  // Iniciar health check server
  const port = 3001;
  server.listen(port, () => {
    log.info(`Health check server listening on port ${port}`);
    log.info('Worker ready to process jobs (stub mode)');
  });
  
  // Simular processamento de jobs (stub)
  setInterval(() => {
    if (state.redis.connected && state.postgres.connected) {
      // Em produção, aqui seria o processamento real de jobs
      state.jobsProcessed++;
      if (state.jobsProcessed % 10 === 0) {
        log.info(`Jobs processed: ${state.jobsProcessed} (stub mode)`);
      }
    }
  }, 5000);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  log.info('SIGTERM received, shutting down gracefully...');
  
  server.close(() => {
    log.info('HTTP server closed');
  });
  
  if (redisClient) {
    await redisClient.quit();
    log.info('Redis connection closed');
  }
  
  if (pgClient) {
    await pgClient.end();
    log.info('PostgreSQL connection closed');
  }
  
  process.exit(0);
});

// Start
start().catch((error) => {
  log.error('Failed to start worker:', error);
  process.exit(1);
});
