import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json, index, unique } from "drizzle-orm/mysql-core";

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
    "kml", "kmz", "shp", "pdf", "docx", "xlsx", "image", "other"
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
  uploadedBy: int("uploadedBy").notNull(),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  changeDescription: text("changeDescription"),
}, (table) => ({
  fileVersionIdx: unique("file_version_unique").on(table.fileId, table.version),
  fileIdx: index("file_idx").on(table.fileId),
}));

// ============================================================================
// CAMADAS GEOESPACIAIS
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
  // Metadados
  metadata: json("metadata").$type<Record<string, any>>(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectIdx: index("project_idx").on(table.projectId),
  fileIdx: index("file_idx").on(table.fileId),
  layerTypeIdx: index("layer_type_idx").on(table.layerType),
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

export const atlasJobs = mysqlTable("atlas_jobs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
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

export type SavedMap = typeof savedMaps.$inferSelect;
export type InsertSavedMap = typeof savedMaps.$inferInsert;

export type PrintJob = typeof printJobs.$inferSelect;
export type InsertPrintJob = typeof printJobs.$inferInsert;

export type AtlasJob = typeof atlasJobs.$inferSelect;
export type InsertAtlasJob = typeof atlasJobs.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
