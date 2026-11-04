import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { filesRouter } from "./filesRouter";
import { geometriesRouter } from "./geometriesRouter";
import { adminRouter } from "./adminRouter";
import { mfaRouter } from "./mfaRouter";
import { searchRouter } from "./searchRouter";
import { savedMapsRouter } from "./savedMapsRouter";
import { printJobsRouter } from "./printJobsRouter";
import { backupRouter } from "./backupRouter";
import { atlasRouter } from "./atlasRouter";
import { notificationsRouter } from "./notificationsRouter";
import { infrastructureRouter } from "./infrastructureRouter";
import { baseLayersRouter } from "./baseLayersRouter";
import { gisUploadsRouter } from "./gisUploadsRouter";
import { gisDiagnosticsRouter } from "./gisDiagnosticsRouter";
import { gisAnalysisRouter } from "./gisAnalysisRouter";
import { ogcCatalogRouter } from "./ogcCatalogRouter";
import { institutionalCatalogRouter } from "./institutionalCatalogRouter";
import { indeCatalogRouter } from "./indeCatalogRouter";
import { aneelSigaRouter } from "./aneelSigaRouter";
import { rasterRouter } from "./rasterRouter";
import { layersRouter } from "./layersRouter";
import { projectSelectionRouter } from "./projectSelectionRouter";
import { atenaRouter } from "./atenaRouter";
import { prospectRouter } from "./prospectRouter";
import { influenceRouter } from "./influenceRouter";
import { officialRouter } from "./officialRouter";
import { observacoesRouter } from "./observacoesRouter";
import { atenaChatRouter } from "./atenaChatRouter";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "./_core/password";
import * as OTPLib from "otplib";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import * as db from "./db";
import { createAuditLog } from "./db";
import { requireProjectAccess, requireProjectEditor } from "./projectAccess";

// ============================================================================
// HELPER: Remover campos sensíveis do usuário antes de enviar ao cliente
// ============================================================================

// Nunca devolver hash de senha nem segredo de MFA pela API. Mantém os demais
// campos (inclui mfaEnabled, que a UI usa) intactos.
function toSafeUser<
  T extends { passwordHash?: unknown; mfaSecret?: unknown }
>(user: T): Omit<T, "passwordHash" | "mfaSecret"> {
  const { passwordHash: _passwordHash, mfaSecret: _mfaSecret, ...safe } = user;
  return safe;
}

// ============================================================================
// HELPER: Admin Procedure
// ============================================================================

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ 
      code: "FORBIDDEN", 
      message: "Acesso restrito a administradores" 
    });
  }
  return next({ ctx });
});

// ============================================================================
// HELPER: Editor ou Admin Procedure
// ============================================================================

const editorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "editor") {
    throw new TRPCError({ 
      code: "FORBIDDEN", 
      message: "Acesso restrito a editores e administradores" 
    });
  }
  return next({ ctx });
});

// ============================================================================
// HELPER: Audit Log
// ============================================================================

async function logAudit(
  userId: number | undefined,
  userEmail: string | undefined,
  userName: string | undefined,
  action: string,
  entityType?: string,
  entityId?: number,
  projectId?: number,
  details?: Record<string, any>,
  req?: any
) {
  await createAuditLog({
    userId: userId || null,
    userEmail: userEmail || null,
    userName: userName || null,
    action,
    entityType: entityType || null,
    entityId: entityId || null,
    projectId: projectId || null,
    details: details || null,
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
    userAgent: req?.headers?.['user-agent'] || null,
  });
}

// ============================================================================
// AUTH ROUTER
// ============================================================================

const authRouter = router({
  me: publicProcedure.query(opts =>
    opts.ctx.user ? toSafeUser(opts.ctx.user) : null
  ),

  // Login próprio e-mail+senha. Emite a mesma sessão JWT (cookie webdev_app_session)
  // usada no resto do app, então nenhuma outra rota precisa mudar.
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
        // Código TOTP de 6 dígitos, exigido somente quando o usuário tem MFA ativo.
        totp: z.string().length(6).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const user = await db.getUserByEmail(email);

      // Resposta uniforme para e-mail inexistente ou senha errada (evita enumeração).
      const invalid = () =>
        new TRPCError({ code: "UNAUTHORIZED", message: "E-mail ou senha inválidos" });

      if (!user || !user.passwordHash) {
        // Gasta o mesmo tempo de um scrypt real para não revelar, pelo tempo de
        // resposta, se o e-mail existe (complementa a mensagem uniforme).
        await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
        throw invalid();
      }

      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) {
        throw invalid();
      }

      // Segundo fator, quando ativo para a conta.
      if (user.mfaEnabled) {
        if (!input.totp) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "MFA_REQUIRED",
          });
        }
        const totpOk =
          !!user.mfaSecret &&
          OTPLib.verify({ token: input.totp, secret: user.mfaSecret });
        if (!totpOk) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Código MFA inválido" });
        }
      }

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

      await logAudit(
        user.id,
        user.email || undefined,
        user.name || undefined,
        "auth.login",
        undefined,
        undefined,
        undefined,
        { method: "password" },
        ctx.req
      );

      return {
        success: true as const,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    
    if (ctx.user) {
      logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "auth.logout",
        undefined,
        undefined,
        undefined,
        undefined,
        ctx.req
      );
    }
    
    return { success: true } as const;
  }),
});

// ============================================================================
// INVITATIONS ROUTER
// ============================================================================

const invitationsRouter = router({
  // Criar convite (apenas admin)
  create: adminProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(["admin", "editor", "client"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = nanoid(32);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expira em 7 dias

      await db.createInvitation({
        email: input.email,
        role: input.role,
        token,
        invitedBy: ctx.user.id,
        expiresAt,
      });

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "invitation.create",
        "invitation",
        undefined,
        undefined,
        { email: input.email, role: input.role },
        ctx.req
      );

      // TODO: Enviar e-mail com link de convite
      const inviteLink = `${process.env.VITE_OAUTH_PORTAL_URL || ''}/invite/${token}`;

      return {
        success: true,
        inviteLink,
        expiresAt,
      };
    }),

  // Listar convites criados pelo usuário
  list: adminProcedure.query(async ({ ctx }) => {
    return await db.getInvitationsByInviter(ctx.user.id);
  }),

  // Reenviar convite (apenas admin)
  resend: adminProcedure
    .input(z.object({
      invitationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await db.getInvitationById(input.invitationId);
      
      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Convite não encontrado" });
      }

      if (invitation.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Convite já foi aceito" });
      }

      // Gerar novo token e nova data de expiração
      const newToken = nanoid(32);
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      await db.updateInvitation(input.invitationId, {
        token: newToken,
        expiresAt: newExpiresAt,
      });

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "invitations.resend",
        "invitation",
        input.invitationId,
        undefined,
        { email: invitation.email },
        ctx.req
      );

      // TODO: Enviar email com novo link de convite
      // const inviteLink = `${process.env.FRONTEND_URL}/accept-invite?token=${newToken}`;
      // await sendEmail(invitation.email, "Convite Reenviado", inviteLink);

      return { success: true, token: newToken };
    }),

  // Cancelar convite (apenas admin)
  revoke: adminProcedure
    .input(z.object({
      invitationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await db.getInvitationById(input.invitationId);
      
      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Convite não encontrado" });
      }

      if (invitation.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Convite já foi aceito e não pode ser cancelado" });
      }

      // Marcar como expirado (definir expiresAt para o passado)
      await db.updateInvitation(input.invitationId, {
        expiresAt: new Date(0), // 1970-01-01
      });

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "invitations.revoke",
        "invitation",
        input.invitationId,
        undefined,
        { email: invitation.email },
        ctx.req
      );

      return { success: true };
    }),

  // Validar token de convite (público)
  validate: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const invitation = await db.getInvitationByToken(input.token);
      
      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Convite inválido ou expirado",
        });
      }

      return {
        email: invitation.email,
        role: invitation.role,
      };
    }),
});

// ============================================================================
// PROJECTS ROUTER
// ============================================================================

const projectsRouter = router({
  // Criar projeto (admin ou editor)
  create: editorProcedure
    .input(z.object({
      name: z.string().min(1),
      code: z.string().min(1),
      description: z.string().optional(),
      clientName: z.string().optional(),
      clientDocument: z.string().optional(),
      aoiGeometry: z.any().optional(),
      aoiBounds: z.object({
        north: z.number(),
        south: z.number(),
        east: z.number(),
        west: z.number(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verificar se código já existe
      const existing = await db.getProjectByCode(input.code);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Código de projeto já existe",
        });
      }

      await db.createProject({
        ...input,
        createdBy: ctx.user.id,
        status: "active",
      });

      // Buscar o projeto criado
      const project = await db.getProjectByCode(input.code);
      if (!project) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao criar projeto",
        });
      }

      // Adicionar criador como owner
      await db.addProjectMember({
        projectId: project.id,
        userId: ctx.user.id,
        role: "owner",
        addedBy: ctx.user.id,
      });

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "project.create",
        "project",
        project.id,
        project.id,
        { name: input.name, code: input.code },
        ctx.req
      );

      return { success: true, project };
    }),

  // Listar projetos do usuário
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role === "admin") {
      // Admin vê todos os projetos
      return await db.getAllProjects();
    } else {
      // Outros usuários veem apenas seus projetos
      return await db.getProjectsByUser(ctx.user.id);
    }
  }),

  // Obter detalhes de um projeto
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.id);
      
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Projeto não encontrado",
        });
      }

      // Verificar permissão
      if (ctx.user.role !== "admin") {
        const isMember = await db.isUserProjectMember(input.id, ctx.user.id);
        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem acesso a este projeto",
          });
        }
      }

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "project.view",
        "project",
        project.id,
        project.id,
        undefined,
        ctx.req
      );

      return project;
    }),

  // Atualizar projeto
  update: editorProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      clientName: z.string().optional(),
      clientDocument: z.string().optional(),
      aoiGeometry: z.any().optional(),
      aoiBounds: z.object({
        north: z.number(),
        south: z.number(),
        east: z.number(),
        west: z.number(),
      }).optional(),
      status: z.enum(["active", "archived", "completed"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      const project = await db.getProjectById(id);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Projeto não encontrado",
        });
      }

      // Verificar permissão
      if (ctx.user.role !== "admin") {
        const isMember = await db.isUserProjectMember(id, ctx.user.id);
        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem acesso a este projeto",
          });
        }
      }

      await db.updateProject(id, updateData);

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "project.update",
        "project",
        id,
        id,
        updateData,
        ctx.req
      );

      return { success: true };
    }),

  // Adicionar membro ao projeto
  addMember: editorProcedure
    .input(z.object({
      projectId: z.number(),
      userId: z.number(),
      role: z.enum(["owner", "editor", "viewer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Projeto não encontrado",
        });
      }
      await requireProjectEditor(input.projectId, ctx.user);

      await db.addProjectMember({
        projectId: input.projectId,
        userId: input.userId,
        role: input.role,
        addedBy: ctx.user.id,
      });

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "project.add_member",
        "project_member",
        undefined,
        input.projectId,
        { userId: input.userId, role: input.role },
        ctx.req
      );

      return { success: true };
    }),

  // Listar membros do projeto
  members: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verificar permissão
      if (ctx.user.role !== "admin") {
        const isMember = await db.isUserProjectMember(input.projectId, ctx.user.id);
        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem acesso a este projeto",
          });
        }
      }

      return await db.getProjectMembers(input.projectId);
    }),

  // Remover membro do projeto
  removeMember: editorProcedure
    .input(z.object({
      projectId: z.number(),
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectEditor(input.projectId, ctx.user);
      await db.removeProjectMember(input.projectId, input.userId);

      await logAudit(
        ctx.user.id,
        ctx.user.email || undefined,
        ctx.user.name || undefined,
        "project.remove_member",
        "project_member",
        undefined,
        input.projectId,
        { userId: input.userId },
        ctx.req
      );

      return { success: true };
    }),

  // Listar membros do projeto
  listMembers: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      return await db.getProjectMembers(input.projectId);
    }),

  // Obter atividades do projeto (logs de auditoria)
  getActivities: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(input.projectId, ctx.user);
      return await db.getProjectAuditLogs(input.projectId);
    }),
});

// ============================================================================
// AUDIT ROUTER
// ============================================================================

const auditRouter = router({
  // Logs recentes (admin apenas)
  recent: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      return await db.getRecentAuditLogs(input.limit);
    }),

  // Logs por projeto
  byProject: protectedProcedure
    .input(z.object({ 
      projectId: z.number(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      // Verificar permissão
      if (ctx.user.role !== "admin") {
        const isMember = await db.isUserProjectMember(input.projectId, ctx.user.id);
        if (!isMember) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem acesso a este projeto",
          });
        }
      }

      return await db.getAuditLogsByProject(input.projectId, input.limit);
    }),

  // Logs por usuário (admin ou próprio usuário)
  byUser: protectedProcedure
    .input(z.object({ 
      userId: z.number(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      // Verificar permissão
      if (ctx.user.role !== "admin" && ctx.user.id !== input.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Você não tem acesso a estes logs",
        });
      }

      return await db.getAuditLogsByUser(input.userId, input.limit);
    }),
});

// ============================================================================
// USERS ROUTER
// ============================================================================

const usersRouter = router({
  // Listar usuários disponíveis (admin e editor apenas)
  list: editorProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const search = input?.search;
      const users = (await db.getAllUsers()).map(toSafeUser);

      if (search) {
        const query = search.toLowerCase();
        return users.filter(
          (u) =>
            u.name?.toLowerCase().includes(query) ||
            u.email?.toLowerCase().includes(query)
        );
      }

      return users;
    }),
});

// ============================================================================
// APP ROUTER
// ============================================================================

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  invitations: invitationsRouter,
  projects: projectsRouter,
  audit: auditRouter,
  users: usersRouter,
  files: filesRouter,
  geometries: geometriesRouter,
  admin: adminRouter,
  mfa: mfaRouter,
  search: searchRouter,
  savedMaps: savedMapsRouter,
  printJobs: printJobsRouter,
  backup: backupRouter,
  atlas: atlasRouter,
  notifications: notificationsRouter,
  infrastructure: infrastructureRouter,
  baseLayers: baseLayersRouter,
  gisUploads: gisUploadsRouter,
  gisDiagnostics: gisDiagnosticsRouter,
  gisAnalysis: gisAnalysisRouter,
  ogcCatalog: ogcCatalogRouter,
  institutionalCatalog: institutionalCatalogRouter,
  indeCatalog: indeCatalogRouter,
  aneelSiga: aneelSigaRouter,
  raster: rasterRouter,
  layers: layersRouter,
  projectSelection: projectSelectionRouter,
  atena: atenaRouter,
  prospect: prospectRouter,
  influence: influenceRouter,
  official: officialRouter,
  observacoes: observacoesRouter,
  atenaChat: atenaChatRouter,
});

export type AppRouter = typeof appRouter;
