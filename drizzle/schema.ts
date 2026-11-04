import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json, index, unique } from "drizzle-orm/mysql-core";

/**
 * PORTAL GEOESPACIAL CORPORATIVO - GRUPO ARQUEO
 * Schema completo para gerenciamento de projetos geoespaciais
 */

// ============================================================================
// USUÁRIOS E AUTENTICAÇÃO
// ============================================================================

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  // Hash de senha (scrypt) para login próprio e-mail+senha. Nulo para contas
  // sem senha local (ex.: criadas por convite ainda não ativado).
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "editor", "client"]).default("client").notNull(),
  mfaEnabled: boolean("mfaEnabled").default(false).notNull(),
  mfaSecret: varchar("mfaSecret", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => ({
  emailIdx: index("email_idx").on(table.email),
  roleIdx: index("role_idx").on(table.role),
}));

export const invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "editor", "client"]).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  invitedBy: int("invitedBy").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index("token_idx").on(table.token),
  emailIdx: index("email_idx").on(table.email),
}));

// ============================================================================
// PROJETOS
// ============================================================================

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  description: text("description"),
  clientName: varchar("clientName", { length: 255 }),
  clientDocument: varchar("clientDocument", { length: 50 }),
  // AOI (Area of Interest) armazenada como GeoJSON
  aoiGeometry: json("aoiGeometry").$type<{
    type: string;
    coordinates: number[][][] | number[][][][];
  }>(),
  aoiBounds: json("aoiBounds").$type<{
    north: number;
    south: number;
    east: number;
    west: number;
  }>(),
  status: mysqlEnum("status", ["active", "archived", "completed"]).default("active").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: index("code_idx").on(table.code),
  statusIdx: index("status_idx").on(table.status),
  createdByIdx: index("created_by_idx").on(table.createdBy),
}));

export const projectMembers = mysqlTable("project_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "editor", "viewer"]).default("viewer").notNull(),
  addedBy: int("addedBy").notNull(),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
}, (table) => ({
  projectUserIdx: unique("project_user_unique").on(table.projectId, table.userId),
  projectIdx: index("project_idx").on(table.projectId),
  userIdx: index("user_idx").on(table.userId),
}));

// ============================================================================
// ARQUIVOS E VERSIONAMENTO
// ============================================================================

export const files = mysqlTable("files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileType: mysqlEnum("fileType", [
    "kml", "kmz", "shp", "geojson", "geotiff", "pdf", "docx", "xlsx", "image", "other"
  ]).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  fileSize: int("fileSize").notNull(), // bytes
  s3Key: varchar("s3Key", { length: 500 }).notNull(),
  s3Url: text("s3Url").notNull(),
  // Metadados geoespaciais
  isGeospatial: boolean("isGeospatial").default(false).notNull(),
  crs: varchar("crs", { length: 50 }), // ex: EPSG:4674
  bounds: json("bounds").$type<{
    north: number;
    south: number;
    east: number;
    west: number;
  }>(),
  // Metadados gerais
  metadata: json("metadata").$type<Record<string, any>>(),
  // Controle
  currentVersion: int("currentVersion").default(1).notNull(),
  uploadedBy: int("uploadedBy").notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  fileTypeIdx: index("file_type_idx").on(table.fileType),
  uploadedByIdx: index("uploaded_by_idx").on(table.uploadedBy),
}));

export const fileVersions = mysqlTable("file_versions", {
  id: int("id").autoincrement().primaryKey(),
  fileId: int("fileId").notNull(),
  version: int("version").notNull(),
  s3Key: varchar("s3Key", { length: 500 }).notNull(),
  s3Url: text("s3Url").notNull(),
  fileSize: int("fileSize").notNull(),
  sha256: varchar("sha256", { length: 64 }),
  mimeType: varchar("mimeType", { length: 100 }),
  metadata: json("metadata").$type<Record<string, any>>(),
  uploadedBy: int("uploadedBy").notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  changeDescription: text("changeDescription"),
}, (table) => ({
  fileVersionIdx: unique("file_version_unique").on(table.fileId, table.version),
  fileIdx: index("file_idx").on(table.fileId),
}));

// ============================================================================
// CAMADAS BASE (DADOS OFICIAIS)
// ============================================================================

export const baseLayers = mysqlTable("base_layers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  source: mysqlEnum("source", ["funai", "incra", "icmbio", "osm", "aneel", "iphan", "custom"]).notNull(),
  layerType: mysqlEnum("layerType", ["terras_indigenas", "terras_quilombolas", "unidades_conservacao", "rodovias", "infraestrutura_eletrica", "sitios_arqueologicos", "other"]).notNull(),
  // Dados da camada (GeoJSON ou referência S3)
  dataFormat: mysqlEnum("dataFormat", ["geojson", "shapefile", "kml", "wfs"]).notNull(),
  dataUrl: text("dataUrl"), // URL do S3 ou WFS endpoint
  s3Key: varchar("s3Key", { length: 500 }),
  // Metadados
  featureCount: int("featureCount"),
  crs: varchar("crs", { length: 50 }).default("EPSG:4674").notNull(),
  bounds: json("bounds").$type<{
    north: number;
    south: number;
    east: number;
    west: number;
  }>(),
  // Cache e atualização
  lastDownloadAt: timestamp("lastDownloadAt"),
  lastUpdateAt: timestamp("lastUpdateAt"),
  cacheExpiresAt: timestamp("cacheExpiresAt"),
  downloadStatus: mysqlEnum("downloadStatus", ["pending", "downloading", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  refreshFailureCount: int("refreshFailureCount").default(0).notNull(),
  lastRefreshAttemptAt: timestamp("lastRefreshAttemptAt"),
  retryAfter: timestamp("retryAfter"),
  // Controle
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  sourceIdx: index("source_idx").on(table.source),
  layerTypeIdx: index("layer_type_idx").on(table.layerType),
  statusIdx: index("status_idx").on(table.downloadStatus),
}));

// ============================================================================
// CATÁLOGO OGC ADMINISTRADO (WMS/WFS)
// ============================================================================

export const ogcServices = mysqlTable("ogc_services", {
  id: int("id").autoincrement().primaryKey(),
  revision: int("revision").default(1).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  publisher: varchar("publisher", { length: 255 }).notNull(),
  serviceType: mysqlEnum("serviceType", ["wms", "wfs"]).notNull(),
  sourceClass: mysqlEnum("sourceClass", ["official", "approved_custom"]).default("official").notNull(),
  // URL integral preservada pelo contrato do catálogo; não deve ser truncada.
  endpoint: varchar("endpoint", { length: 1000 }).notNull(),
  // Unicidade indexável em utf8mb4, derivada do endpoint normalizado no servidor.
  endpointHash: varchar("endpointHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["draft", "validated", "published", "degraded", "unhealthy", "disabled"]).default("draft").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  health: mysqlEnum("health", ["healthy", "timeout", "tls_error", "http_error", "invalid_capabilities", "blocked"]).default("blocked").notNull(),
  lastValidatedAt: timestamp("lastValidatedAt"),
  lastHealthyAt: timestamp("lastHealthyAt"),
  lastError: varchar("lastError", { length: 500 }),
  capabilities: json("capabilities").$type<Record<string, any>>(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  endpointHashIdx: unique("ogc_endpoint_hash_unique").on(table.endpointHash),
  statusIdx: index("ogc_status_idx").on(table.status, table.enabled),
}));

export const ogcCatalogVariants = mysqlTable("ogc_catalog_variants", {
  id: int("id").autoincrement().primaryKey(),
  logicalLayer: varchar("logicalLayer", { length: 255 }).notNull(),
  serviceId: int("serviceId").notNull(),
  remoteLayer: varchar("remoteLayer", { length: 500 }).notNull(),
  role: mysqlEnum("role", ["primary", "fallback"]).notNull(),
  priority: int("priority").default(1).notNull(),
  displayCrs: varchar("displayCrs", { length: 50 }).default("EPSG:4674").notNull(),
  attribution: text("attribution"),
  enabled: boolean("enabled").default(false).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  layerPriorityIdx: unique("ogc_layer_priority_unique").on(table.logicalLayer, table.priority),
  serviceIdx: index("ogc_variant_service_idx").on(table.serviceId),
}));

// ============================================================================
// CAMADAS GEOESPACIAIS (POR PROJETO)
// ============================================================================

export const layers = mysqlTable("layers", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  fileId: int("fileId"), // pode ser null se camada foi criada manualmente
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  layerType: mysqlEnum("layerType", ["vector", "raster", "tile", "wms", "wmts"]).notNull(),
  // Dados da camada (pode ser GeoJSON para vetores ou URL para tiles)
  layerData: json("layerData"),
  // Configurações de estilo
  styleId: int("styleId"),
  defaultStyle: json("defaultStyle"),
  // CRS e bounds
  crs: varchar("crs", { length: 50 }).default("EPSG:4674").notNull(),
  bounds: json("bounds").$type<{
    north: number;
    south: number;
    east: number;
    west: number;
  }>(),
  // Controle de visibilidade
  isVisible: boolean("isVisible").default(true).notNull(),
  isPublic: boolean("isPublic").default(false).notNull(),
  // Hierarquia aditiva: camadas legadas continuam folhas na raiz.
  parentId: int("parentId"),
  isGroup: boolean("isGroup").default(false).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  // Metadados
  metadata: json("metadata").$type<Record<string, any>>(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  fileIdx: index("file_idx").on(table.fileId),
  layerTypeIdx: index("layer_type_idx").on(table.layerType),
  hierarchyIdx: index("layers_project_parent_sort_idx").on(table.projectId, table.parentId, table.sortOrder, table.id),
}));

export const styles = mysqlTable("styles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  styleType: mysqlEnum("styleType", ["sld", "mapbox", "cesium", "custom"]).notNull(),
  styleDefinition: json("styleDefinition").notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  nameIdx: index("name_idx").on(table.name),
}));

// ============================================================================
// MAPAS SALVOS
// ============================================================================

export const savedMaps = mysqlTable("saved_maps", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Configuração do mapa
  viewMode: mysqlEnum("viewMode", ["2d", "3d"]).default("3d").notNull(),
  center: json("center").$type<{ lat: number; lon: number; height?: number }>().notNull(),
  zoom: decimal("zoom", { precision: 10, scale: 6 }),
  heading: decimal("heading", { precision: 10, scale: 6 }),
  pitch: decimal("pitch", { precision: 10, scale: 6 }),
  // Camadas ativas
  activeLayers: json("activeLayers").$type<Array<{
    layerId: number;
    opacity: number;
    zIndex: number;
  }>>(),
  // Basemap
  basemap: varchar("basemap", { length: 100 }),
  // Thumbnail
  thumbnailUrl: text("thumbnailUrl"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  createdByIdx: index("created_by_idx").on(table.createdBy),
}));

// ============================================================================
// GERAÇÃO DE MAPAS TÉCNICOS
// ============================================================================

export const printJobs = mysqlTable("print_jobs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  savedMapId: int("savedMapId"),
  name: varchar("name", { length: 255 }).notNull(),
  // Configurações de impressão
  templateType: mysqlEnum("templateType", ["abnt_tecnico", "cliente"]).notNull(),
  pageSize: mysqlEnum("pageSize", ["A4", "A3", "A1", "A0"]).notNull(),
  orientation: mysqlEnum("orientation", ["portrait", "landscape"]).default("landscape").notNull(),
  scale: int("scale").notNull(), // ex: 1000 para 1:1000
  // CRS e fuso
  crs: varchar("crs", { length: 50 }).default("EPSG:31982").notNull(), // UTM SIRGAS 2000
  utmZone: int("utmZone"), // calculado automaticamente ou override manual
  // Elementos do mapa
  title: varchar("title", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 255 }),
  author: varchar("author", { length: 255 }),
  showNorthArrow: boolean("showNorthArrow").default(true).notNull(),
  showScaleBar: boolean("showScaleBar").default(true).notNull(),
  showLegend: boolean("showLegend").default(true).notNull(),
  showGrid: boolean("showGrid").default(true).notNull(),
  showFrame: boolean("showFrame").default(true).notNull(),
  // Camadas a incluir
  layersConfig: json("layersConfig").$type<Array<{
    layerId: number;
    opacity: number;
    includeInLegend: boolean;
  }>>(),
  // Status do job
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  progress: int("progress").default(0).notNull(),
  errorMessage: text("errorMessage"),
  // Resultado
  outputUrl: text("outputUrl"),
  outputS3Key: varchar("outputS3Key", { length: 500 }),
  // Controle
  requestedBy: int("requestedBy").notNull(),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  statusIdx: index("status_idx").on(table.status),
  requestedByIdx: index("requested_by_idx").on(table.requestedBy),
}));

// ============================================================================
// ATLAS AUTOMÁTICO
// ============================================================================

export const atlasTemplates = mysqlTable("atlas_templates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  templateType: mysqlEnum("templateType", ["abnt_tecnico", "cliente"]).notNull(),
  config: json("config").$type<Record<string, any>>().notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  projectNameIdx: unique("atlas_template_project_name_unique").on(table.projectId, table.name),
}));

export const atlasJobs = mysqlTable("atlas_jobs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  templateId: int("templateId"),
  // Configurações do atlas
  templateType: mysqlEnum("templateType", ["abnt_tecnico", "cliente"]).notNull(),
  pageSize: mysqlEnum("pageSize", ["A4", "A3", "A1", "A0"]).notNull(),
  orientation: mysqlEnum("orientation", ["portrait", "landscape"]).default("landscape").notNull(),
  scale: int("scale").notNull(),
  // Área de cobertura
  coverageArea: json("coverageArea").$type<{
    type: string;
    coordinates: number[][][] | number[][][][];
  }>().notNull(),
  // Grid calculado
  gridConfig: json("gridConfig").$type<{
    rows: number;
    cols: number;
    totalPages: number;
    cellWidth: number;
    cellHeight: number;
  }>(),
  // CRS
  crs: varchar("crs", { length: 50 }).default("EPSG:31982").notNull(),
  utmZone: int("utmZone"),
  // Camadas
  layersConfig: json("layersConfig").$type<Array<{
    layerId: number;
    opacity: number;
    includeInLegend: boolean;
  }>>(),
  renderConfig: json("renderConfig").$type<Record<string, any>>(),
  // Status do job
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  progress: int("progress").default(0).notNull(),
  currentPage: int("currentPage").default(0).notNull(),
  errorMessage: text("errorMessage"),
  // Resultado
  outputUrl: text("outputUrl"), // PDF multipágina
  outputS3Key: varchar("outputS3Key", { length: 500 }),
  individualPagesUrls: json("individualPagesUrls").$type<Array<{
    page: number;
    url: string;
    s3Key: string;
  }>>(),
  // Controle
  requestedBy: int("requestedBy").notNull(),
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  statusIdx: index("status_idx").on(table.status),
  requestedByIdx: index("requested_by_idx").on(table.requestedBy),
}));

// ============================================================================
// INVENTÁRIO E RETENÇÃO DE BACKUPS RECUPERÁVEIS
// ============================================================================

export const backupPolicies = mysqlTable("backup_policies", {
  id: int("id").primaryKey(), // singleton operacional: id=1
  enabled: boolean("enabled").default(false).notNull(),
  intervalHours: int("intervalHours").default(24).notNull(),
  retentionDays: int("retentionDays").default(30).notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const backupInventories = mysqlTable("backup_inventories", {
  id: int("id").autoincrement().primaryKey(),
  backupId: varchar("backupId", { length: 64 }).notNull().unique(),
  storageMode: mysqlEnum("storageMode", ["filesystem"]).notNull(),
  status: mysqlEnum("status", ["complete", "incomplete", "expired", "purged"]).default("complete").notNull(),
  manifestKey: varchar("manifestKey", { length: 1024 }).notNull(),
  manifestChecksumKey: varchar("manifestChecksumKey", { length: 1024 }).notNull(),
  manifestSha256: varchar("manifestSha256", { length: 64 }).notNull(),
  artifactSha256: varchar("artifactSha256", { length: 64 }).notNull(),
  archiveBytes: bigint("archiveBytes", { mode: "number" }).notNull(),
  objectBytes: bigint("objectBytes", { mode: "number" }).notNull(),
  totalRecords: int("totalRecords").notNull(),
  requiredObjects: int("requiredObjects").notNull(),
  copiedObjects: int("copiedObjects").notNull(),
  missingObjects: int("missingObjects").notNull(),
  retentionDays: int("retentionDays").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  restoreVerifiedAt: timestamp("restoreVerifiedAt"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  expiryIdx: index("backup_inventory_expiry_idx").on(table.status, table.expiresAt),
  createdAtIdx: index("backup_inventory_created_idx").on(table.createdAt),
}));

// ============================================================================
// LOGS DE AUDITORIA
// ============================================================================

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userEmail: varchar("userEmail", { length: 320 }),
  userName: varchar("userName", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 100 }),
  entityId: int("entityId"),
  projectId: int("projectId"),
  // Detalhes da ação
  details: json("details").$type<Record<string, any>>(),
  // Informações da requisição
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  // Timestamp
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("user_idx").on(table.userId),
  actionIdx: index("action_idx").on(table.action),
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
  projectIdx: index("project_idx").on(table.projectId),
  timestampIdx: index("timestamp_idx").on(table.timestamp),
}));

// ============================================================================
// TIPOS EXPORTADOS
// ============================================================================

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;

export type File = typeof files.$inferSelect;
export type InsertFile = typeof files.$inferInsert;

export type FileVersion = typeof fileVersions.$inferSelect;
export type InsertFileVersion = typeof fileVersions.$inferInsert;

export type Layer = typeof layers.$inferSelect;
export type InsertLayer = typeof layers.$inferInsert;

export type Style = typeof styles.$inferSelect;
export type InsertStyle = typeof styles.$inferInsert;

export type OgcService = typeof ogcServices.$inferSelect;
export type InsertOgcService = typeof ogcServices.$inferInsert;
export type OgcCatalogVariant = typeof ogcCatalogVariants.$inferSelect;
export type InsertOgcCatalogVariant = typeof ogcCatalogVariants.$inferInsert;

export type SavedMap = typeof savedMaps.$inferSelect;
export type InsertSavedMap = typeof savedMaps.$inferInsert;

export type PrintJob = typeof printJobs.$inferSelect;
export type InsertPrintJob = typeof printJobs.$inferInsert;

export type AtlasTemplate = typeof atlasTemplates.$inferSelect;
export type InsertAtlasTemplate = typeof atlasTemplates.$inferInsert;

export type AtlasJob = typeof atlasJobs.$inferSelect;
export type InsertAtlasJob = typeof atlasJobs.$inferInsert;

export type BackupPolicy = typeof backupPolicies.$inferSelect;
export type InsertBackupPolicy = typeof backupPolicies.$inferInsert;
export type BackupInventory = typeof backupInventories.$inferSelect;
export type InsertBackupInventory = typeof backupInventories.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

export const geometries = mysqlTable("geometries", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["marker", "polyline", "polygon"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  coordinates: text("coordinates").notNull(), // JSON string
  color: varchar("color", { length: 7 }).default("#3b82f6"),
  visible: int("visible").default(1).notNull(),
  opacity: int("opacity").default(100).notNull(), // 0-100
  layerId: int("layerId"), // null = geometria solta, continua visível pela própria flag
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectLayerIdx: index("geometries_project_layer_idx").on(table.projectId, table.layerId),
  layerIdx: index("geometries_layer_idx").on(table.layerId),
}));

export type Geometry = typeof geometries.$inferSelect;
export type InsertGeometry = typeof geometries.$inferInsert;


// ============================================================================
// UPLOADS DE ARQUIVOS GIS
// ============================================================================

export const gisUploads = mysqlTable("gis_uploads", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  filename: varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileType: mysqlEnum("fileType", ["shp", "kml", "kmz", "geojson", "gpx", "gml", "dxf"]).notNull(),
  fileSize: int("fileSize").notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  s3Key: varchar("s3Key", { length: 500 }).notNull(),
  s3Url: varchar("s3Url", { length: 1000 }).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  validationResult: json("validationResult"),
  metadata: json("metadata"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  projectIdIdx: index("project_id_idx").on(table.projectId),
  statusIdx: index("status_idx").on(table.status),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type GisUpload = typeof gisUploads.$inferSelect;
export type InsertGisUpload = typeof gisUploads.$inferInsert;

// ============================================================================
// NOTIFICAÇÕES
// ============================================================================

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["info", "success", "warning", "error"]).default("info").notNull(),
  category: mysqlEnum("category", ["invite", "upload", "project", "system", "security"]).default("system").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  link: varchar("link", { length: 500 }),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  readIdx: index("read_idx").on(table.read),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// Seleção pessoal; sempre revalidada contra projetos/membros no momento da leitura.
export const userProjectSelection = mysqlTable("user_project_selection", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userProjectUnique: unique("user_project_sel_unique").on(table.userId, table.projectId),
  projectIdx: index("user_project_sel_project_idx").on(table.projectId),
}));

export const userLayerVisibility = mysqlTable("user_layer_visibility", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  layerId: int("layerId").notNull(),
  visible: boolean("visible").notNull(),
}, (table) => ({
  userLayerUnique: unique("user_layer_vis_unique").on(table.userId, table.layerId),
  layerIdx: index("user_layer_vis_layer_idx").on(table.layerId),
}));

export const userBaseLayerVisibility = mysqlTable("user_base_layer_visibility", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  baseLayerId: int("baseLayerId").notNull(),
  visible: boolean("visible").notNull(),
}, (table) => ({
  userBaseLayerUnique: unique("user_base_layer_vis_unique").on(table.userId, table.baseLayerId),
  baseLayerIdx: index("user_base_layer_vis_base_idx").on(table.baseLayerId),
}));

// Campos e defaults exatos da PR8; apenas índices adicionais para histórico/fila.
export const atenaRuns = mysqlTable("atena_runs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]).default("queued").notNull(),
  requestText: text("requestText"),
  plan: json("plan").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 64 }).notNull(),
  codeVersion: varchar("codeVersion", { length: 40 }).notNull(),
  skillVersions: json("skillVersions"),
  inputs: json("inputs"),
  outputs: json("outputs"),
  steps: json("steps"),
  alerts: json("alerts"),
  errorMessage: text("errorMessage"),
  artifactKey: varchar("artifactKey", { length: 500 }),
  artifactCreatedAt: timestamp("artifactCreatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({
  projectKeyIdx: index("atena_runs_project_key_idx").on(table.projectId, table.idempotencyKey),
  projectHistoryIdx: index("atena_runs_project_created_idx").on(table.projectId, table.createdAt, table.id),
  statusIdx: index("atena_runs_status_created_idx").on(table.status, table.createdAt),
  userIdx: index("atena_runs_user_idx").on(table.userId),
}));

export type AtenaRun = typeof atenaRuns.$inferSelect;
export type InsertAtenaRun = typeof atenaRuns.$inferInsert;

// ============================================================================
// OBSERVAÇÕES — canal interno de feedback (reclamações, bugs, melhorias)
// ============================================================================

export const observacoes = mysqlTable("observacoes", {
  id: int("id").autoincrement().primaryKey(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao").notNull(),
  categoria: mysqlEnum("categoria", ["reclamacao", "melhoria", "bug", "caracteristica"]).notNull(),
  // Área do sistema a que se refere (ex.: "Pipeline", "Propostas", "Mapa").
  area: varchar("area", { length: 120 }),
  // Prints anexados como data-URI base64 (self-contained; sem storage externo).
  imagens: json("imagens").$type<Array<{ url: string; name: string }>>(),
  status: mysqlEnum("status", ["aberta", "em_analise", "resolvida"]).default("aberta").notNull(),
  criadoPorId: int("criadoPorId"),
  criadoPorNome: varchar("criadoPorNome", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("observacoes_status_idx").on(table.status),
  autorIdx: index("observacoes_autor_idx").on(table.criadoPorId),
  createdIdx: index("observacoes_created_idx").on(table.createdAt),
}));

export type Observacao = typeof observacoes.$inferSelect;
export type InsertObservacao = typeof observacoes.$inferInsert;

// ============================================================================
// ATENA — assistente operacional conversacional (chat, memórias, ações)
// ============================================================================

// Diretrizes reutilizáveis ensinadas pelo usuário; injetadas no system prompt.
export const atenaMemories = mysqlTable("atena_memories", {
  id: int("id").autoincrement().primaryKey(),
  categoria: mysqlEnum("categoria", ["custo", "processo", "preferencia", "comercial", "tecnico", "prazo", "modelo_escopo", "geral"]).default("geral").notNull(),
  diretriz: text("diretriz").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoPorId: int("criadoPorId"),
  criadoPorNome: varchar("criadoPorNome", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ativoIdx: index("atena_memories_ativo_idx").on(table.ativo),
}));

export type AtenaMemory = typeof atenaMemories.$inferSelect;
export type InsertAtenaMemory = typeof atenaMemories.$inferInsert;

// Histórico de conversa. projectId nulo = chat geral; preenchido = chat do projeto.
export const atenaChatMessages = mysqlTable("atena_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId"),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  autorId: int("autorId"),
  autorNome: varchar("autorNome", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  scopeIdx: index("atena_chat_scope_idx").on(table.projectId, table.createdAt),
}));

export type AtenaChatMessage = typeof atenaChatMessages.$inferSelect;
export type InsertAtenaChatMessage = typeof atenaChatMessages.$inferInsert;
