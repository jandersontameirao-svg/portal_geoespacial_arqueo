import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, 
  users, 
  invitations, 
  InsertInvitation,
  projects,
  InsertProject,
  projectMembers,
  InsertProjectMember,
  files,
  InsertFile,
  fileVersions,
  InsertFileVersion,
  layers,
  InsertLayer,
  savedMaps,
  InsertSavedMap,
  printJobs,
  InsertPrintJob,
  atlasJobs,
  InsertAtlasJob,
  backupPolicies,
  InsertBackupPolicy,
  backupInventories,
  InsertBackupInventory,
  auditLogs,
  InsertAuditLog,
  geometries,
  InsertGeometry,
  gisUploads,
  InsertGisUpload
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { getFileTypesForCategory } from "../shared/fileTypeCategories";
import { buildInitialFileVersion } from "./fileVersioning";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============================================================================
// USUÁRIOS E AUTENTICAÇÃO
// ============================================================================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(users).orderBy(users.name);
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by email: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function setUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserMFA(userId: number, mfaEnabled: boolean, mfaSecret?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(users)
    .set({ mfaEnabled, mfaSecret: mfaSecret || null })
    .where(eq(users.id, userId));
}

// ============================================================================
// CONVITES
// ============================================================================

export async function createInvitation(invitation: InsertInvitation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(invitations).values(invitation);
}

export async function getInvitationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(invitations).where(eq(invitations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateInvitation(id: number, data: { token?: string; expiresAt?: Date }) {
  const db = await getDb();
  if (!db) return;

  await db.update(invitations).set(data).where(eq(invitations.id, id));
}

export async function getInvitationByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(invitations)
    .where(and(
      eq(invitations.token, token),
      sql`${invitations.usedAt} IS NULL`,
      sql`${invitations.expiresAt} > NOW()`
    ))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function markInvitationAsUsed(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(invitations)
    .set({ usedAt: new Date() })
    .where(eq(invitations.id, id));
}

export async function getInvitationsByInviter(invitedBy: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(invitations)
    .where(eq(invitations.invitedBy, invitedBy))
    .orderBy(desc(invitations.createdAt));
}

// ============================================================================
// PROJETOS
// ============================================================================

export async function createProject(project: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(projects).values(project);
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProjectByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getProjectsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  // Retorna projetos onde o usuário é membro
  const result = await db.select({
    project: projects,
    member: projectMembers
  })
  .from(projects)
  .innerJoin(projectMembers, eq(projects.id, projectMembers.projectId))
  .where(eq(projectMembers.userId, userId))
  .orderBy(desc(projects.updatedAt));

  return result.map(r => ({ ...r.project, memberRole: r.member.role }));
}

export async function getAllProjects() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function updateProject(id: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(projects).set(data).where(eq(projects.id, id));
}

// ============================================================================
// MEMBROS DE PROJETOS
// ============================================================================

export async function addProjectMember(member: InsertProjectMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(projectMembers).values(member);
}

export async function getProjectMembers(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select({
    member: projectMembers,
    user: users
  })
  .from(projectMembers)
  .innerJoin(users, eq(projectMembers.userId, users.id))
  .where(eq(projectMembers.projectId, projectId));

  return result.map(r => ({ ...r.member, user: r.user }));
}

export async function removeProjectMember(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId)
    ));
}

export async function isUserProjectMember(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return false;

  const result = await db.select().from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId)
    ))
    .limit(1);

  return result.length > 0;
}

// ============================================================================
// ARQUIVOS
// ============================================================================

export async function createFile(file: InsertFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(files).values(file);
}

export async function createFileAndGetId(file: InsertFile): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(files).values(file).$returningId();
  return result.id;
}

/**
 * Raster v1 refers to the scanned original, not the derived COG. File and version
 * must commit together before a layer/worker is started. The external storage
 * write happens earlier and is NOT part of this SQL transaction.
 */
export async function createRasterFileWithInitialVersion(file: InsertFile, sha256: string) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async (tx) => {
    const [inserted] = await tx.insert(files).values({ ...file, currentVersion: 1 }).$returningId();
    if (!inserted?.id) throw new Error("Arquivo GeoTIFF não foi registrado");
    const [created] = await tx.select().from(files).where(eq(files.id, inserted.id)).limit(1);
    if (!created) throw new Error("Arquivo GeoTIFF não foi registrado");
    const [version] = await tx.insert(fileVersions).values(buildInitialFileVersion({
      fileId: created.id,
      s3Key: created.s3Key,
      s3Url: created.s3Url,
      fileSize: created.fileSize,
      mimeType: created.mimeType,
      sha256,
      uploadedBy: created.uploadedBy,
      originalName: created.originalName,
      fileType: created.fileType,
      source: "raster-ingestion",
    })).$returningId();
    if (!version?.id) throw new Error("Versão inicial do GeoTIFF não foi registrada");
    return { file: created, versionId: version.id };
  });
}

export async function createFileVersion(version: InsertFileVersion): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(fileVersions).values(version).$returningId();
  return result.id;
}

export async function getFileVersions(fileId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version));
}

export async function getFileById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(files)
    .where(and(eq(files.id, id), sql`${files.deletedAt} IS NULL`))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getFilesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(files)
    .where(and(
      eq(files.projectId, projectId),
      sql`${files.deletedAt} IS NULL`
    ))
    .orderBy(desc(files.uploadedAt));
}

export async function getAllFilesForUser(
  userId: number, 
  userRole: string, 
  options: { category?: string; search?: string; limit?: number; offset?: number }
) {
  const db = await getDb();
  if (!db) return [];

  const { category, search, limit = 50, offset = 0 } = options;

  // Base query
  let conditions = [sql`${files.deletedAt} IS NULL`];

  // Filtro por categoria
  if (category) {
    const types = getFileTypesForCategory(category);
    if (types.length > 0) {
      conditions.push(sql`${files.fileType} IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`);
    }
  }

  // Filtro por busca
  if (search && search.trim()) {
    conditions.push(sql`${files.name} LIKE ${`%${search}%`}`);
  }

  // Se não for admin, filtrar apenas projetos que o usuário participa
  if (userRole !== "admin") {
    const userProjects = await db.select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId));
    
    const projectIds = userProjects.map(p => p.projectId);
    if (projectIds.length === 0) return [];
    
    conditions.push(sql`${files.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`);
  }

  const result = await db.select({
    id: files.id,
    name: files.name,
    fileType: files.fileType,
    mimeType: files.mimeType,
    size: files.fileSize,
    url: files.s3Url,
    projectId: files.projectId,
    uploadedAt: files.uploadedAt,
    uploadedBy: files.uploadedBy,
    projectName: projects.name,
  })
    .from(files)
    .leftJoin(projects, eq(files.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(files.uploadedAt))
    .limit(limit)
    .offset(offset);

  return result;
}

export async function softDeleteFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(files)
    .set({ deletedAt: new Date() })
    .where(eq(files.id, id));
}

// ============================================================================
// CAMADAS
// ============================================================================
export async function createLayer(layer: InsertLayer) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(layers).values(layer).$returningId();
  return result.id;
}
export async function getLayersByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(layers).where(eq(layers.projectId, projectId))
    .orderBy(desc(layers.createdAt));
}

export async function getLayerById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(layers).where(eq(layers.id, id)).limit(1);
  return result[0];
}
export async function updateLayer(id: number, data: Partial<InsertLayer>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(layers).set(data).where(eq(layers.id, id));
}
export async function deleteLayer(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(layers).where(eq(layers.id, id));
}
export async function updateFile(id: number, data: Partial<InsertFile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(files).set(data).where(eq(files.id, id));
}

export async function deleteFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id));
}

// ============================================================================
// MAPAS SALVOS
// ============================================================================

export async function createSavedMap(map: InsertSavedMap) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(savedMaps).values(map);
}

export async function getSavedMapsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(savedMaps)
    .where(eq(savedMaps.projectId, projectId))
    .orderBy(desc(savedMaps.createdAt));
}

// ============================================================================
// JOBS DE IMPRESSÃO
// ============================================================================

export async function createPrintJob(job: InsertPrintJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(printJobs).values(job);
}

export async function getPrintJobsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(printJobs)
    .where(eq(printJobs.projectId, projectId))
    .orderBy(desc(printJobs.requestedAt));
}

export async function updatePrintJobStatus(
  id: number, 
  status: "pending" | "processing" | "completed" | "failed",
  progress?: number,
  outputUrl?: string,
  outputS3Key?: string,
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = { status };
  if (progress !== undefined) updateData.progress = progress;
  if (outputUrl) updateData.outputUrl = outputUrl;
  if (outputS3Key) updateData.outputS3Key = outputS3Key;
  if (errorMessage) updateData.errorMessage = errorMessage;
  if (status === "completed") updateData.completedAt = new Date();

  await db.update(printJobs).set(updateData).where(eq(printJobs.id, id));
}

// ============================================================================
// JOBS DE ATLAS
// ============================================================================

export async function createAtlasJob(job: InsertAtlasJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(atlasJobs).values(job);
}

export async function getAtlasJobsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(atlasJobs)
    .where(eq(atlasJobs.projectId, projectId))
    .orderBy(desc(atlasJobs.requestedAt));
}

export async function updateAtlasJobStatus(
  id: number,
  status: "pending" | "processing" | "completed" | "failed",
  progress?: number,
  currentPage?: number,
  outputUrl?: string,
  outputS3Key?: string,
  individualPagesUrls?: Array<{ page: number; url: string; s3Key: string }>,
  errorMessage?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = { status };
  if (progress !== undefined) updateData.progress = progress;
  if (currentPage !== undefined) updateData.currentPage = currentPage;
  if (outputUrl) updateData.outputUrl = outputUrl;
  if (outputS3Key) updateData.outputS3Key = outputS3Key;
  if (individualPagesUrls) updateData.individualPagesUrls = individualPagesUrls;
  if (errorMessage) updateData.errorMessage = errorMessage;
  if (status === "completed") updateData.completedAt = new Date();

  await db.update(atlasJobs).set(updateData).where(eq(atlasJobs.id, id));
}

// ============================================================================
// INVENTÁRIO DE BACKUPS RECUPERÁVEIS
// ============================================================================

export async function getBackupPolicy() {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(backupPolicies).where(eq(backupPolicies.id, 1)).limit(1);
  return rows[0];
}

export async function upsertBackupPolicy(policy: Omit<InsertBackupPolicy, "id">) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(backupPolicies).values({ id: 1, ...policy }).onDuplicateKeyUpdate({ set: { ...policy, updatedAt: new Date() } });
}

export async function createBackupInventory(inventory: InsertBackupInventory): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(backupInventories).values(inventory).$returningId();
  return result.id;
}

export async function listBackupInventories(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backupInventories).orderBy(desc(backupInventories.createdAt)).limit(limit);
}

export async function listExpiredBackupInventories(now = new Date()) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backupInventories).where(and(eq(backupInventories.status, "complete"), sql`${backupInventories.expiresAt} <= ${now}`));
}

export async function updateBackupInventoryStatus(id: number, status: "complete" | "incomplete" | "expired" | "purged", restoreVerifiedAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(backupInventories).set({ status, ...(restoreVerifiedAt ? { restoreVerifiedAt } : {}) }).where(eq(backupInventories.id, id));
}

// ============================================================================
// LOGS DE AUDITORIA
// ============================================================================

export async function createAuditLog(log: InsertAuditLog) {
  const db = await getDb();
  if (!db) {
    console.warn("[Audit] Cannot create log: database not available");
    return;
  }

  try {
    await db.insert(auditLogs).values(log);
  } catch (error) {
    console.error("[Audit] Failed to create log:", error);
  }
}

export async function getAuditLogsByProject(projectId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(auditLogs)
    .where(eq(auditLogs.projectId, projectId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);
}

export async function getAuditLogsByUser(userId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);
}

export async function getRecentAuditLogs(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(limit);
}

export async function getProjectAuditLogs(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(auditLogs)
    .where(eq(auditLogs.projectId, projectId))
    .orderBy(desc(auditLogs.timestamp));
}


// ==================== Geometries ====================

export async function createGeometry(geometry: InsertGeometry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(geometries).values(geometry);
}

export async function getGeometriesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(geometries).where(eq(geometries.projectId, projectId));
  return result;
}

export async function deleteGeometry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(geometries).where(eq(geometries.id, id));
}

export async function updateGeometryVisibility(id: number, visible: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(geometries).set({ visible }).where(eq(geometries.id, id));
}

export async function updateGeometryOpacity(id: number, opacity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(geometries).set({ opacity }).where(eq(geometries.id, id));
}

export async function updateGeometry(
  id: number,
  data: Partial<Pick<InsertGeometry, "type" | "name" | "description" | "coordinates" | "color">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(geometries).set(data).where(eq(geometries.id, id));
}

export async function getGeometryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(geometries).where(eq(geometries.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================================
// MÉTRICAS ADMINISTRATIVAS
// ============================================================================

export async function getAdminMetrics() {
  const db = await getDb();
  if (!db) return null;

  try {
    // Total de projetos (sem deleted_at)
    const projectsResult = await db.select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(sql`deleted_at IS NULL`);
    const totalProjects = Number(projectsResult[0]?.count || 0);

    // Total de usuários ativos
    const usersResult = await db.select({ count: sql<number>`count(*)` })
      .from(users);
    const totalUsers = Number(usersResult[0]?.count || 0);

    // Total de arquivos (sem deleted_at)
    const filesResult = await db.select({ count: sql<number>`count(*)` })
      .from(files)
      .where(sql`deleted_at IS NULL`);
    const totalFiles = Number(filesResult[0]?.count || 0);

    // Total de geometrias (sem deleted_at)
    const geometriesResult = await db.select({ count: sql<number>`count(*)` })
      .from(geometries)
      .where(sql`deleted_at IS NULL`);
    const totalGeometries = Number(geometriesResult[0]?.count || 0);

    // Tamanho total de arquivos (sem deleted_at)
    const storageSizeResult = await db.select({ total: sql<number>`COALESCE(SUM(file_size), 0)` })
      .from(files)
      .where(sql`deleted_at IS NULL`);
    const totalStorageBytes = Number(storageSizeResult[0]?.total || 0);

    return {
      totalProjects,
      totalUsers,
      totalFiles,
      totalGeometries,
      totalStorageBytes,
      totalStorageMB: Math.round(totalStorageBytes / (1024 * 1024) * 100) / 100,
    };
  } catch (error) {
    console.error("[Database] Error getting admin metrics:", error);
    return null;
  }
}

export async function getActivityStats(days: number = 30) {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        action
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at), action
      ORDER BY date DESC
    `);

    return result[0] || [];
  } catch (error) {
    console.error("[Database] Error getting activity stats:", error);
    return [];
  }
}

export async function getFilteredAuditLogs(limit: number = 50, offset: number = 0, filters?: {
  action?: string;
  entityType?: string;
  userId?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  try {
    // Construir condições de filtro
    const conditions = [];
    if (filters?.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }
    if (filters?.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }

    // Construir e executar query
    const queryBuilder = db.select().from(auditLogs);
    
    const results = conditions.length > 0
      ? await queryBuilder
          .where(and(...conditions))
          .orderBy(desc(auditLogs.timestamp))
          .limit(limit)
          .offset(offset)
      : await queryBuilder
          .orderBy(desc(auditLogs.timestamp))
          .limit(limit)
          .offset(offset);

    return results;
  } catch (error) {
    console.error("[Database] Error getting filtered audit logs:", error);
    return [];
  }
}

export async function countFilteredAuditLogs(filters?: {
  action?: string;
  entityType?: string;
  userId?: number;
}) {
  const db = await getDb();
  if (!db) return 0;

  try {
    const conditions = [];
    if (filters?.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }
    if (filters?.entityType) {
      conditions.push(eq(auditLogs.entityType, filters.entityType));
    }
    if (filters?.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }

    const queryBuilder = db.select({ count: sql<number>`count(*)` }).from(auditLogs);
    
    const result = conditions.length > 0
      ? await queryBuilder.where(and(...conditions))
      : await queryBuilder;
    
    return Number(result[0]?.count || 0);
  } catch (error) {
    console.error("[Database] Error counting filtered audit logs:", error);
    return 0;
  }
}


// ============================================================================
// ESTATÍSTICAS E MÉTRICAS
// ============================================================================

/**
 * Conta total de projetos
 */
export async function countProjects(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` }).from(projects);
  return result[0]?.count || 0;
}

/**
 * Conta total de usuários
 */
export async function countUsers(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` }).from(users);
  return result[0]?.count || 0;
}

/**
 * Conta total de arquivos
 */
export async function countFiles(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` }).from(files);
  return result[0]?.count || 0;
}

/**
 * Conta total de camadas
 */
export async function countLayers(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` }).from(layers);
  return result[0]?.count || 0;
}

/**
 * Conta total de mapas salvos
 */
export async function countSavedMaps(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`COUNT(*)` }).from(savedMaps);
  return result[0]?.count || 0;
}


// ============================================================================
// GIS UPLOADS
// ============================================================================

export async function listGisUploads(
  userId: number,
  options: {
    projectId?: number;
    status?: "pending" | "processing" | "completed" | "failed";
    limit?: number;
    offset?: number;
  }
) {
  const dbConn = await getDb();
  if (!dbConn) return [];

  const query = await dbConn
    .select()
    .from(gisUploads)
    .where(eq(gisUploads.userId, userId))
    .orderBy(desc(gisUploads.createdAt))
    .limit(options.limit || 50)
    .offset(options.offset || 0);

  return query;
}

export async function getGisUpload(id: number, userId: number) {
  const dbConn = await getDb();
  if (!dbConn) return null;

  const [upload] = await dbConn
    .select()
    .from(gisUploads)
    .where(eq(gisUploads.id, id))
    .limit(1);

  if (!upload || upload.userId !== userId) {
    return null;
  }

  return upload;
}

export async function createGisUpload(data: {
  userId: number;
  projectId?: number;
  filename: string;
  originalName: string;
  fileType: "shp" | "kml" | "kmz" | "geojson" | "gpx" | "gml" | "dxf";
  fileSize: number;
  mimeType: string;
  s3Key: string;
  s3Url: string;
  status: "pending" | "processing" | "completed" | "failed";
}) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("Database connection not available");

  const [result] = await dbConn.insert(gisUploads).values(data).$returningId();
  return result.id;
}

export async function updateGisUploadStatus(
  id: number,
  status: "pending" | "processing" | "completed" | "failed",
  s3Url?: string,
  errorMessage?: string
) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("Database connection not available");

  const updateData: any = {
    status,
    updatedAt: new Date(),
  };

  if (s3Url) {
    updateData.s3Url = s3Url;
  }

  if (errorMessage) {
    updateData.errorMessage = errorMessage;
  }

  await dbConn.update(gisUploads).set(updateData).where(eq(gisUploads.id, id));
}

export async function completeGisUpload(
  id: number,
  status: "completed" | "failed",
  validationResult: any,
  errorMessage?: string
) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("Database connection not available");

  await dbConn
    .update(gisUploads)
    .set({
      status,
      validationResult,
      metadata: validationResult.metadata,
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(gisUploads.id, id));
}

export async function deleteGisUpload(id: number) {
  const dbConn = await getDb();
  if (!dbConn) throw new Error("Database connection not available");

  await dbConn.delete(gisUploads).where(eq(gisUploads.id, id));
}
