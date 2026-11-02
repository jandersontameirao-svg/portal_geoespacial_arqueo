# Relatório técnico — cópia isolada do Portal Geoespacial

**Data:** 29/10/2026  
**Branch isolada:** `desenvolvimento/auditoria-20261029`  
**Base:** checkpoint `04e64773`  
**Status:** candidato técnico isolado; **não aplicado ao projeto principal, não publicado e sem mutação de banco, storage, OAuth ou configurações de produção**.

## 1. Objetivo executado

Foi criada uma worktree Git separada em `/home/ubuntu/portal_geoespacial_arqueo_isolated` para corrigir problemas de camadas, robustez de fontes e capacidade de análise GIS sem desfazer funcionalidades existentes. O repositório principal continuou com apenas a alteração pré-existente do usuário em `.gitignore`.

A cópia recebeu um conjunto integrado de melhorias:

1. motor de análise espacial GeoJSON;
2. autorização efetiva por projeto em geometrias e resultados;
3. área de trabalho GIS dentro de cada projeto;
4. normalização de Shapefile INCRA para GeoJSON;
5. substituição de tiles públicos padrão OSM por catálogo centralizado de mapa-base;
6. documentação de fontes, licença e comportamento de falha.

## 2. Alterações implementadas

### 2.1 Motor GIS e resultados persistidos

Foi adicionado `server/gisAnalysis.ts`, baseado em Turf.js 7, com operações determinísticas:

- **Buffer/Zona de influência:** distância geodésica em metros, de 1 a 100.000 m;
- **Interseção, recorte e sobreposição:** área comum entre dois polígonos/MultiPolygons;
- **União:** combinação de duas ou mais áreas;
- **Cálculo de área:** resultado em metros quadrados, preservando a geometria;
- **Malha arqueológica:** células quadradas com espaçamento em metros, recorte pela área-alvo, rotação configurável e código sequencial (`PREFIXO-0001`).

O router `gisAnalysis` persiste o resultado na tabela `layers` existente, com `layerType: vector`, GeoJSON em `layerData`, bounds, estilo e metadados de proveniência. Os metadados registram operação, parâmetros, CRS, modelo geodésico, horário, quantidade de feições de entrada, área calculada e rótulos de origem.

Nenhuma tabela nova foi criada e nenhuma migração foi executada.

### 2.2 Autorização e auditoria por projeto

Foi criado `server/projectAccess.ts` e o router `geometries` foi reforçado.

- **Leitura** de geometrias/resultados exige usuário autenticado com vínculo ao projeto; administrador é exceção explícita.
- **Escrita** (criar, editar, apagar, mudar visibilidade/opacidade, importar e persistir análise) exige perfil global `editor`/`admin` **e** vínculo ao projeto.
- Exportação bloqueia IDs de projetos diferentes na mesma solicitação.
- Strings de KML passam por escape XML na exportação.
- As ações de geometria e análise passam a registrar auditoria com `projectId`.

Também foi adicionada edição parcial de geometria no helper de banco já existente; não há DDL novo.

### 2.3 Interface por projeto

A página de detalhe de projeto recebeu a aba **Mapa & Análise**.

O componente `ProjectGeoWorkspace` permite:

- desenhar ponto, linha e polígono;
- salvar a feição no projeto atual;
- editar ou excluir feições com ferramentas Leaflet;
- selecionar feições do projeto;
- executar as operações espaciais disponíveis;
- visualizar os resultados persistidos como camadas no próprio mapa.

A interface informa que cálculos usam EPSG:4326, distância em metros e área em m². O acesso de somente leitura não habilita escrita/análise.

### 2.4 Correção INCRA / Shapefile

Foi identificado defeito concreto: o fluxo anterior armazenava o ZIP Shapefile INCRA e o visualizador tentava `response.json()` nesse binário.

A rotina `downloadTerrasQuilombolas()` passa a:

1. baixar o ZIP oficial;
2. confirmar a presença de `.shp`;
3. converter o ZIP com `shpjs`;
4. normalizar uma ou várias coleções retornadas para uma única `FeatureCollection`;
5. calcular bounds do GeoJSON convertido;
6. armazenar `.geojson` como conteúdo da camada;
7. marcar o formato no catálogo como `geojson`.

O URL público oficial do download continua explícito no serviço como proveniência da aquisição.

### 2.5 Mapa-base e fontes externas

Foi adicionado `client/src/lib/basemaps.ts` como catálogo centralizado.

- **ESRI World Imagery**: configurado como base visual disponível; o tile de validação retornou HTTP 200 `image/jpeg`.
- **OSM e OpenTopo**: cadastrados como `requires-approved-provider`; o Portal não usa mais o endpoint público `tile.openstreetmap.org` como fallback e não tenta contornar bloqueios.
- As referências de tile público OSM foram removidas de `BaseLayersViewer`, `GeometryImport`, `MapViewer` e do modo 2D de `GlobeViewer`.
- A rota quebrada “Ver no Mapa” nos uploads GIS foi corrigida de `/base-layers-viewer` para `/base-layers/viewer`.
- A altura do mapa de camadas foi limitada a `clamp(420px, 62vh, 680px)`, evitando que o mapa domine a página e oculte controles abaixo dele.

A política oficial OSM, INDE, ICMBio, Esri e Turf foram documentadas em `docs/FONTES_GIS_E_LICENCAS.md`.

## 3. Validações realizadas

Todas as validações abaixo foram executadas na cópia isolada, com `DATABASE_URL`, chaves Forge e chave de frontend vazias.

| Verificação | Resultado |
|---|---:|
| Testes Vitest específicos GIS | **12/12 aprovados** |
| `server/gisAnalysis.test.ts` | 5 testes aprovados |
| `server/projectAccess.test.ts` | 4 testes aprovados |
| `server/geodataService.test.ts` | 3 testes aprovados |
| `pnpm exec tsc --noEmit` | Sem diagnósticos |
| `pnpm run build` | Concluído |
| Busca por tile público OSM em `client/src` | Nenhum resultado |
| Inspeção visual anônima do build estático | Landing page e assets renderizados |
| ESRI World Imagery | HTTP 200, `image/jpeg` |
| ICMBio WMS GetCapabilities | HTTP 200, `text/xml` |

## 4. Limites e riscos que permanecem visíveis

1. **FUNAI:** a verificação WFS falhou por cadeia TLS não confiável no ambiente de validação. Nenhum certificado foi ignorado e nenhum bypass foi aplicado. O sistema deve preservar a camada já em cache até que a fonte normalize seu certificado ou seja configurada uma fonte oficial substituta aprovada.
2. **react-leaflet-draw:** o build conclui, mas emite aviso de interoperabilidade ESM entre `react-leaflet-draw` e `leaflet-draw`. É necessário teste autenticado do desenho/edição antes de produção.
3. **Bundle:** o chunk principal ficou acima de 500 kB minificado. Recomenda-se dividir componentes pesados por importação dinâmica antes de uma publicação de larga escala.
4. **Sem integração de produção:** não foram executadas chamadas contra MySQL/TiDB, S3/manus-upload-file, OAuth, QGIS/PostGIS ou os dados persistidos do portal. Por isso, esta entrega não declara homologação de produção.
5. **Rasters/ortofotos:** não foi implementado pipeline COG/GeoTIFF, pirâmides, reprojeção, mosaico ou catalogação raster. Imagem ESRI é base visual de referência, não ortofoto certificada ou substituta de produto técnico.

## 5. Próxima decisão recomendada

1. Revisar este candidato isolado.
2. Caso aprovado, aplicar o commit isolado sobre o projeto principal em uma etapa explícita e reversível.
3. Realizar homologação autenticada em projeto de teste: desenho, edição, análise, persistência, reabertura, exportação, upload GeoJSON/KML/KMZ e conversão INCRA.
4. Só após aprovação funcional criar checkpoint WebDev do projeto principal e avaliar publicação.

## 6. Arquivos principais adicionados

- `server/gisAnalysis.ts`
- `server/gisAnalysisRouter.ts`
- `server/projectAccess.ts`
- `client/src/components/ProjectGeoWorkspace.tsx`
- `client/src/lib/basemaps.ts`
- `server/geodataService.test.ts`
- `server/gisAnalysis.test.ts`
- `server/projectAccess.test.ts`
- `server/types/shpjs.d.ts`
- `docs/FONTES_GIS_E_LICENCAS.md`
- `docs/RELATORIO_TECNICO_COPIA_ISOLADA_2026-10-29.md`
