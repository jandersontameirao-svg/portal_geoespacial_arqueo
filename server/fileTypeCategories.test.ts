import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FILE_TYPE_CATEGORIES,
  getFileCategory,
  getFileTypesForCategory,
  type FileCategory,
  type FileType,
} from "../shared/fileTypeCategories";

// Oito rótulos antigos + GeoJSON: expectativas independentes da implementação.
const previousCategories = {
  kml: "geospatial",
  kmz: "geospatial",
  shp: "geospatial",
  pdf: "document",
  docx: "document",
  xlsx: "document",
  image: "image",
  other: "other",
  geojson: "geospatial",
} as const satisfies Record<Exclude<FileType, "geotiff">, FileCategory>;

const previousMap = {
  geospatial: ["kml", "kmz", "shp", "geojson"],
  document: ["pdf", "docx", "xlsx"],
  image: ["image"],
  other: ["other"],
};

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const pageSource = source("../client/src/pages/Files.tsx");

// Guardas estáticas dos JSX anteriores: não importam React, router, DB ou storage.
const previousPresentation = {
  geospatial: {
    icon: '<MapIcon className="w-5 h-5 text-green-500" />',
    badge: '<Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Geoespacial</Badge>',
  },
  document: {
    icon: '<FileText className="w-5 h-5 text-blue-500" />',
    badge: '<Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Documento</Badge>',
  },
  image: {
    icon: '<ImageIcon className="w-5 h-5 text-purple-500" />',
    badge: '<Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Imagem</Badge>',
  },
  other: {
    icon: '<File className="w-5 h-5 text-slate-500" />',
    badge: '<Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">Outro</Badge>',
  },
};

function expectPresentation(category: FileCategory) {
  const branch = category === "other" ? "default:" : `case "${category}":`;
  const { icon, badge } = previousPresentation[category];
  const iconBody = pageSource.split("const getFileIcon =")[1]?.split("const getCategoryBadge =")[0];
  const badgeBody = pageSource.split("const getCategoryBadge =")[1]?.split("const formatFileSize =")[0];
  expect(iconBody).toContain("switch (getFileCategory(fileType))");
  expect(badgeBody).toContain("switch (getFileCategory(fileType))");
  expect(iconBody).toContain(`${branch}\n        return ${icon};`);
  expect(badgeBody).toContain(`${branch}\n        return ${badge};`);
}

describe("taxonomia compartilhada de files.fileType (F1)", () => {
  it.each(Object.entries(previousCategories))(
    "preserva categoria, associação de filtro e apresentação de %s",
    (fileType, category) => {
      expect(getFileCategory(fileType)).toBe(category);
      const memberships = Object.keys(FILE_TYPE_CATEGORIES).filter(key =>
        getFileTypesForCategory(key).some(type => type === fileType)
      );
      expect(memberships).toEqual([category]);
      expectPresentation(category);
    }
  );

  it("adiciona somente GeoTIFF ao mapa anterior, na categoria geoespacial", () => {
    expect(FILE_TYPE_CATEGORIES).toEqual({
      ...previousMap,
      geospatial: [...previousMap.geospatial, "geotiff"],
    });
    for (const category of Object.keys(previousMap) as FileCategory[]) {
      expect(getFileTypesForCategory(category).filter(type => type !== "geotiff"))
        .toEqual(previousMap[category]);
    }
    expect(getFileCategory("geotiff")).toBe("geospatial");
    expect(getFileTypesForCategory("image")).not.toContain("geotiff");
    expect(getFileTypesForCategory("other")).not.toContain("geotiff");
    expectPresentation("geospatial");
  });

  it("cobre exatamente os dez rótulos atuais, sem duplicação", () => {
    const types = Object.values(FILE_TYPE_CATEGORIES).flat();
    expect(types).toHaveLength(10);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...Object.keys(previousCategories), "geotiff"].sort());
  });

  it("não reclassifica image por MIME, nome ou isGeospatial", () => {
    const oldTiff = { fileType: "image", mimeType: "image/tiff", name: "antigo.tif", isGeospatial: true };
    expect(getFileCategory(oldTiff.fileType)).toBe("image");
    expect(getFileTypesForCategory("geospatial")).not.toContain(oldTiff.fileType);
    expect(getFileTypesForCategory("image")).toEqual(["image"]);
  });

  it.each(["", "unknown", "all", "toString", "__proto__"])(
    "categoria não enumerada %j não acrescenta tipos ao filtro",
    category => {
      expect(getFileTypesForCategory(category)).toEqual([]);
    }
  );

  it.each(["", "unknown", "GEOTIFF", "image/tiff", "toString"])(
    "mantém fallback visual Outro para rótulo não enumerado %j, sem incluí-lo no filtro Outros",
    fileType => {
      expect(getFileCategory(fileType)).toBe("other");
      expect(getFileTypesForCategory("other")).toEqual(["other"]);
      expect(getFileTypesForCategory("other").some(type => type === fileType)).toBe(false);
    }
  );
});

describe("integração estática dos consumidores F1, sem executá-los", () => {
  it("o filtro SQL global e o filtro por projeto consultam o mesmo helper", () => {
    const globalSource = source("./db.ts");
    const projectSource = source("./filesRouter.ts");
    expect(globalSource).toContain('import { getFileTypesForCategory } from "../shared/fileTypeCategories";');
    expect(globalSource).toContain("const types = getFileTypesForCategory(category);");
    expect(projectSource).toContain('import { getFileTypesForCategory } from "../shared/fileTypeCategories";');
    expect(projectSource).toContain("const types = getFileTypesForCategory(input.category);");
    expect(projectSource).toContain("files = files.filter(f => types.includes(f.fileType));");
    expect(globalSource).not.toContain("const categoryMap:");
    expect(projectSource).not.toContain("const categoryMap:");
  });

  it("o global usa a taxonomia para ícone/badge e explicita GeoTIFF no filtro", () => {
    expect(pageSource).toContain('import { getFileCategory } from "@shared/fileTypeCategories";');
    expect(pageSource).toContain('<SelectItem value="geospatial">Geoespacial (KML, SHP, GeoJSON, GeoTIFF)</SelectItem>');
    expect(pageSource).toContain('<SelectItem value="all">Todas as categorias</SelectItem>');
  });
});
