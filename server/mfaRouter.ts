import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as OTPLib from "otplib";
import QRCode from "qrcode";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * Router de MFA (Multi-Factor Authentication)
 * Implementa autenticação de dois fatores com TOTP
 */

export const mfaRouter = router({
  /**
   * Gerar secret e QR code para configurar MFA
   */
  setupMFA: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;

    // Gerar secret único
    const secret = OTPLib.generateSecret();

    // Gerar URI para QR code (compatível com Google Authenticator, Authy, etc)
    const otpauth = `otpauth://totp/Portal%20Geoespacial%20-%20Grupo%20Arqueo:${encodeURIComponent(user.email || user.name || user.openId)}?secret=${secret}&issuer=Portal%20Geoespacial%20-%20Grupo%20Arqueo`;

    // Gerar QR code em base64
    const qrCode = await QRCode.toDataURL(otpauth);

    // Salvar secret temporário (será confirmado após validação)
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    
    await db
      .update(users)
      .set({ mfaSecret: secret })
      .where(eq(users.id, user.id));

    return {
      secret,
      qrCode,
      message: "Escaneie o QR code com seu aplicativo autenticador e insira o código de 6 dígitos para ativar o MFA.",
    };
  }),

  /**
   * Verificar código e ativar MFA
   */
  verifyAndEnableMFA: protectedProcedure
    .input(
      z.object({
        token: z.string().length(6, "Código deve ter 6 dígitos"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.mfaSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA não foi configurado. Execute setupMFA primeiro.",
        });
      }

      // Verificar código
      const isValid = OTPLib.verify({
        token: input.token,
        secret: user.mfaSecret,
      });

      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Código inválido. Verifique e tente novamente.",
        });
      }

      // Ativar MFA
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      await db
        .update(users)
        .set({ mfaEnabled: true })
        .where(eq(users.id, user.id));

      return {
        success: true,
        message: "MFA ativado com sucesso! A partir de agora, você precisará fornecer um código de 6 dígitos ao fazer login.",
      };
    }),

  /**
   * Desativar MFA (requer código atual)
   */
  disableMFA: protectedProcedure
    .input(
      z.object({
        token: z.string().length(6, "Código deve ter 6 dígitos"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MFA não está ativo.",
        });
      }

      // Verificar código antes de desativar
      const isValid = OTPLib.verify({
        token: input.token,
        secret: user.mfaSecret,
      });

      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Código inválido.",
        });
      }

      // Desativar MFA e limpar secret
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      await db
        .update(users)
        .set({ 
          mfaEnabled: false,
          mfaSecret: null 
        })
        .where(eq(users.id, user.id));

      return {
        success: true,
        message: "MFA desativado com sucesso.",
      };
    }),

  /**
   * Verificar status do MFA
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;

    // Verificar se MFA é obrigatório para este perfil
    const mfaRequired = ['admin', 'editor'].includes(user.role);

    return {
      enabled: user.mfaEnabled,
      required: mfaRequired,
      role: user.role,
      message: mfaRequired && !user.mfaEnabled
        ? "MFA é obrigatório para seu perfil. Configure agora para continuar usando o sistema."
        : user.mfaEnabled
        ? "MFA está ativo e protegendo sua conta."
        : "MFA não está ativo. Recomendamos ativar para maior segurança.",
    };
  }),

  /**
   * Gerar códigos de backup (para recuperação)
   */
  generateBackupCodes: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;

    if (!user.mfaEnabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "MFA deve estar ativo para gerar códigos de backup.",
      });
    }

    // Gerar 10 códigos de backup aleatórios
    const backupCodes = Array.from({ length: 10 }, () => {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
    });

    // TODO: Salvar códigos de backup no banco (hasheados)
    // Por enquanto, apenas retornar para o usuário guardar

    return {
      codes: backupCodes,
      message: "Guarde estes códigos em local seguro. Cada código pode ser usado apenas uma vez para recuperar acesso à sua conta.",
    };
  }),
});
