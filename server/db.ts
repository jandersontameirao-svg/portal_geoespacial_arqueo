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
  auditLogs,
  InsertAuditLog,
  geometries,
  InsertGeometry
} from "../drizzle/schema";
import { ENV } from './_core/env';

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

  await db.insert(layers).values(layer);
}

export async function getLayersByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(layers).where(eq(layers.projectId, projectId))
    .orderBy(desc(layers.createdAt));
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
