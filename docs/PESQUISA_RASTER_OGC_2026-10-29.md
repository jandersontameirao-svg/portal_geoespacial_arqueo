# Pesquisa técnica raster e OGC — 29/10/2026

## COG e GDAL

A documentação oficial do driver **COG** do GDAL confirma suporte a criação de Cloud Optimized GeoTIFF com compressão, opções de reamostragem para overviews e reprojeção, escolha explícita de `TARGET_SRS`, e controle de overviews (`OVERVIEWS`, `OVERVIEW_COUNT`). O pipeline local usa GDAL 3.8.4, que expõe o driver COG.

Para imagens contínuas, o driver permite `RESAMPLING`/`OVERVIEW_RESAMPLING` e `WARP_RESAMPLING` como `CUBIC`, e `COMPRESS=DEFLATE` com preditor. Para dados categóricos o método deve ser `NEAREST`; o pipeline recebe esse modo por parâmetro, não aplica um método único silenciosamente.

Fonte: https://gdal.org/en/stable/drivers/raster/cog.html

## Requisitos OGC COG

A especificação OGC COG 1.0 define que um COG usa GeoTIFF com georreferência, dados organizados em tiles e subarquivos de resolução reduzida (overviews). Para distribuição HTTP, o servidor deve suportar ranges de bytes; em HTTPS, deve permitir CORS e o cabeçalho `range` quando o cliente estiver em outro domínio.

O pipeline valida propriedades internas do arquivo gerado, mas não declara conformidade de hospedagem HTTP até que a infraestrutura de storage/proxy seja testada com `Accept-Ranges: bytes` e CORS apropriado.

Fonte: https://docs.ogc.org/is/21-026/21-026.html

## QGIS Server / WFS

A documentação QGIS afirma que `GetCapabilities` retorna metadados XML do servidor WFS. A rotina de saúde OGC usa requisições `SERVICE=WFS|WMS&REQUEST=GetCapabilities`, verifica resposta HTTP, XML e indícios do serviço esperado, sem executar `Transaction` ou qualquer operação mutável.

Fonte: https://docs.qgis.org/latest/en/docs/server_manual/services/wfs.html
