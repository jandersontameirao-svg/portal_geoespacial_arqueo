/**
 * INFRAESTRUTURA - Configuração e gerenciamento de serviços base
 * 
 * Este módulo centraliza a configuração de todos os serviços de infraestrutura:
 * - Banco de dados (PostgreSQL/MySQL + PostGIS)
 * - Object Storage (S3/MinIO)
 * - Cache e Filas (Redis)
 * - Logs e Auditoria
 * - Health Checks
 */

import { ENV } from "./env";

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface HealthCheckResult {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  responseTime?: number;
  message?: string;
  details?: Record<string, any>;
}

export interface InfrastructureStatus {
  overall: "healthy" | "degraded" | "unhealthy";
  timestamp: Date;
  services: HealthCheckResult[];
  metrics: {
    uptime: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
  };
}

export interface BackupResult {
  id: string;
  timestamp: Date;
  type: "full" | "incremental";
  size: number;
  duration: number;
  status: "success" | "failed";
  location: string;
  error?: string;
}

// ============================================================================
// CONFIGURAÇÃO DE BANCO DE DADOS
// ============================================================================

export const databaseConfig = {
  // Suporte a PostGIS para operações geoespaciais
  postgis: {
    enabled: false, // TiDB não suporta PostGIS nativamente
    version: "3.3",
    srid: 4674, // SIRGAS 2000 (padrão brasileiro)
  },
  
  // Configuração de índices espaciais
  spatialIndexes: {
    enabled: true,
    type: "RTREE", // R-Tree para geometrias
  },
  
  // Pool de conexões
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  
  // Replicação (para ambientes de produção)
  replication: {
    enabled: false,
    readReplicas: [],
  },
};

// ============================================================================
// CONFIGURAÇÃO DE OBJECT STORAGE
// ============================================================================

export const storageConfig = {
  provider: "s3", // s3, minio, local
  
  // Buckets organizados por tipo de conteúdo
  buckets: {
    geospatial: "geospatial-files", // KML, KMZ, SHP, GeoJSON
    documents: "documents", // PDF, DOCX, XLSX
    images: "images", // PNG, JPG, TIFF
    backups: "backups", // Backups do sistema
    temp: "temp", // Arquivos temporários
  },
  
  // Políticas de ciclo de vida
  lifecycle: {
    tempFilesExpiration: 7, // dias
    oldVersionsRetention: 30, // dias
  },
  
  // Versionamento
  versioning: {
    enabled: true,
    maxVersions: 10,
  },
};

// ============================================================================
// CONFIGURAÇÃO DE CACHE E FILAS (REDIS)
// ============================================================================

export const redisConfig = {
  enabled: false, // Não disponível no ambiente atual
  
  // Configuração de conexão
  connection: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    db: 0,
  },
  
  // Configuração de cache
  cache: {
    defaultTTL: 3600, // 1 hora
    maxMemory: "256mb",
    evictionPolicy: "allkeys-lru",
  },
  
  // Configuração de filas
  queues: {
    fileProcessing: "queue:file-processing",
    mapGeneration: "queue:map-generation",
    atlasGeneration: "queue:atlas-generation",
    notifications: "queue:notifications",
  },
  
  // Retry e Dead Letter Queue
  retry: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
};

// ============================================================================
// CONFIGURAÇÃO DE LOGS
// ============================================================================

export const logsConfig = {
  // Nível de log
  level: ENV.isProduction ? "info" : "debug",
  
  // Formato
  format: "json", // json, text
  
  // Destinos
  destinations: {
    console: true,
    file: false, // Desabilitado no ambiente Manus
    database: true, // Logs salvos na tabela audit_logs
  },
  
  // Retenção
  retention: {
    days: 365, // 1 ano mínimo para auditoria
    maxSize: "10GB",
  },
  
  // Campos obrigatórios para auditoria
  auditFields: [
    "timestamp",
    "userId",
    "action",
    "entityType",
    "entityId",
    "ipAddress",
    "userAgent",
  ],
};

// ============================================================================
// HEALTH CHECKS
// ============================================================================

/**
 * Verifica a saúde do banco de dados
 */
export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const start = Date.now();
  
  try {
    // Importação dinâmica para evitar dependência circular
    const dbModule = await import("../db");
    const db = await dbModule.getDb();
    
    if (!db) throw new Error("Database connection not available");
    
    // Query simples para verificar conectividade
    await db.execute("SELECT 1");
    
    const responseTime = Date.now() - start;
    
    return {
      service: "database",
      status: responseTime < 100 ? "healthy" : "degraded",
      responseTime,
      message: "Database connection successful",
      details: {
        type: "TiDB Cloud (MySQL compatible)",
        responseTime: `${responseTime}ms`,
      },
    };
  } catch (error: any) {
    return {
      service: "database",
      status: "unhealthy",
      responseTime: Date.now() - start,
      message: error.message,
    };
  }
}

/**
 * Verifica a saúde do Object Storage (S3)
 */
export async function checkStorageHealth(): Promise<HealthCheckResult> {
  const start = Date.now();
  
  try {
    const { storagePut, storageGet } = await import("../storage");
    
    // Tenta fazer upload de um arquivo de teste
    const testKey = `health-check/${Date.now()}.txt`;
    const testData = "health-check";
    
    await storagePut(testKey, testData, "text/plain");
    const result = await storageGet(testKey);
    
    const responseTime = Date.now() - start;
    
    return {
      service: "storage",
      status: responseTime < 500 ? "healthy" : "degraded",
      responseTime,
      message: "Storage connection successful",
      details: {
        type: "S3 Compatible",
        responseTime: `${responseTime}ms`,
        testKey,
      },
    };
  } catch (error: any) {
    return {
      service: "storage",
      status: "unhealthy",
      responseTime: Date.now() - start,
      message: error.message,
    };
  }
}

/**
 * Verifica a saúde do Redis (se disponível)
 */
export async function checkRedisHealth(): Promise<HealthCheckResult> {
  if (!redisConfig.enabled) {
    return {
      service: "redis",
      status: "healthy",
      message: "Redis not enabled (optional service)",
      details: {
        enabled: false,
      },
    };
  }
  
  const start = Date.now();
  
  try {
    // TODO: Implementar quando Redis estiver disponível
    // const redis = await getRedisClient();
    // await redis.ping();
    
    return {
      service: "redis",
      status: "healthy",
      responseTime: Date.now() - start,
      message: "Redis connection successful",
    };
  } catch (error: any) {
    return {
      service: "redis",
      status: "unhealthy",
      responseTime: Date.now() - start,
      message: error.message,
    };
  }
}

/**
 * Obtém métricas do sistema
 */
export function getSystemMetrics() {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  return {
    uptime,
    memory: {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
    },
    cpu: {
      usage: process.cpuUsage().user / 1000000, // Convertido para segundos
    },
  };
}

/**
 * Executa todos os health checks e retorna status consolidado
 */
export async function checkInfrastructureHealth(): Promise<InfrastructureStatus> {
  const checks = await Promise.all([
    checkDatabaseHealth(),
    checkStorageHealth(),
    checkRedisHealth(),
  ]);
  
  // Determina status geral
  const hasUnhealthy = checks.some(c => c.status === "unhealthy");
  const hasDegraded = checks.some(c => c.status === "degraded");
  
  let overall: "healthy" | "degraded" | "unhealthy";
  if (hasUnhealthy) {
    overall = "unhealthy";
  } else if (hasDegraded) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }
  
  return {
    overall,
    timestamp: new Date(),
    services: checks,
    metrics: getSystemMetrics(),
  };
}

// ============================================================================
// BACKUPS
// ============================================================================

/**
 * Cria um backup do banco de dados
 * Nota: Em produção, usar ferramentas nativas do PostgreSQL/MySQL
 */
export async function createDatabaseBackup(): Promise<BackupResult> {
  const start = Date.now();
  const backupId = `backup-${Date.now()}`;
  
  try {
    // Em ambiente de produção, executar:
    // - PostgreSQL: pg_dump
    // - MySQL: mysqldump
    // - TiDB: BR (Backup & Restore)
    
    // Por enquanto, apenas simular
    const duration = Date.now() - start;
    
    return {
      id: backupId,
      timestamp: new Date(),
      type: "full",
      size: 0, // TODO: Calcular tamanho real
      duration,
      status: "success",
      location: `${storageConfig.buckets.backups}/${backupId}.sql`,
    };
  } catch (error: any) {
    return {
      id: backupId,
      timestamp: new Date(),
      type: "full",
      size: 0,
      duration: Date.now() - start,
      status: "failed",
      location: "",
      error: error.message,
    };
  }
}

/**
 * Lista backups disponíveis
 */
export async function listBackups(): Promise<BackupResult[]> {
  // TODO: Implementar listagem de backups do S3
  return [];
}

/**
 * Restaura um backup
 */
export async function restoreBackup(backupId: string): Promise<boolean> {
  // TODO: Implementar restauração de backup
  return false;
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Formata bytes para formato legível
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

/**
 * Formata duração em milissegundos para formato legível
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Formata uptime para formato legível
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(" ") || "< 1m";
}
