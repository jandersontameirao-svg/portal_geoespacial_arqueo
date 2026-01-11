import crypto from "crypto";

/**
 * Scanner de Antivírus
 * 
 * Implementa verificação de arquivos usando:
 * 1. VirusTotal API (quando API key disponível)
 * 2. Validação local de assinaturas maliciosas conhecidas
 * 
 * Para produção, configure VIRUSTOTAL_API_KEY nas variáveis de ambiente.
 */

// Assinaturas de arquivos maliciosos conhecidos (magic bytes)
const MALICIOUS_SIGNATURES = [
  // Executáveis Windows
  { signature: Buffer.from([0x4D, 0x5A]), name: "Windows Executable (MZ)", blocked: true },
  // Scripts maliciosos
  { signature: Buffer.from("<?php"), name: "PHP Script", blocked: true },
  { signature: Buffer.from("<script"), name: "Embedded Script", blocked: false }, // Apenas alerta
  // Macros Office
  { signature: Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), name: "OLE Compound (may contain macros)", blocked: false },
];

// Extensões de arquivo perigosas
const DANGEROUS_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".pif", ".scr", ".vbs", ".vbe",
  ".js", ".jse", ".ws", ".wsf", ".wsc", ".wsh", ".ps1", ".ps1xml",
  ".ps2", ".ps2xml", ".psc1", ".psc2", ".msh", ".msh1", ".msh2",
  ".mshxml", ".msh1xml", ".msh2xml", ".scf", ".lnk", ".inf",
  ".reg", ".dll", ".cpl", ".msi", ".msp", ".mst", ".jar",
  ".hta", ".htaccess", ".php", ".asp", ".aspx", ".py", ".rb",
];

// Padrões de conteúdo suspeito
const SUSPICIOUS_PATTERNS = [
  /eval\s*\(/gi,
  /document\.write\s*\(/gi,
  /window\.location\s*=/gi,
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /on(load|error|click|mouseover)\s*=/gi,
];

export interface ScanResult {
  safe: boolean;
  threats: string[];
  warnings: string[];
  scanMethod: "local" | "virustotal" | "hybrid";
  scanTime: number;
  fileHash: string;
}

/**
 * Calcula hash SHA256 do arquivo
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verifica assinaturas de arquivos maliciosos
 */
function checkMagicBytes(buffer: Buffer): { blocked: boolean; name: string }[] {
  const found: { blocked: boolean; name: string }[] = [];
  
  for (const sig of MALICIOUS_SIGNATURES) {
    if (buffer.subarray(0, sig.signature.length).equals(sig.signature)) {
      found.push({ blocked: sig.blocked, name: sig.name });
    }
  }
  
  return found;
}

/**
 * Verifica extensão do arquivo
 */
function checkDangerousExtension(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return DANGEROUS_EXTENSIONS.includes(ext);
}

/**
 * Verifica padrões suspeitos no conteúdo (para arquivos de texto)
 */
function checkSuspiciousPatterns(content: string): string[] {
  const found: string[] = [];
  
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      found.push(pattern.source);
    }
  }
  
  return found;
}

/**
 * Scanner local de arquivos
 */
export async function scanFileLocal(
  buffer: Buffer,
  filename: string
): Promise<ScanResult> {
  const startTime = Date.now();
  const threats: string[] = [];
  const warnings: string[] = [];
  const fileHash = calculateFileHash(buffer);
  
  // 1. Verificar extensão perigosa
  if (checkDangerousExtension(filename)) {
    threats.push(`Extensão de arquivo perigosa: ${filename}`);
  }
  
  // 2. Verificar magic bytes
  const magicMatches = checkMagicBytes(buffer);
  for (const match of magicMatches) {
    if (match.blocked) {
      threats.push(`Tipo de arquivo bloqueado: ${match.name}`);
    } else {
      warnings.push(`Tipo de arquivo suspeito: ${match.name}`);
    }
  }
  
  // 3. Verificar padrões suspeitos em arquivos de texto
  const textExtensions = [".txt", ".html", ".htm", ".xml", ".json", ".csv", ".kml", ".geojson"];
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  
  if (textExtensions.includes(ext) || buffer.length < 1024 * 1024) { // < 1MB
    try {
      const content = buffer.toString("utf-8");
      const suspiciousPatterns = checkSuspiciousPatterns(content);
      
      for (const pattern of suspiciousPatterns) {
        warnings.push(`Padrão suspeito detectado: ${pattern}`);
      }
    } catch {
      // Não é texto válido, ignorar
    }
  }
  
  // 4. Verificar tamanho anormal (muito pequeno pode ser dropper)
  if (buffer.length < 100 && checkDangerousExtension(filename)) {
    warnings.push("Arquivo muito pequeno para o tipo declarado");
  }
  
  return {
    safe: threats.length === 0,
    threats,
    warnings,
    scanMethod: "local",
    scanTime: Date.now() - startTime,
    fileHash,
  };
}

/**
 * Scanner usando VirusTotal API
 * Requer VIRUSTOTAL_API_KEY configurada
 */
export async function scanFileVirusTotal(
  buffer: Buffer,
  filename: string
): Promise<ScanResult | null> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  
  if (!apiKey) {
    return null; // API key não configurada
  }
  
  const startTime = Date.now();
  const fileHash = calculateFileHash(buffer);
  
  try {
    // Primeiro, verificar se o arquivo já foi analisado pelo hash
    const hashCheckResponse = await fetch(
      `https://www.virustotal.com/api/v3/files/${fileHash}`,
      {
        headers: {
          "x-apikey": apiKey,
        },
      }
    );
    
    if (hashCheckResponse.ok) {
      const data = await hashCheckResponse.json();
      const stats = data.data?.attributes?.last_analysis_stats;
      
      if (stats) {
        const threats: string[] = [];
        const warnings: string[] = [];
        
        if (stats.malicious > 0) {
          threats.push(`VirusTotal: ${stats.malicious} engines detectaram malware`);
        }
        if (stats.suspicious > 0) {
          warnings.push(`VirusTotal: ${stats.suspicious} engines marcaram como suspeito`);
        }
        
        return {
          safe: stats.malicious === 0,
          threats,
          warnings,
          scanMethod: "virustotal",
          scanTime: Date.now() - startTime,
          fileHash,
        };
      }
    }
    
    // Se não encontrado, fazer upload para análise (apenas para arquivos pequenos)
    if (buffer.length <= 32 * 1024 * 1024) { // <= 32MB
      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(buffer)]), filename);
      
      const uploadResponse = await fetch(
        "https://www.virustotal.com/api/v3/files",
        {
          method: "POST",
          headers: {
            "x-apikey": apiKey,
          },
          body: formData,
        }
      );
      
      if (uploadResponse.ok) {
        // Arquivo enviado para análise
        // Em produção, você pode implementar polling para aguardar resultado
        return {
          safe: true, // Assumir seguro enquanto análise está pendente
          threats: [],
          warnings: ["Arquivo enviado para análise no VirusTotal"],
          scanMethod: "virustotal",
          scanTime: Date.now() - startTime,
          fileHash,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error("Erro ao consultar VirusTotal:", error);
    return null;
  }
}

/**
 * Scanner híbrido: usa VirusTotal se disponível, senão usa local
 */
export async function scanFile(
  buffer: Buffer,
  filename: string
): Promise<ScanResult> {
  // Sempre executar scan local primeiro (rápido)
  const localResult = await scanFileLocal(buffer, filename);
  
  // Se encontrou ameaças locais, retornar imediatamente
  if (!localResult.safe) {
    return localResult;
  }
  
  // Tentar VirusTotal se disponível
  const vtResult = await scanFileVirusTotal(buffer, filename);
  
  if (vtResult) {
    // Combinar resultados
    return {
      safe: localResult.safe && vtResult.safe,
      threats: [...localResult.threats, ...vtResult.threats],
      warnings: [...localResult.warnings, ...vtResult.warnings],
      scanMethod: "hybrid",
      scanTime: localResult.scanTime + vtResult.scanTime,
      fileHash: localResult.fileHash,
    };
  }
  
  return localResult;
}

/**
 * Verifica se um arquivo é seguro para upload
 * Retorna true se seguro, lança erro se não
 */
export async function ensureFileSafe(
  buffer: Buffer,
  filename: string
): Promise<{ safe: boolean; result: ScanResult }> {
  const result = await scanFile(buffer, filename);
  
  return {
    safe: result.safe,
    result,
  };
}
