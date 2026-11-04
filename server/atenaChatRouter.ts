/**
 * Atena operacional (chat conversacional). Escopo geral nesta versão
 * (projectId nulo); a coluna de projeto já existe para threads por projeto no
 * futuro. A IA PROPÕE; a execução de ações é um endpoint separado chamado só
 * após confirmação do usuário, com permissão e auditoria.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb, createAuditLog } from "./db";
import { atenaChatMessages, atenaMemories, observacoes } from "../drizzle/schema";
import { isLLMConfigured } from "./_core/llm";
import { askAtena, ATENA_MEMORY_CATEGORIES } from "./atena/assistant";

const OBS_CATEGORIAS = ["reclamacao", "melhoria", "bug", "caracteristica"] as const;

export const atenaChatRouter = router({
  status: protectedProcedure.query(() => ({ configured: isLLMConfigured() })),

  history: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(atenaChatMessages)
      .where(isNull(atenaChatMessages.projectId))
      .orderBy(asc(atenaChatMessages.createdAt))
      .limit(200);
  }),

  chat: protectedProcedure
    .input(z.object({ message: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      if (!isLLMConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Provedor de IA não configurado neste ambiente." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });

      // Histórico recente para dar continuidade à conversa.
      const recent = await db
        .select({ role: atenaChatMessages.role, content: atenaChatMessages.content })
        .from(atenaChatMessages)
        .where(isNull(atenaChatMessages.projectId))
        .orderBy(desc(atenaChatMessages.createdAt))
        .limit(10);
      const history = recent.reverse() as Array<{ role: "user" | "assistant"; content: string }>;

      await db.insert(atenaChatMessages).values({
        projectId: null,
        role: "user",
        content: input.message,
        autorId: ctx.user.id,
        autorNome: ctx.user.name || ctx.user.email || null,
      });

      let reply;
      try {
        reply = await askAtena({ message: input.message, history });
      } catch (error) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: error instanceof Error ? error.message : "Falha ao consultar a IA." });
      }

      const [assistantRow] = await db.insert(atenaChatMessages).values({
        projectId: null,
        role: "assistant",
        content: reply.resposta,
        autorId: null,
        autorNome: "Atena",
      });

      return { messageId: (assistantRow as any).insertId as number, ...reply };
    }),

  memories: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(atenaMemories)
        .where(eq(atenaMemories.ativo, true))
        .orderBy(desc(atenaMemories.createdAt));
    }),

    save: protectedProcedure
      .input(
        z.object({
          diretriz: z.string().trim().min(3).max(1000),
          categoria: z.enum(ATENA_MEMORY_CATEGORIES),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
        const [row] = await db.insert(atenaMemories).values({
          categoria: input.categoria,
          diretriz: input.diretriz,
          ativo: true,
          criadoPorId: ctx.user.id,
          criadoPorNome: ctx.user.name || ctx.user.email || null,
        });
        const id = (row as any).insertId as number;
        await createAuditLog({
          userId: ctx.user.id,
          userEmail: ctx.user.email || null,
          userName: ctx.user.name || null,
          action: "atena.memory.save",
          entityType: "atena_memory",
          entityId: id,
          details: { categoria: input.categoria },
        });
        return { id };
      }),

    deactivate: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
        await db.update(atenaMemories).set({ ativo: false }).where(eq(atenaMemories.id, input.id));
        await createAuditLog({
          userId: ctx.user.id,
          userEmail: ctx.user.email || null,
          userName: ctx.user.name || null,
          action: "atena.memory.deactivate",
          entityType: "atena_memory",
          entityId: input.id,
        });
        return { success: true };
      }),
  }),

  // Executa uma ação proposta pela IA, somente após confirmação do usuário.
  executeAction: protectedProcedure
    .input(
      z.object({
        tipo: z.literal("criar_observacao"),
        dados: z.object({
          titulo: z.string().trim().min(1).max(255),
          descricao: z.string().trim().min(1).max(10000),
          categoria: z.enum(OBS_CATEGORIAS).default("melhoria"),
          area: z.string().trim().max(120).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });

      const [row] = await db.insert(observacoes).values({
        titulo: input.dados.titulo,
        descricao: input.dados.descricao,
        categoria: input.dados.categoria,
        area: input.dados.area || null,
        status: "aberta",
        criadoPorId: ctx.user.id,
        criadoPorNome: ctx.user.name || ctx.user.email || null,
      });
      const id = (row as any).insertId as number;
      await createAuditLog({
        userId: ctx.user.id,
        userEmail: ctx.user.email || null,
        userName: ctx.user.name || null,
        action: "atena.action.criar_observacao",
        entityType: "observacao",
        entityId: id,
        details: { viaAtena: true, categoria: input.dados.categoria },
      });
      return { tipo: "criar_observacao" as const, observacaoId: id };
    }),
});
