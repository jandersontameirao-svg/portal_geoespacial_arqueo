# Consolidação candidata — etapa 1

Base: `9426d80c4e6b10e584b6c0d53fd6b0aeaba0c791` (GIS isolado).

Componentes portados seletivamente da linha PR8/local:

- Contrato `shared/geometry-coordinates.ts` (Polygon/MultiPolygon/furos, validação topológica).
- Helper `client/src/lib/leaflet-geometry-coordinates.ts` (fechamento de anéis sem perda de nesting).
- Parser limitado de KML/KMZ `client/src/lib/kml-file-viewer.ts`.
- Lifecycle de `MeasurementTools` com `L.Control.Measure` e limpeza de handlers.
- Hardening OAuth/JWT: state com nonce vinculado ao navegador, consumo único em runtime, callback fail-closed, issuer/audience de sessão e verificações de segredo gerenciado sem rotação.
- A entrada cliente preserva `leafletDefaultMarker`, necessária para os assets de marcador do Portal GIS.

Ainda não foram copiados schemas, migrations, routers Atena, árvore persistida PR8 nem arquivos de interface inteira. Esses itens conflitam com o modelo GIS/WFS/raster e exigem reconciliação explícita em migrations novas.

## Atena — adição de código pendente de migration nova

Os módulos de análise/cartografia Atena e o painel foram adicionados como namespace `atena`. A tabela `atena_runs` entrou apenas no schema de código. Não foi gerada, aplicada ou renumerada qualquer migration: a migration futura será criada após a matriz definitiva de diferenças de schema.


## Atena PR8 — preservada, não ativada nesta consolidação

A tentativa de ativação revelou divergência real de modelo: PR8 exige `geometries.layerId`, grupos `layers.isGroup`, `createGeometriesBatch` e uma árvore de camadas distinta. Para não sobrepor schema, menus, Atlas e workspace GIS, os fontes completos foram preservados em `docs/consolidation/deferred-pr8-atena/` com `SHA256SUMS.txt`, mas não são compilados nem registrados no router.

A linha GIS preserva seu `atlasRouter`, worker cartográfico, templates e renderização raster/vetor. A integração funcional da Atena PR8 dependerá de uma migration nova e de um adaptador explícito de camadas, após decisão de arquitetura — não das migrations produtivas 0007–0012.
