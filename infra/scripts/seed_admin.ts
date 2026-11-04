import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../server/db";
import { hashPassword } from "../../server/_core/password";
import { users } from "../../drizzle/schema";

/**
 * Cria (ou redefine a senha de) um usuário administrador para login próprio.
 *
 * Uso na VPS (as variáveis NÃO ficam no .env; passe só nesta execução):
 *   ADMIN_EMAIL="voce@exemplo.com" ADMIN_PASSWORD='senhaForte' \
 *   ADMIN_NAME="Seu Nome" pnpm exec tsx infra/scripts/seed_admin.ts
 *
 * É idempotente: se o e-mail já existir, apenas atualiza a senha e garante o
 * papel de administrador. Requer DATABASE_URL configurado.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = (process.env.ADMIN_NAME || "Administrador").trim();

  if (!email || !password) {
    console.error(
      "[seed_admin] Defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente desta execução."
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("[seed_admin] ADMIN_PASSWORD deve ter ao menos 8 caracteres.");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.error("[seed_admin] Banco indisponível. Confira DATABASE_URL.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({ passwordHash, role: "admin", loginMethod: "password" })
      .where(eq(users.id, existing[0].id));
    console.log(`[seed_admin] Senha redefinida e papel admin garantido para ${email}.`);
  } else {
    await db.insert(users).values({
      openId: `local:${nanoid()}`,
      name,
      email,
      passwordHash,
      role: "admin",
      loginMethod: "password",
      lastSignedIn: new Date(),
    });
    console.log(`[seed_admin] Administrador criado: ${email}.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("[seed_admin] Erro:", err);
  process.exit(1);
});
