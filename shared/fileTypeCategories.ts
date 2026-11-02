import type { File } from "../drizzle/schema";

export type FileType = File["fileType"];
export type FileCategory = "geospatial" | "document" | "image" | "other";

// Categorias do rótulo persistido: não inferir MIME, extensão ou isGeospatial.
export const FILE_TYPE_CATEGORIES = {
  geospatial: ["kml", "kmz", "shp", "geojson", "geotiff"],
  document: ["pdf", "docx", "xlsx"],
  image: ["image"],
  other: ["other"],
} as const satisfies Record<FileCategory, readonly FileType[]>;

// Categorias desconhecidas não adicionam tipos ao filtro; "all" é tratado pelo chamador.
export function getFileTypesForCategory(category: string): readonly FileType[] {
  if (!Object.prototype.hasOwnProperty.call(FILE_TYPE_CATEGORIES, category)) {
    return [];
  }
  return FILE_TYPE_CATEGORIES[category as FileCategory];
}

// Preservar o fallback visual "Outro" para rótulos desconhecidos sem normalizar registros.
export function getFileCategory(fileType: string): FileCategory {
  for (const category of Object.keys(FILE_TYPE_CATEGORIES) as FileCategory[]) {
    if (getFileTypesForCategory(category).some(type => type === fileType)) {
      return category;
    }
  }
  return "other";
}
