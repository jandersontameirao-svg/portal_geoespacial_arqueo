# Basemaps Esri — verificação para a cópia isolada

A Esri informa que os serviços raster `World_Light_Gray_Base` e `World_Dark_Gray_Base` são legados, em suporte maduro e previstos para retirada em dezembro de 2029. As substituições recomendadas são basemaps vetoriais, que exigem um adaptador de vector tiles e não são diretamente compatíveis com o `TileLayer` raster atual. Por isso, nesta etapa a cópia isolada expõe os dois serviços raster somente com rótulo de legado e aviso de prazo; não os apresenta como solução de longo prazo.[1]

Em 29/10/2026, a leitura local de um tile `z=2/x=1/y=1` respondeu HTTP 200 e JPEG 256×256 para World Imagery, Light Gray e Dark Gray. O catálogo mantém a atribuição no mapa. A Esri orienta que fontes/créditos sejam exibidos no mapa ou próximo dele, inclusive em material publicado.[2]

O World Imagery continua descrito como imagem de referência. O portal mantém a regra de não chamá-lo de ortofoto certificada. OSM e OpenTopo seguem indisponíveis no catálogo até haver provedor aprovado, termos, atribuição e limites operacionais; o Portal não usa `tile.openstreetmap.org` como fallback.

## Fontes configuradas

- World Imagery: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
- World Light Gray Base, legado: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`
- World Dark Gray Base, legado: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`

## Referências

[1]: https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps "Sunsetting Legacy Basemaps"
[2]: https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040 "Correct way to cite an ArcGIS Online basemap"
