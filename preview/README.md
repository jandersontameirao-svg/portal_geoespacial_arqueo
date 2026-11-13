# Prévia local do Geoportal

Código implementado por Codex para revisão e integração ao servidor do Geoportal. Esta prévia usa Vite em loopback, usuário demonstrativo e armazenamento JSON local. A configuração de produção do repositório tem seu próprio servidor e autenticação.

Na raiz do repositório com as dependências instaladas, execute:

```sh
pnpm exec vite --config preview/previa-local.config.mts --configLoader runner --port 46178
```

A prévia cria um projeto fictício quando o arquivo `preview/previa-local-dados.json` estiver ausente. Os projetos, arquivos, resultados e credenciais da máquina de teste ficam fora do repositório público.

Para reproduzir a busca e as camadas do IBGE, coloque `estados.geojson`, `municipios-BR.geojson` e `localidades.geojson` em `previa-raster/angicos/`, dentro desta pasta. Use as malhas oficiais do IBGE de 2024 e as Localidades de 2022. O script `preparar-malha-nacional.py` converte a malha municipal oficial de 2024 e gera os pontos de rótulo. O leitor espera `NM_UF` ou `SIGLA_UF` para estados e `NM_LOCALIDADE` para localidades. As referências em PDF e os dados do projeto LT Angicos–Jaguaruana II usados na prévia original devem ser fornecidos separadamente pelo Grupo Arqueo.

- A lupa consulta projetos e arquivos da prévia e o índice em memória do IBGE. Cidades centralizam o mapa, arquivos abrem a aba do projeto e coordenadas são interpretadas localmente.
- O editor de Mapas e Atlas salva os parâmetros de cada produto. A composição A2 usa a escala e as dimensões físicas do quadro para calcular sua extensão em UTM. O atlas usa a grade e a sobreposição para posicionar os quadros.
- A Atena interpreta os pedidos por regras locais. Com os parâmetros confirmados, a prévia calcula buffers e malhas, grava o GeoJSON e gera produtos PDF ou arquivos para download. Veja [integração da Atena](previa-integracao-atena.md).
- GeoTIFF/COG e exportação vetorial chamam os utilitários do GDAL. A prévia está configurada para QGIS 3.44.12 no Windows.

Na integração com a VPS, use o banco e a autenticação da aplicação, verifique a autorização por projeto em cada operação e configure GDAL no servidor. O servidor de demonstração, com usuário administrador simulado, deve permanecer restrito a loopback.
