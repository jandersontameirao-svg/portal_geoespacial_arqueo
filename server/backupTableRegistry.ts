export const backupTableRegistry = [
  { name: "users", primaryKey: "id" },
  { name: "invitations", primaryKey: "id" },
  { name: "projects", primaryKey: "id" },
  { name: "project_members", primaryKey: "id" },
  { name: "styles", primaryKey: "id" },
  { name: "files", primaryKey: "id" },
  { name: "file_versions", primaryKey: "id" },
  { name: "base_layers", primaryKey: "id" },
  { name: "ogc_services", primaryKey: "id" },
  { name: "ogc_catalog_variants", primaryKey: "id" },
  { name: "layers", primaryKey: "id" },
  { name: "geometries", primaryKey: "id" },
  { name: "saved_maps", primaryKey: "id" },
  { name: "print_jobs", primaryKey: "id" },
  { name: "atlas_templates", primaryKey: "id" },
  { name: "atlas_jobs", primaryKey: "id" },
  { name: "backup_policies", primaryKey: "id" },
  { name: "backup_inventories", primaryKey: "id" },
  { name: "gis_uploads", primaryKey: "id" },
  { name: "notifications", primaryKey: "id" },
  { name: "audit_logs", primaryKey: "id" },
] as const;

export type BackupTableName = (typeof backupTableRegistry)[number]["name"];

/**
 * Retorna apenas nomes físicos versionados neste módulo. Nunca aceite nome de tabela
 * do cliente ou concatene entrada externa em SQL de backup.
 */
export function isBackupTableName(value: string): value is BackupTableName {
  return backupTableRegistry.some((entry) => entry.name === value);
}
