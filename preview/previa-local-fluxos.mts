import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ingestCog, renderCog } from "./previa-local-raster.mts";
import { exportVector } from "./previa-exportar-vetor.mts";
import { defaultLayout, readLayout, readScale } from "./previa-layout.mts";

const require = createRequire(new URL("../package.json", import.meta.url));
const { jsPDF } = require("jspdf");
const bufferGeometry = require("@turf/buffer").default;
const municipalAnchors = JSON.parse(readFileSync(new URL("./previa-raster/angicos/rotulos-ibge.json", import.meta.url), "utf8"));
const storePath = fileURLToPath(new URL("./previa-local-dados.json", import.meta.url));
const seed = { id: 1, name: "Levantamento arqueológico demonstrativo", code: "DEMO-01", description: "Projeto fictício para explorar o Geoportal.", clientName: "Cliente fictício", status: "active", createdAt: "2026-11-12T12:00:00Z" };
type Row = Record<string, any>;
type State = { projects: Row[]; files: Row[]; jobs: Row[]; templates: Row[]; products?: Record<string, Row[]>; recentProjects?: Record<string, number[]>; connections?: Row[]; nextId: number };
let state: State;
try {
  state = JSON.parse(readFileSync(storePath, "utf8"));
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
  state = { projects: [seed], files: [], jobs: [], templates: [], nextId: 2 };
}

const sample = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { nome: "Área fictícia" }, geometry: {
    type: "Polygon", coordinates: [[[-43.96,-19.94],[-43.94,-19.94],[-43.94,-19.92],[-43.96,-19.92],[-43.96,-19.94]]],
  } }],
};

function paths(geometry: any): number[][][] {
  switch (geometry?.type) {
    case "Point": return [[geometry.coordinates]];
    case "MultiPoint": return geometry.coordinates.map((point: number[]) => [point]);
    case "LineString": return [geometry.coordinates];
    case "MultiLineString":
    case "Polygon": return geometry.coordinates;
    case "MultiPolygon": return geometry.coordinates.flat();
    case "GeometryCollection": return geometry.geometries.flatMap(paths);
    default: return [];
  }
}

function parseVector(contents: Buffer, extension: string) {
  if (!["geojson", "json", "kml", "kmz", "zip"].includes(extension)) return null;
  let document;
  if (extension === "kml" || extension === "kmz") {
    const { DOMParser } = require("@xmldom/xmldom");
    const { kml } = require("@mapbox/togeojson");
    if (extension === "kmz") {
      const Zip = require("adm-zip");
      const entry = new Zip(contents).getEntries().find((item: any) => !item.isDirectory && /\.kml$/i.test(item.entryName) && item.header.size <= 8_000_000);
      if (!entry) throw Error("KMZ sem KML compatível.");
      contents = entry.getData();
    }
    document = kml(new DOMParser().parseFromString(contents.toString("utf8"), "text/xml"));
  } else if (extension === "zip") {
    const Zip = require("adm-zip");
    const entries = new Zip(contents).getEntries();
    if (entries.reduce((sum: number, entry: any) => sum + entry.header.size, 0) > 32_000_000) throw Error("Shapefile excede o limite descompactado da prévia.");
    document = (require("shpjs").default ?? require("shpjs"))(contents);
  } else {
    document = JSON.parse(contents.toString("utf8").replace(/^\uFEFF/, ""));
  }
  return Promise.resolve(document).then(value => {
    const features = (Array.isArray(value) ? value : [value]).flatMap(item =>
      item.type === "FeatureCollection" ? item.features : [item.type === "Feature" ? item : { type: "Feature", properties: {}, geometry: item }]
    );
    const vertices = features.flatMap(feature => paths(feature.geometry)).flat();
    if (!vertices.length || vertices.length > 100_000 || !vertices.every(point =>
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
    )) throw Error("Arquivo sem feições válidas em longitude/latitude ou acima do limite da prévia.");
    return { type: "FeatureCollection", features };
  });
}

function save(next: State) {
  writeFileSync(storePath + ".tmp", JSON.stringify(next));
  renameSync(storePath + ".tmp", storePath);
  state = next;
}

function append(collection: Exclude<keyof State, "nextId">, values: Row) {
  const row = { ...values, id: state.nextId, createdAt: new Date().toISOString() };
  save({ ...state, [collection]: [...state[collection], row], nextId: row.id + 1 });
  return row;
}

export function* projectSearchEntries() {
  for (const project of state.projects) {
    const href = "/projects/" + project.id;
    yield { key: "project-" + project.id, title: project.name, detail: project.code ?? "", category: "Projeto", href };
    for (const file of projectRows(state.files, { projectId: project.id })) {
      yield { key: "file-" + file.id, title: file.name, detail: project.name,
        category: file.isGeospatial ? "Camada" : "Arquivo", href: href + (file.isGeospatial ? "?tab=map" : "?tab=files") };
    }
  }
}

function projectRows(rows: Row[], input: Row) {
  return rows.filter(row => !input.projectId || row.projectId === input.projectId);
}

function saveAnalysis(projectId: number, name: string, vector: Row) {
  // Store the same GeoJSON as a visible vector and as the original download.
  // append() assigns an ID and atomically replaces the local preview store.
  const contents = Buffer.from(JSON.stringify(vector));
  const file = append("files", { projectId, name, fileType: "geojson", fileSize: contents.length,
    isGeospatial: true, currentVersion: 1, uploadedAt: new Date().toISOString(),
    s3Url: "/previa/download/arquivo/" + state.nextId, contents: contents.toString("base64"), vector });
  return { id: file.id, name, result: { output: vector } };
}

const iphanConnection = {
  id: -1, name: "IPHAN · Sítios arqueológicos (SICG)", type: "WMS",
  address: "https://geoserver.iphan.gov.br/geoserver/SICG/wms",
  layer: "SICG:sitios,SICG:sitios_pol", enabled: true, official: true,
};

const officialConnections = [
  iphanConnection,
  { id: -2, name: "IBGE · Estados, municípios e localidades", type: "GeoJSON", address: "https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html", layer: "ibge", enabled: true },
  { id: -3, name: "FUNAI/CMR · Terras indígenas", type: "WMS", address: "https://cmr.funai.gov.br/geoserver/ows", layer: "CMR-PUBLICO:lim_terra_indigena_a", enabled: false },
  { id: -4, name: "INCRA · Territórios quilombolas", type: "Consulta oficial", address: "https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/quilombolas", layer: "", enabled: false, status: "Serviço cartográfico indisponível na verificação." },
  { id: -5, name: "Palmares · Comunidades quilombolas certificadas", type: "Cadastro oficial", address: "https://www.gov.br/palmares/pt-br/departamentos/protecao-preservacao-e-articulacao/certificacao-quilombola", layer: "", enabled: false, status: "Cadastro tabular, sem geometria para exibir no mapa." },
  { id: -6, name: "ANEEL · Sistema de Informações de Geração (SIGA)", type: "Dados abertos", address: "https://dadosabertos.aneel.gov.br/dataset/siga-sistema-de-informacoes-de-geracao-da-aneel", layer: "", enabled: false, status: "SIGA disponível para consulta. Serviço cartográfico SIGEL indisponível na verificação." },
].map(connection => ({ ...connection, official: true }));

function listConnections() {
  const custom = state.connections ?? [];
  return [...officialConnections.map(connection => ({
    ...connection,
    enabled: Boolean(connection.layer) && (custom.find(item => item.id === connection.id)?.enabled ?? connection.enabled),
  })), ...custom.filter(item => !officialConnections.some(connection => connection.id === item.id))];
}

export async function workflow(method: string, input: Row = {}, write = false) {
  if (method === "previewConnections.list" && !write) return listConnections();
  if (method === "previewConnections.save" && write) {
    const { id, type } = input;
    const official = officialConnections.find(connection => connection.id === id);
    if (official) {
      // Only visibility is configurable for the published official sources.
      if (!official.layer) throw Error("Fonte disponível para consulta.");
      const connection = { ...official, enabled: Boolean(input.enabled) };
      save({ ...state, connections: [...(state.connections ?? []).filter(item => item.id !== id), connection] });
      return connection;
    }
    const name = String(input.name ?? "").trim(), address = String(input.address ?? "").trim();
    if (!name || name.length > 100 || !address || address.length > 500 ||
        !["WMS", "WFS", "ArcGIS REST", "GeoJSON", "PostGIS"].includes(type)) throw Error("Confira o nome, o tipo e o endereço da fonte.");
    // Registration is metadata only. Do not contact submitted endpoints or store credentials.
    if (type === "PostGIS") {
      if (!/^[a-z\d.-]+(?::\d{1,5})?\/[a-z\d_-]+$/i.test(address)) throw Error("Informe servidor[:porta]/banco, sem credenciais.");
    } else {
      let endpoint: URL;
      try { endpoint = new URL(address); } catch { throw Error("Informe um endereço HTTP ou HTTPS."); }
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash) throw Error("Use o endereço base, sem credenciais, parâmetros ou fragmento.");
    }
    const connections = state.connections ?? [];
    if (id != null && !connections.some(item => item.id === id)) throw Error("Fonte não encontrada.");
    const layer = type === "WMS" ? String(input.layer ?? "").trim() : "";
    if (layer && !/^[\w.:-]{1,150}$/.test(layer)) throw Error("Informe o identificador da camada WMS.");
    const enabled = Boolean(input.enabled);
    if (enabled && (type !== "WMS" || !layer)) throw Error("Para exibir no mapa, informe a camada de uma fonte WMS.");
    const connection = { id: id ?? state.nextId, name, type, address, layer, enabled, status: enabled ? "Ligada no mapa" : "Desligada" };
    save({ ...state, nextId: id == null ? state.nextId+1 : state.nextId,
      connections: [...connections.filter(item => item.id !== id), connection] });
    return connection;
  }
  if (method === "previewProducts.list" || method === "previewProducts.save") {
    if (input.projectId !== 11 || !state.projects.some(project => project.id === input.projectId)) throw Error("Projeto indisponível.");
    const defaults = [
      { id: "mapa", title: "Mapa de localização A2", columns: 1, rows: 1, overlap: 0, grid: 25000 },
      { id: "atlas", title: "Atlas A2", columns: 3, rows: 2, overlap: 10, grid: 10000 },
    ];
    const products = state.products?.[11] ?? defaults;
    const layers = state.files.filter(file => file.projectId === 11 && file.vector);
    if (!write && method === "previewProducts.list") return {
      products: products.map(product => ({ layout: defaultLayout, layerIds: layers.filter(file => file.isVisible !== false).map(file => file.id), ...product })),
      layers: layers.map(({ id, name }) => ({ id, name })),
    };
    if (!write || method !== "previewProducts.save") return undefined;
    const { id, title, columns, rows, overlap, grid } = input.product ?? {};
    if (!products.some(product => product.id === id) || typeof title !== "string" || !title.trim() || title.length > 85 ||
        ![columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 8) || columns*rows > 24 ||
        !Number.isFinite(overlap) || overlap < 0 || overlap > 30 ||
        !Number.isInteger(grid) || grid < 1000 || grid > 50000) throw Error("Confira o título e os parâmetros da grade.");
    const { layerIds } = input.product;
    if (!Array.isArray(layerIds) || !layerIds.length || !layerIds.every(layerId => layers.some(layer => layer.id === layerId))) throw Error("Selecione pelo menos uma camada do projeto.");
    const product = { id, title: title.trim(), columns, rows, overlap, grid,
      layerIds: [...new Set(layerIds)], layout: readLayout(input.product.layout), scale: readScale(input.product.scale) };
    save({ ...state, products: { ...state.products, 11: products.map(item => item.id === id ? product : item) } });
    return product;
  }
  if (!write) {
    switch (method) {
      case "projects.list": {
        const recent = state.recentProjects?.["1"] ?? [];
        const rank = (id: number) => recent.includes(id) ? recent.indexOf(id) : recent.length;
        return [...state.projects].sort((a, b) => rank(a.id) - rank(b.id));
      }
      case "projects.get": {
        const project = state.projects.find(project => project.id === input.id);
        // The local preview has one simulated user. Production should use the authenticated ID.
        const recent = state.recentProjects?.["1"] ?? [];
        if (project && recent[0] !== project.id) save({
          ...state, recentProjects: { ...state.recentProjects, "1": [project.id, ...recent.filter(id => id !== project.id)].slice(0, 100) },
        });
        return project ?? null;
      }
      case "layers.list": return projectRows(state.files, input).filter(file => file.vector).map(file => ({
        id: file.id, projectId: file.projectId, name: file.name, layerType: "vector",
        layerData: file.vector, isGroup: false, isVisible: file.isVisible ?? true, effectiveVisible: file.isVisible ?? true,
        defaultStyle: { color: ({ "AII.geojson": "#217a4b", "AID.geojson": "#da9800", "ADA.geojson": "#dc2638", "Eixo.geojson": "#58278d" } as Record<string, string>)[file.name] || "#2563eb" },
      }));
      case "files.list":
      case "files.listAll": return projectRows(state.files, input).map(({ contents, vector, ...file }) => ({
        ...file,
        exportFormats: vector ? ["shp", "kml", "geojson", ...(vector.features.every((feature: Row) => /^(Multi)?(Point|LineString)$/.test(feature.geometry.type)) ? ["gpx"] : [])] : [],
      }));
      case "gisAnalysis.list": return projectRows(state.files, input).filter(file => file.vector).map(file => ({
        id: file.id, name: file.name, projectId: file.projectId, layerType: "vector", layerData: file.vector, metadata: { kind: "vector", featureCount: file.vector.features.length },
        isVisible: file.isVisible ?? true,
        ...(file.projectId === 11 && file.name === "AII.geojson" ? {
          layerData: { ...file.vector, features: file.vector.features.map((feature: Row) => ({
            ...feature, properties: { ...feature.properties, rotulo_ibge: municipalAnchors[feature.properties.codigo_ibge] },
          })) },
        } : {}),
        defaultStyle: file.defaultStyle ?? {
          color: ({ "AII.geojson": "#217a4b", "AID.geojson": "#da9800", "ADA.geojson": "#dc2638", "Eixo.geojson": "#58278d" } as Record<string, string>)[file.name] || "#2563eb",
          fillOpacity: 0.18,
        },
      }));
      case "printJobs.list": return projectRows(state.jobs, input).filter(job => job.kind === "map");
      case "atlas.list": return projectRows(state.jobs, input).filter(job => job.kind === "atlas");
      case "atlas.templates.list": return projectRows(state.templates, input);
      case "raster.ingestionAvailability": return { available: true, mode: "local", reason: "GDAL local do QGIS." };
      case "raster.listForMap": return projectRows(state.files, input).filter(file => file.cog).map(file => ({
        id: file.id, name: file.name, bounds: file.cog.bounds, crs: "EPSG:4674", nodata: 0, isVisible: false,
        metadata: { rasterIngestion: { status: "completed", cogSha256: file.cog.sha256 } },
      }));
    }
    return undefined;
  }
  switch (method) {
    case "atena.previewPlan":
    case "atena.previewRun": {
      const text = String(input.text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const wantsShape = /\b(shapefile|shape file|shp)\b/.test(text) && /\bmalha\b/.test(text);
      const wantsA2 = /\ba2\b/.test(text) && /\b(mapa|prancha|pdf)\b/.test(text);
      // The chat resolves only known local operations. It passes project IDs and
      // validated parameters to the same exporters used by the map workspace.
      if (/\batlas\b/.test(text)) {
        if (input.projectId !== 11) throw Error("O atlas A2 está disponível na prévia da LT Angicos.");
        const size = text.match(/(\d+)\s*[x×]\s*(\d+)/);
        const columns = Number(size?.[1] ?? 3), rows = Number(size?.[2] ?? 2);
        const overlap = Number(text.match(/(\d+)\s*%/)?.[1] ?? 10);
        const interval = text.match(/grade(?: utm)?(?: de)?\s+(\d+)\s*(km|m)\b/);
        const grid = Number(interval?.[1] ?? 10) * (interval?.[2] === "m" ? 1 : 1000);
        if (columns < 1 || rows < 1 || columns > 8 || rows > 8 || columns*rows > 24 ||
            overlap > 30 || grid < 1000 || grid > 50000) throw Error("Use até 24 folhas, sobreposição de 0 a 30% e grade UTM entre 1 e 50 km.");
        const ids = state.files.filter(row => row.projectId === input.projectId && row.vector && row.isVisible !== false).map(row => row.id);
        if (!ids.length) throw Error("Ative ao menos uma camada do projeto.");
        return method === "atena.previewPlan" ? { summary: `Atlas A2: ${columns} colunas × ${rows} linhas, ${overlap}% de sobreposição, grade UTM de ${grid/1000} km.` } :
          { name: "Baixar atlas A2 em PDF", url: `/previa/prancha/11.pdf?camadas=${ids.join(",")}&atlas=${columns},${rows},${overlap},${grid}` };
      }
      if (wantsShape && wantsA2) throw Error("Peça um arquivo por vez.");
      if (wantsShape) {
        const grids = state.files.filter(row => row.projectId === input.projectId && /^Malha /.test(row.name) && row.vector);
        const distances = [...text.matchAll(/(\d+)\s*m\b/g)];
        const candidates = grids.filter(row => (!distances.length || row.name.includes(` ${distances[0][1]} m.`)) &&
          (!/\btriangular\b/.test(text) || row.name.includes("triangular")) &&
          (!/\bquadrada\b/.test(text) || row.name.includes("quadrada")));
        if (candidates.length !== 1) throw Error("Informe qual malha exportar. Use o formato e o espaçamento da camada.");
        const layer = candidates[0];
        return method === "atena.previewPlan" ? { summary: `Exportar ${layer.name} em Shapefile (.zip).` } :
          { name: "Baixar Shapefile da malha", url: `/previa/vetores/${input.projectId}/${layer.id}/shp` };
      }
      if (wantsA2) {
        if (input.projectId !== 11) throw Error("O modelo A2 de localização está disponível na prévia da LT Angicos.");
        const ids = state.files.filter(row => row.projectId === input.projectId && row.vector && row.isVisible !== false).map(row => row.id);
        if (!ids.length) throw Error("Ative ao menos uma camada do projeto.");
        return method === "atena.previewPlan" ? { summary: `Gerar o mapa de localização A2 com ${ids.length} camadas visíveis.` } :
          { name: "Baixar mapa A2 em PDF", url: `/previa/prancha/11.pdf?camadas=${ids.join(",")}` };
      }
      const operation = /\bbuffer\b/.test(text) ? "buffer" : /\bmalha\b/.test(text) ? "grid" : null;
      const distances = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|m(?:etros?)?)\b/g)];
      const layerKey = operation === "buffer" && /\beixo\b/.test(text) ? "Eixo" :
        operation === "grid" && /\bada\b/.test(text) ? "ADA" : null;
      if (!operation || !layerKey || distances.length !== 1 || (/\bbuffer\b/.test(text) && /\bmalha\b/.test(text))) {
        throw Error("Informe uma operação por vez, a camada e a distância. Exemplos: buffer de 120 m no eixo ou malha triangular de 250 m na ADA.");
      }
      const [, amount, unit] = distances[0];
      const metres = Number(amount.replace(",", ".")) * (unit === "km" ? 1000 : 1);
      if (metres < (operation === "grid" ? 10 : 1) || metres > 10000) throw Error("Distância fora do intervalo permitido.");
      const layer = state.files.find(row => row.projectId === input.projectId && row.name === layerKey + ".geojson" && row.vector);
      if (!layer) throw Error("Camada não encontrada neste projeto.");
      const pattern = /\btriangular\b/.test(text) ? "triangular" : "quadrada";
      if (input.operation !== undefined) throw Error("Use o pedido de texto para preparar a operação.");
      if (method === "atena.previewPlan") return { summary: operation === "buffer"
        ? `Criar buffer de ${metres} m em ${layer.name}.`
        : `Criar malha ${pattern} de ${metres} m dentro de ${layer.name}.` };
      return workflow("gisAnalysis.execute", { projectId: input.projectId, operation, inputs: layer.vector.features,
        bufferMeters: metres, grid: { spacingMeters: metres, pattern, originCode: "ATENA" } }, true);
    }
    case "gisAnalysis.execute": {
      if (!["grid", "buffer"].includes(input.operation)) return undefined;
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      if (input.operation === "buffer") {
        const metres = input.bufferMeters;
        if (!Number.isFinite(metres) || metres < 1 || metres > 100000 || !input.inputs?.length) throw Error("Informe feições e uma distância válida.");
        const output = bufferGeometry({ type: "FeatureCollection", features: input.inputs }, metres, { units: "meters" });
        if (!output?.features.length) throw Error("O buffer não produziu feições.");
        return saveAnalysis(input.projectId, `Buffer ${metres} m.geojson`, output);
      }
      const [area] = input.inputs ?? [];
      if (input.inputs?.length !== 1 || !["Polygon", "MultiPolygon"].includes(area?.geometry?.type)) throw Error("Selecione uma única feição poligonal.");
      const { spacingMeters: step, rotationDegrees = 0, pattern = "quadrada", originCode = "MALHA" } = input.grid ?? {};
      if (!Number.isFinite(step) || step < 10 || step > 10000 || !Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) > 180 || !["quadrada", "triangular"].includes(pattern)) throw Error("Confira o espaçamento, o formato e a rotação.");
      const vertices = paths(area.geometry).flat();
      const [lon, lat] = vertices[0];
      const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
      const project = require("proj4")("EPSG:4326", `+proj=utm +zone=${zone}${lat < 0 ? " +south" : ""} +ellps=GRS80 +units=m`);
      const contains = require("@turf/boolean-point-in-polygon").default;
      const angle = rotationDegrees * Math.PI / 180;
      const rotate = ([x,y]: number[], a: number) => [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)];
      const bounds = vertices.map(p => rotate(project.forward(p.slice(0,2)), -angle));
      const xs = bounds.map(p => p[0]), ys = bounds.map(p => p[1]);
      const rowStep = pattern === "triangular" ? step * Math.sqrt(3)/2 : step;
      // Build the lattice in metric coordinates, then test each point against
      // the original polygon (including holes) before storing longitude/latitude.
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const firstRow = Math.ceil(Math.min(...ys)/rowStep), lastRow = Math.floor(Math.max(...ys)/rowStep);
      if ((lastRow - firstRow + 1) * (2 + (maxX-minX)/step) > 500000) throw Error("A área é grande para esse espaçamento. Aumente a distância ou selecione uma área menor.");
      const features = [];
      for (let row = firstRow; row <= lastRow; row++) {
        const offset = pattern === "triangular" && row % 2 !== 0 ? step/2 : 0;
        for (let x = Math.ceil((minX-offset)/step)*step+offset; x <= maxX; x += step) {
          const coordinates = project.inverse(rotate([x,row*rowStep],angle));
          if (!contains(coordinates, area)) continue;
          features.push({type:"Feature", geometry:{type:"Point", coordinates}, properties:{name:`${originCode}-${features.length+1}`, spacingMeters:step, rotationDegrees, pattern}});
          if (features.length > 5000) throw Error("A malha ultrapassa 5.000 pontos. Aumente o espaçamento.");
        }
      }
      if (!features.length) throw Error("Nenhum ponto caiu dentro da área.");
      const vector = {type:"FeatureCollection",features};
      return saveAnalysis(input.projectId, `Malha ${pattern} ${step} m.geojson`, vector);
    }
    case "layers.previewStyle": {
      const file = state.files.find(row => row.id === input.id && row.projectId === input.projectId && row.vector);
      if (!file || !/^#[0-9a-f]{6}$/i.test(input.color) ||
          !Number.isFinite(input.weight) || input.weight < 1 || input.weight > 8 ||
          !Number.isFinite(input.fillOpacity) || input.fillOpacity < 0 || input.fillOpacity > 1) {
        throw Error("Simbologia inválida.");
      }
      const defaultStyle = { color: input.color, weight: input.weight, fillOpacity: input.fillOpacity };
      save({ ...state, files: state.files.map(row => row.id === file.id ? { ...row, defaultStyle } : row) });
      return { success: true };
    }
    case "layers.setVisibility": {
      if (!state.files.some(file => file.id === input.id && file.vector)) return undefined;
      save({ ...state, files: state.files.map(file => file.id === input.id ? { ...file, isVisible: Boolean(input.visible) } : file) });
      return { success: true };
    }
    case "raster.ingestGeoTiff": {
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      const contents = Buffer.from(input.fileData || "", "base64");
      const magic = contents.subarray(0, 4).toString("hex");
      if (contents.length !== input.size || contents.length > 8_000_000 || !["49492a00", "4d4d002a", "49492b00", "4d4d002b"].includes(magic)) throw Error("Envie um GeoTIFF válido de até 8 MB.");
      const cog = await ingestCog(contents, input.acquisitionAt, input.sourceLabel);
      const file = append("files", { projectId: input.projectId, name: input.filename, fileType: "geotiff", fileSize: contents.length, isGeospatial: true, currentVersion: 1,
        uploadedAt: new Date().toISOString(), s3Url: "/previa/raster/" + cog.key + "/raster.cog.tif", contents: contents.toString("base64"), cog });
      return { success: true, fileId: file.id, layerId: file.id, crs: "EPSG:4674", bounds: cog.bounds, cogSha256: cog.sha256, cogUrl: file.s3Url };
    }
    case "atlas.render": {
      const job = state.jobs.find(row => row.id === input.id && row.kind === "atlas");
      const file = state.files.find(row => row.id === input.rasterLayerId && row.projectId === job?.projectId && row.cog);
      if (!job || !file) throw Error("Selecione um COG do projeto deste atlas.");
      const result = await renderCog(file.cog, job, true);
      save({ ...state, jobs: state.jobs.map(row => row.id === job.id ? { ...row, status: "completed", outputUrl: result.outputUrl, gridConfig: { totalPages: result.totalPages } } : row) });
      return result;
    }
    case "projects.create": {
      if (!input.name?.trim() || !input.code?.trim()) throw Error("Informe nome e código do projeto.");
      if (state.projects.some(project => project.code.toLowerCase() === input.code.trim().toLowerCase())) throw Error("Código de projeto já cadastrado.");
      return append("projects", { ...input, code: input.code.trim(), status: input.status || "active" });
    }
    case "files.upload": {
      if (!state.projects.some(project => project.id === input.projectId)) throw Error("Projeto inexistente.");
      const contents = Buffer.from(input.fileData || "", "base64");
      if (!contents.length || contents.length > 8_000_000) throw Error("Selecione um arquivo de até 8 MB para a prévia.");
      const name = String(input.filename || "arquivo").split(/[\\/]/).pop()!;
      const fileType = name.split(".").pop()!.toLowerCase();
      const vector = await parseVector(contents, fileType);
      const url = "/previa/download/arquivo/" + state.nextId;
      const file = append("files", { projectId: input.projectId, name, fileType, fileSize: contents.length, mimeType: input.mimeType, isGeospatial: Boolean(vector), currentVersion: 1, uploadedAt: new Date().toISOString(), s3Url: url, vector, contents: contents.toString("base64") });
      return { id: file.id, url };
    }
    case "files.download": {
      const file = state.files.find(row => row.id === (input.id ?? input.fileId));
      if (!file) throw Error("Arquivo inexistente.");
      return { url: file.s3Url, filename: file.name };
    }
    case "files.delete":
      save({ ...state, files: state.files.filter(file => file.id !== (input.id ?? input.fileId)) });
      return { success: true };
    case "atlas.templates.create":
      return append("templates", input);
    case "printJobs.create":
    case "atlas.create": {
      if (!state.projects.some(project => project.id === input.projectId) || !input.name?.trim() || !input.title?.trim()) throw Error("Informe o projeto, o nome e o título.");
      const kind = method === "atlas.create" ? "atlas" : "map";
      const raster = projectRows(state.files, input).find(file => file.cog);
      if (raster) {
        const result = kind === "map" ? await renderCog(raster.cog, input, false) : null;
        const gridConfig = { totalPages: result?.totalPages ?? 4 };
        const job = append("jobs", { ...input, kind, status: result ? "completed" : "pending", outputUrl: result?.outputUrl, gridConfig });
        return { id: job.id, grid: gridConfig, outputUrl: job.outputUrl };
      }
      const layers = projectRows(state.files, input).filter(file => file.vector && (!input.layersConfig?.length || input.layersConfig.some((layer: Row) => layer.layerId === file.id)));
      const vectors = layers.length ? layers.map(file => file.vector) : [sample];
      const totalPages = kind === "atlas" ? 4 : 1;
      const job = append("jobs", { ...input, vectors, kind, status: "completed", outputUrl: "/previa/download/pdf/" + state.nextId, gridConfig: { totalPages } });
      return { id: job.id, grid: job.gridConfig, outputUrl: job.outputUrl };
    }
  }
  return undefined;
}

export function download(path: string) {
  if (path === "/amostra.geojson") {
    return { body: Buffer.from(JSON.stringify(sample, null, 2)), name: "area-ficticia.geojson", type: "application/geo+json" };
  }
  const match = /^\/(arquivo|pdf)\/(\d+)$/.exec(path);
  if (!match) return;
  const id = Number(match[2]);
  if (match[1] === "arquivo") {
    const file = state.files.find(row => row.id === id);
    if (file) return { body: Buffer.from(file.contents, "base64"), name: file.name, type: "application/octet-stream" };
    return;
  }
  const job = state.jobs.find(row => row.id === id);
  if (!job) return;
  const pdf = new jsPDF({ orientation: job.orientation, format: job.pageSize.toLowerCase() });
  const lines = job.vectors.flatMap((vector: Row) => vector.features.flatMap((feature: Row) => paths(feature.geometry))) as number[][][];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const line of lines) for (const [longitude, latitude] of line) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  const dx = Math.max((east - west) * 0.08, 0.0001);
  const dy = Math.max((north - south) * 0.08, 0.0001);
  west -= dx; east += dx; south -= dy; north += dy;
  const pages = job.gridConfig.totalPages;
  const width = pdf.internal.pageSize.getWidth() - 28;
  const height = pdf.internal.pageSize.getHeight() - 76;
  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    const cols = pages === 1 ? 1 : 2;
    const spanX = (east - west) / cols;
    const spanY = (north - south) / cols;
    const minX = west + (page % cols) * spanX;
    const maxY = north - Math.floor(page / cols) * spanY;
    pdf.setFontSize(16);
    pdf.text(String(job.title).slice(0, 85), 14, 18);
    pdf.setFontSize(9);
    pdf.text("PRÉVIA LOCAL · Cartografia de demonstração", 14, 26);
    pdf.text(`Folha ${page + 1}/${pages} · EPSG:4326 · escala solicitada 1:${job.scale}`, 14, 32);
    pdf.saveGraphicsState();
    pdf.rect(14, 40, width, height).clip().discardPath();
    pdf.setDrawColor(29, 107, 86);
    pdf.setLineWidth(0.45);
    for (const line of lines) {
      const points = line.map(([x, y]) => [14 + (x - minX) * width / spanX, 40 + (maxY - y) * height / spanY]);
      if (points.length === 1) pdf.circle(points[0][0], points[0][1], 0.8, "S");
      for (let i = 1; i < points.length; i++) pdf.line(...points[i - 1], ...points[i]);
    }
    pdf.restoreGraphicsState();
    pdf.rect(14, 40, width, height);
    pdf.text(`Extensão da folha: ${minX.toFixed(4)}, ${(maxY - spanY).toFixed(4)} a ${(minX + spanX).toFixed(4)}, ${maxY.toFixed(4)}`, 14, 46 + height);
  }
  return { body: Buffer.from(pdf.output("arraybuffer")), name: `${job.kind}-${id}.pdf`, type: "application/pdf" };
}

export function downloadVector(projectId: number, fileId: number, format: string) {
  const file = state.files.find(row => row.id === fileId && row.projectId === projectId && row.vector);
  if (file) return exportVector({ name: file.name, vector: file.vector }, format);
}
