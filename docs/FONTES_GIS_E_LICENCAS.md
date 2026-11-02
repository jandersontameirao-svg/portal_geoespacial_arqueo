# Fontes GIS e licenças verificadas — 29/10/2026

## OpenStreetMap

A política oficial de tiles da OpenStreetMap Foundation informa que os dados OSM são livres, mas o servidor padrão `tile.openstreetmap.org` tem capacidade limitada, disponibilidade best-effort e pode bloquear uso inadequado. A política exige atribuição visível, identificação e referer válidos, respeito ao cache e proíbe prefetch, scraping e uso offline. O Portal não deve tentar contornar um bloqueio de tiles; para produção deve usar um provedor contratado/aprovado ou infraestrutura própria que respeite os termos.

Fonte: https://operations.osmfoundation.org/policies/tiles/

## INDE e padrões OGC

O Catálogo de Geosserviços da INDE explica que WMS é serviço de representação visual, enquanto WFS retorna as próprias feições espaciais. O catálogo relaciona instituições nacionais, entre elas FUNAI, IBGE, ICMBio, IPHAN e DNIT, e também o IDE/Sisema. Essa distinção é usada no catálogo do portal para separar camadas visuais de dados analíticos.

Fonte: https://inde.gov.br/CatalogoGeoservicos

## Estado operacional verificado

Em 29/10/2026, o tile ESRI World Imagery respondeu HTTP 200 e o GetCapabilities WMS do ICMBio respondeu HTTP 200 a partir do ambiente de validação. O GetCapabilities WFS da FUNAI não pôde ser validado porque a cadeia TLS apresentada falhou na verificação de certificado do ambiente. O Portal **não** ignora certificados e não usa `-k`/`rejectUnauthorized: false`; se a atualização FUNAI falhar, o cache previamente validado deve permanecer disponível e o administrador deve corrigir a cadeia TLS da fonte ou configurar fonte oficial substituta aprovada.

## ICMBio

O ICMBio publica dados de referência e temáticos em shapefile e informa endpoints OGC oficiais para consumo por GIS. Endpoints publicados:

- WMS: https://geoservicos.inde.gov.br/geoserver/ICMBio/ows?service=wms&version=1.3.0&request=GetCapabilities
- WFS: https://geoservicos.inde.gov.br/geoserver/ICMBio/ows?service=wfs&version=2.0.0&request=GetCapabilities

Fonte: https://www.gov.br/icmbio/pt-br/dados-icmbio/dados_geoespaciais

## Esri

A comunicação da Esri sobre basemaps legados confirma que World Imagery permanece como camada de referência e que serviços raster legados de Light Gray/Dark Gray Canvas têm substituições vetoriais indicadas. O portal usa World Imagery como base disponível e deixa variantes Light/Dark condicionadas à revisão de disponibilidade e termos antes de uso produtivo.

Fonte: https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/announcements/sunsetting-legacy-basemaps

## Turf.js

O motor Turf opera dados GeoJSON. A documentação de `buffer` prevê unidades explícitas e a de `intersect` retorna a área comum de polígonos/MultiPolygons ou `null`. O Portal usa esses recursos no módulo testável de análise espacial, registrando unidades, parâmetros e CRS de entrada/saída na proveniência do resultado.

- Buffer: https://turfjs.org/docs/api/buffer
- Intersect: https://turfjs.org/docs/api/intersect
- Projeto: https://github.com/Turfjs/turf
