/** Exact historical registry for verification of pre-Atena v2.0 artifacts. */
export const legacyBackupTableRegistry = [
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

export const backupTableRegistry = [
  ...legacyBackupTableRegistry,
  { name: "user_project_selection", primaryKey: "id" },
  { name: "user_layer_visibility", primaryKey: "id" },
  { name: "user_base_layer_visibility", primaryKey: "id" },
  { name: "atena_runs", primaryKey: "id" },
] as const;

export type BackupTableName = (typeof backupTableRegistry)[number]["name"];

/** Only versioned physical names; never interpolate a client-provided table name. */
export function isBackupTableName(value: string): value is BackupTableName {
  return backupTableRegistry.some((entry) => entry.name === value);
}
