import { getDb } from "./db";
import { notifications } from "../drizzle/schema";

type NotificationType = "info" | "success" | "warning" | "error";
type NotificationCategory = "invite" | "upload" | "project" | "system" | "security";

interface CreateNotificationParams {
  userId: number;
  type?: NotificationType;
  category?: NotificationCategory;
  title: string;
  message: string;
  link?: string;
}

/**
 * Helper function to create notifications from anywhere in the backend
 * Used for automatic notifications on events
 */
export async function createNotification(params: CreateNotificationParams): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    await db.insert(notifications).values({
      userId: params.userId,
      type: params.type || "info",
      category: params.category || "system",
      title: params.title,
      message: params.message,
      link: params.link,
      read: false,
    });

    return true;
  } catch (error) {
    console.error("Failed to create notification:", error);
    return false;
  }
}

/**
 * Notify user about a new invitation received
 */
export async function notifyInviteReceived(userId: number, inviterName: string): Promise<boolean> {
  return createNotification({
    userId,
    type: "info",
    category: "invite",
    title: "Novo Convite Recebido",
    message: `${inviterName} convidou você para participar de um projeto.`,
    link: "/invitations",
  });
}

/**
 * Notify user about successful file upload
 */
export async function notifyUploadComplete(
  userId: number, 
  fileName: string, 
  projectId: number
): Promise<boolean> {
  return createNotification({
    userId,
    type: "success",
    category: "upload",
    title: "Upload Concluído",
    message: `O arquivo "${fileName}" foi enviado com sucesso.`,
    link: `/projects/${projectId}`,
  });
}

/**
 * Notify user about upload error
 */
export async function notifyUploadError(
  userId: number, 
  fileName: string, 
  errorMessage: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "error",
    category: "upload",
    title: "Erro no Upload",
    message: `Falha ao enviar "${fileName}": ${errorMessage}`,
  });
}

/**
 * Notify user about being added to a project
 */
export async function notifyAddedToProject(
  userId: number, 
  projectName: string, 
  projectId: number
): Promise<boolean> {
  return createNotification({
    userId,
    type: "success",
    category: "project",
    title: "Adicionado ao Projeto",
    message: `Você foi adicionado ao projeto "${projectName}".`,
    link: `/projects/${projectId}`,
  });
}

/**
 * Notify user about being removed from a project
 */
export async function notifyRemovedFromProject(
  userId: number, 
  projectName: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "warning",
    category: "project",
    title: "Removido do Projeto",
    message: `Você foi removido do projeto "${projectName}".`,
  });
}

/**
 * Notify user about project update
 */
export async function notifyProjectUpdate(
  userId: number, 
  projectName: string, 
  projectId: number,
  updateType: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "info",
    category: "project",
    title: "Projeto Atualizado",
    message: `O projeto "${projectName}" foi atualizado: ${updateType}.`,
    link: `/projects/${projectId}`,
  });
}

/**
 * Notify admin about security event
 */
export async function notifySecurityEvent(
  userId: number, 
  eventType: string, 
  details: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "warning",
    category: "security",
    title: `Alerta de Segurança: ${eventType}`,
    message: details,
  });
}

/**
 * Notify user about print job completion
 */
export async function notifyPrintJobComplete(
  userId: number, 
  mapTitle: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "success",
    category: "system",
    title: "Mapa Gerado",
    message: `O mapa "${mapTitle}" foi gerado com sucesso e está pronto para download.`,
    link: "/technical-maps",
  });
}

/**
 * Notify user about atlas job completion
 */
export async function notifyAtlasJobComplete(
  userId: number, 
  atlasName: string,
  pageCount: number
): Promise<boolean> {
  return createNotification({
    userId,
    type: "success",
    category: "system",
    title: "Atlas Gerado",
    message: `O atlas "${atlasName}" com ${pageCount} páginas foi gerado com sucesso.`,
    link: "/atlas",
  });
}

/**
 * Notify user about backup completion (admin only)
 */
export async function notifyBackupComplete(
  userId: number, 
  backupSize: string
): Promise<boolean> {
  return createNotification({
    userId,
    type: "success",
    category: "system",
    title: "Backup Concluído",
    message: `Backup do sistema concluído com sucesso. Tamanho: ${backupSize}.`,
    link: "/admin/backups",
  });
}
