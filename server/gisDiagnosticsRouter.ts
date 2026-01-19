/**
 * GIS Diagnostics Router - Sprint A
 * 
 * Fornece endpoints para monitorar o status dos serviços GIS:
 * - PostGIS (banco de dados geoespacial)
 * - QGIS Server (servidor WMS)
 * - Redis (cache)
 * - Worker (processamento assíncrono)
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

// Tipos
interface ServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  message: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

interface DiagnosticsResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
}

/**
 * Check PostGIS status
 */
async function checkPostGIS(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    // Try to connect and query PostGIS version
    const { Client } = await import('pg');
    const client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'arqueo_gis',
      user: process.env.POSTGRES_USER || 'gis_user',
      password: process.env.POSTGRES_PASSWORD || 'gis_password',
    });
    
    await client.connect();
    
    const result = await client.query('SELECT version(), postgis_version()');
    const responseTime = Date.now() - startTime;
    
    await client.end();
    
    return {
      name: 'PostGIS',
      status: 'healthy',
      message: 'Connected successfully',
      responseTime,
      details: {
        postgres: result.rows[0].version.split(',')[0],
        postgis: result.rows[0].postgis_version,
      },
    };
  } catch (error) {
    return {
      name: 'PostGIS',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check QGIS Server status via GetCapabilities
 */
async function checkQGISServer(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    const qgisUrl = process.env.QGIS_SERVER_URL || 'http://localhost:8080/ows';
    const url = `${qgisUrl}?SERVICE=WMS&REQUEST=GetCapabilities`;
    
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        name: 'QGIS Server',
        status: 'unhealthy',
        message: `HTTP ${response.status}: ${response.statusText}`,
        responseTime,
      };
    }
    
    const text = await response.text();
    
    // Check if response contains WMS capabilities
    if (!text.includes('WMS_Capabilities') && !text.includes('WMT_MS_Capabilities')) {
      return {
        name: 'QGIS Server',
        status: 'unhealthy',
        message: 'Invalid GetCapabilities response',
        responseTime,
      };
    }
    
    // Extract layer names
    const layerMatches = text.match(/<Layer[^>]*>[\s\S]*?<Name>(.*?)<\/Name>/g) || [];
    const layers = layerMatches
      .map(match => {
        const nameMatch = match.match(/<Name>(.*?)<\/Name>/);
        return nameMatch ? nameMatch[1] : null;
      })
      .filter(Boolean);
    
    return {
      name: 'QGIS Server',
      status: 'healthy',
      message: 'GetCapabilities OK',
      responseTime,
      details: {
        url: qgisUrl,
        layers: layers.length,
        layerNames: layers,
      },
    };
  } catch (error) {
    return {
      name: 'QGIS Server',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check Redis status
 */
async function checkRedis(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    const { createClient } = await import('redis');
    const client = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });
    
    await client.connect();
    
    const pong = await client.ping();
    const responseTime = Date.now() - startTime;
    
    // Get info
    const info = await client.info();
    const versionMatch = info.match(/redis_version:(\S+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    
    await client.quit();
    
    return {
      name: 'Redis',
      status: pong === 'PONG' ? 'healthy' : 'unhealthy',
      message: pong === 'PONG' ? 'PING successful' : 'PING failed',
      responseTime,
      details: {
        version,
      },
    };
  } catch (error) {
    return {
      name: 'Redis',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check Worker status via health endpoint
 */
async function checkWorker(): Promise<ServiceStatus> {
  const startTime = Date.now();
  
  try {
    const workerUrl = process.env.WORKER_URL || 'http://localhost:3001';
    const url = `${workerUrl}/health`;
    
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        name: 'Worker',
        status: 'unhealthy',
        message: `HTTP ${response.status}: ${response.statusText}`,
        responseTime,
      };
    }
    
    const data = await response.json();
    
    return {
      name: 'Worker',
      status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
      message: data.status === 'healthy' ? 'Health check OK' : 'Health check failed',
      responseTime,
      details: {
        uptime: data.uptime,
        jobsProcessed: data.worker?.jobsProcessed,
        connections: data.connections,
      },
    };
  } catch (error) {
    return {
      name: 'Worker',
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Run all diagnostics
 */
async function runDiagnostics(): Promise<DiagnosticsResult> {
  const services = await Promise.all([
    checkPostGIS(),
    checkQGISServer(),
    checkRedis(),
    checkWorker(),
  ]);
  
  // Determine overall status
  const healthyCount = services.filter(s => s.status === 'healthy').length;
  const unhealthyCount = services.filter(s => s.status === 'unhealthy').length;
  
  let overall: 'healthy' | 'degraded' | 'unhealthy';
  if (unhealthyCount === 0) {
    overall = 'healthy';
  } else if (healthyCount > 0) {
    overall = 'degraded';
  } else {
    overall = 'unhealthy';
  }
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    services,
  };
}

export const gisDiagnosticsRouter = router({
  /**
   * Get status of all GIS services
   */
  getStatus: publicProcedure.query(async () => {
    return await runDiagnostics();
  }),
  
  /**
   * Test WMS GetMap request
   */
  testGetMap: publicProcedure
    .input(z.object({
      layer: z.string(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      width: z.number().default(256),
      height: z.number().default(256),
      crs: z.string().default('EPSG:4674'),
    }))
    .query(async ({ input }: { input: { layer: string; bbox: [number, number, number, number]; width: number; height: number; crs: string } }) => {
      const qgisUrl = process.env.QGIS_SERVER_URL || 'http://localhost:8080/ows';
      
      const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: '1.3.0',
        LAYERS: input.layer,
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: 'TRUE',
        CRS: input.crs,
        WIDTH: input.width.toString(),
        HEIGHT: input.height.toString(),
        BBOX: input.bbox.join(','),
      });
      
      const url = `${qgisUrl}?${params.toString()}`;
      
      try {
        const startTime = Date.now();
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(10000), // 10s timeout
        });
        const responseTime = Date.now() - startTime;
        
        if (!response.ok) {
          return {
            success: false,
            message: `HTTP ${response.status}: ${response.statusText}`,
            responseTime,
          };
        }
        
        const contentType = response.headers.get('content-type');
        
        return {
          success: true,
          message: 'GetMap request successful',
          responseTime,
          contentType,
          url,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          url,
        };
      }
    }),
});
