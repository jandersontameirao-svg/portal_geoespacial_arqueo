// Approximate 1:4,500 from the approved Leaflet view (zoom 17 at the LT).
export const linearAtlasScale = 4500;

export const defaultLayout = {
  principal: { x: 27, y: 32, w: 440, h: 370 },
  legenda: { x: 478, y: 202, w: 104, h: 65 },
  norte: { x: 33, y: 36, w: 14, h: 20 },
  brasil: { x: 479, y: 30, w: 100, h: 79 },
  regional: { x: 479, y: 112, w: 100, h: 79 },
};
export type Layout = typeof defaultLayout;
export type Orientation = "landscape" | "portrait";
export function readOrientation(value: unknown): Orientation {
  if (value == null || value === "landscape") return "landscape";
  if (value === "portrait") return "portrait";
  throw Error("Orientação inválida.");
}
export const portraitLayout: Layout = {
  principal: { x:27, y:32, w:366, h:390 },
  norte: { x:33, y:36, w:14, h:20 },
  brasil: { x:27, y:435, w:82, h:67 },
  regional: { x:114, y:435, w:82, h:67 },
  legenda: { x:27, y:509, w:169, h:64 },
};
export function readLayout(value: unknown, orientation: Orientation = "landscape"): Layout {
  const defaults = orientation === "portrait" ? portraitLayout : defaultLayout;
  const [width,height] = paperSize("A2",orientation);
  if (value === undefined) return defaults;
  if (!value || typeof value !== "object") throw Error("Layout inválido.");
  const result = {} as Layout;
  for (const key of Object.keys(defaultLayout) as (keyof Layout)[]) {
    const box = (value as Layout)[key] ?? (key === "principal" ? defaults.principal : undefined);
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) ||
        box.x < 0 || box.y < 0 || box.w < 10 || box.h < 10 || box.x+box.w > width+.001 || box.y+box.h > height+.001) throw Error("Elemento fora da folha.");
    result[key] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  return result;
}
export function readScale(value: unknown, maximum = 10000000): number | undefined {
  if (value == null || value === "") return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > maximum) throw Error("Use uma escala entre 1:1.000 e 1:" + maximum.toLocaleString("pt-BR") + ".");
  return value;
}

export const studioBackgrounds = { cartografico:"Cartográfico", claro:"Cinza claro", branco:"Branco com limites", nenhum:"Sem base", "esri-imagery":"ESRI Satélite", "esri-light-gray":"ESRI Light Gray", "esri-dark-gray":"ESRI Dark Gray" } as const;
export type StudioBackground = keyof typeof studioBackgrounds;
export function readStudioBackground(value: unknown): StudioBackground {
  if (value === undefined) return "cartografico";
  if (typeof value === "string" && Object.hasOwn(studioBackgrounds,value)) return value as StudioBackground;
  throw Error("Fundo de mapa inválido.");
}
export type StudioAreaStyle = { color:string; opacity:number; strokeColor?:string; strokeMm?:number };
export const studioSymbols = {
  circulo:"Círculo", quadrado:"Quadrado", triangulo:"Triângulo", losango:"Losango",
  pentagono:"Pentágono", hexagono:"Hexágono", estrela:"Estrela", cruz:"Cruz", xis:"X",
} as const;
export type StudioSymbol = keyof typeof studioSymbols;
export type StudioVectorStyle = { color:string; widthMm?:number; sizeMm?:number; symbol?:StudioSymbol };
// A mesma silhueta normalizada alimenta o seletor, o SVG e o PDF vetorial.
export function studioSymbolPoints(symbol:StudioSymbol): [number,number][] {
  if (symbol === "cruz" || symbol === "xis") {
    const cross: [number,number][] = [[-.28,-1],[.28,-1],[.28,-.28],[1,-.28],[1,.28],[.28,.28],
      [.28,1],[-.28,1],[-.28,.28],[-1,.28],[-1,-.28],[-.28,-.28]];
    return symbol === "cruz" ? cross : cross.map(([x,y]) => [(x-y)/1.28,(x+y)/1.28]);
  }
  const count = {circulo:32,quadrado:4,triangulo:3,losango:4,pentagono:5,hexagono:6,estrela:10}[symbol];
  return Array.from({length:count},(_,i) => {
    const a=i*2*Math.PI/count-Math.PI/2+(symbol==="quadrado" ? Math.PI/4 : 0);
    const r=symbol==="estrela" && i%2 ? .42 : symbol==="quadrado" ? Math.SQRT2 : 1;
    return [Math.cos(a)*r,Math.sin(a)*r];
  });
}
export type StudioView = { vectorStyles?: Record<string,StudioVectorStyle>; areaStyles?: Record<string,StudioAreaStyle>; background?: StudioBackground; east: number; north: number; labels: boolean; insets: Record<"brasil" | "regional", { background?: StudioBackground; layers?: number[]; scale?: number; east?: number; north?: number }> };
export function defaultStudioInset(): StudioView["insets"]["brasil"] {
  return { background: "cartografico" };
}
export function readStudioView(value: unknown): StudioView {
  const insets: StudioView["insets"] = { brasil: defaultStudioInset(), regional: defaultStudioInset() };
  if (value === undefined) return { east: 0, north: 0, labels: true, insets };
  const view = value as StudioView;
  if (!view || ![view.east, view.north].every(n => Number.isFinite(n) && Math.abs(n) <= 500000) ||
      typeof view.labels !== "boolean" || !view.insets) throw Error("Enquadramento inválido.");
  for (const key of ["brasil", "regional"] as const) {
    const inset = view.insets[key];
    if (!inset || (inset.layers !== undefined && (!Array.isArray(inset.layers) || inset.layers.length > 40 || !inset.layers.every(Number.isInteger))))
      throw Error("Camadas do mapa de situação inválidas.");
    if (![inset.east ?? 0, inset.north ?? 0].every(n => Number.isFinite(n) && Math.abs(n) <= 10000000)) throw Error("Enquadramento do quadro inválido.");
    insets[key] = { layers: inset.layers, scale: readScale(inset.scale, 500000000), background:readStudioBackground(inset.background ?? defaultStudioInset().background), east:inset.east, north:inset.north };
  }
  const areaStyles: Record<string,StudioAreaStyle> = {};
  for (const [id,style] of Object.entries(view.areaStyles ?? {})) {
    if (!/^\d+$/.test(id) || !style || !/^#[0-9a-f]{6}$/i.test(style.color) ||
      !Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) throw Error("Estilo de área inválido.");
    if (style.strokeColor !== undefined && !/^#[0-9a-f]{6}$/i.test(style.strokeColor)) throw Error("Cor de contorno inválida.");
    if (style.strokeMm !== undefined && (!Number.isFinite(style.strokeMm) || style.strokeMm < .1 || style.strokeMm > 3))
      throw Error("Use uma espessura de contorno entre 0,1 e 3 mm.");
    areaStyles[id] = style;
  }
  const vectorStyles: Record<string,StudioVectorStyle> = {};
  for (const [id,style] of Object.entries(view.vectorStyles ?? {})) {
    if (!/^\d+$/.test(id) || !style || typeof style.color !== "string" || !/^#[0-9a-f]{6}$/i.test(style.color) ||
        (style.widthMm !== undefined && (!Number.isFinite(style.widthMm) || style.widthMm < .1 || style.widthMm > 3)) ||
        (style.sizeMm !== undefined && (!Number.isFinite(style.sizeMm) || style.sizeMm < .5 || style.sizeMm > 8)) ||
        (style.symbol !== undefined && (typeof style.symbol !== "string" || !Object.hasOwn(studioSymbols,style.symbol))))
      throw Error("Estilo de linha ou ponto inválido.");
    const {color,widthMm,sizeMm,symbol}=style;
    vectorStyles[id]={color,widthMm,sizeMm,symbol};
  }
  return { areaStyles, vectorStyles, background:readStudioBackground(view.background), east: view.east, north: view.north, labels: view.labels, insets };
}

export const paperSizes = { A4: [297,210], A3: [420,297], A2: [594,420], A1: [841,594], A0: [1189,841] } as const;
export type Paper = keyof typeof paperSizes;
export const defaultStudioPaper: Paper = "A3";
export function readPaper(value: unknown): Paper {
  if (value == null) return "A2";
  if (typeof value !== "string" || !Object.hasOwn(paperSizes,value)) throw Error("Formato de papel inválido.");
  return value as Paper;
}
export function paperSize(paper: Paper, orientation: Orientation = "landscape"): [number,number] {
  const [w,h] = paperSizes[paper];
  return orientation === "portrait" ? [h,w] : [w,h];
}
export function paperFactor(paper: Paper) {
  const [w,h] = paperSizes[paper];
  return Math.min(w/594,h/420);
}
export function restoreLegend(layout: Layout): Layout {
  const legend = layout.legenda;
  if (legend.x >= 474 && legend.x+legend.w <= 584 && legend.y >= 30 && legend.y+legend.h <= 269) return layout;
  return { ...layout, legenda: { ...defaultLayout.legenda } };
}

export const studioModels = [
  {id:"mapa", group:"Empreendimento", title:"Mapa de localização", summary:"Traçado e mapas de situação.", needs:"Eixo ou perímetro do projeto"},
  {id:"influencia", group:"Empreendimento", title:"Áreas de influência", summary:"ADA, AID e AII na mesma prancha.", needs:"ADA, AID e AII"},
  {id:"detalhe", group:"Empreendimento", title:"Detalhe de trecho", summary:"Recorte de um trecho da LT.", needs:"Eixo do projeto"},
  {id:"relevo", group:"Meio físico", title:"Relevo e hipsometria", summary:"Elevação por cores e relevo sombreado.", needs:"Modelo de elevação Copernicus"},
  {id:"topografia", group:"Meio físico", title:"Topografia", summary:"Curvas de nível e grade UTM.", needs:"Curvas de nível de 20 m"},
  {id:"uso-solo", group:"Meio físico", title:"Uso e cobertura do solo", summary:"Classes do MapBiomas Brasil 2024.", needs:"MapBiomas e eixo"},
  {id:"sitio", group:"Arqueologia", title:"Delimitação de sítio arqueológico", summary:"Perímetro validado e mapas de situação.", needs:"Polígono do sítio validado"},
  {id:"prospeccao", group:"Arqueologia", title:"Malha de poços-teste planejada", summary:"Pontos previstos e área de prospecção.", needs:"Malha de pontos planejados"},
  {id:"pocos", group:"Arqueologia", title:"Poços-teste executados", summary:"Pontos de campo com situação ou resultado.", needs:"Pontos executados com atributos de campo"},
  {id:"comparativo", group:"Arqueologia", title:"Planejado × executado", summary:"Comparação visual entre malha e execução.", needs:"Camadas planejada e executada"},
  {id:"corredor", group:"Atlas", title:"Atlas por corredor", summary:"Índice e folhas de detalhe da ADA ao longo do eixo.", needs:"Eixo contínuo do projeto"},
  {id:"atlas", group:"Atlas", title:"Atlas por grade", summary:"Folhas por linhas e colunas.", needs:"Camadas do projeto"},
] as const;
export const studioTerrain = [
  {id:-22,name:"Copernicus GLO-30 · elevação"},
  {id:-23,name:"Copernicus GLO-30 · curvas de nível de 20 m"},
] as const;

export function studioLayerRequirements(id: string, layers: {name:string; layerData:{features:{geometry:{type:string};properties?:Record<string,unknown>}[]}}[]) {
  const key = (name:string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const planned = layers.some(layer => /malha|planejad/.test(key(layer.name)) && layer.layerData.features.some(f => /Point$/.test(f.geometry.type)));
  const executed = layers.some(layer => /executad|campo/.test(key(layer.name)) && layer.layerData.features.some(f => /Point$/.test(f.geometry.type) &&
    Object.keys(f.properties ?? {}).some(field => /situacao|status|resultado/.test(key(field)) && String(f.properties?.[field] ?? "").trim())));
  const validated = layers.some(layer => layer.layerData.features.some(f => /Polygon$/.test(f.geometry.type) &&
    (f.properties?.validado === true || key(String(f.properties?.status ?? "")) === "validado")));
  if (id === "sitio" && !validated) return "Selecione o polígono do sítio com atributo validado ou status validado.";
  if ((id === "pocos" || id === "comparativo") && !executed) return "Selecione pontos executados com situação, status ou resultado de campo.";
  if ((id === "prospeccao" || id === "comparativo") && !planned) return "Selecione a malha de pontos planejados.";
}
