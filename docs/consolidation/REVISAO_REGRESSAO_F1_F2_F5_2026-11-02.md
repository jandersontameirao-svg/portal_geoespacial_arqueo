# Revisão de regressão — F1, F2 e F5

**Data:** 02/11/2026. **Modalidade:** revisão exclusivamente estática de fontes e diffs Git.

| Referência | Valor |
|---|---|
| Repositório consultado | `/home/ubuntu/atena_geoportal_opcao_a_isolado` |
| Baseline | `04e64773d0c2a9b4cb25fa7f4d1015646fb11091` |
| Candidata | `f7bf75e8b25a1c6a55edea6281327dafcc310e5b` |
| HEAD observado no início e após a leitura | A candidata acima |
| Revisão anterior obrigatória | `/home/ubuntu/atena_revisao_unica_20261102/revisao/REVISAO_CONSUMIDORES_FILETYPE.md` |
| Skill lida | `/home/ubuntu/skills/webdev-readme-fullstack/SKILL.md` |

As referências de linhas abaixo pertencem ao conteúdo do respectivo commit, não a um checkout hipotético. **B** significa baseline e **C**, candidata. As fontes foram comparadas por `git show SHA:arquivo`, numeração com `nl -ba`, `git diff` e `git grep`. A leitura de arquivos locais complementou a comparação; a base das conclusões é o par de commits especificado.

## 1. Conclusão executiva

**F1 é cobertura incompleta do novo tipo `geotiff`, e não regressão demonstrada dos oito rótulos antigos.** A candidata passa a produzir esse rótulo no fluxo raster, mas não o inclui nos filtros por categoria nem no badge global. O defeito lógico atual está demonstrado pelas fontes: GeoTIFF recebe “Outro” na página global e não integra nem o filtro “Outros” nem o “Geoespacial”. Isso não demonstra perda, reclassificação ou desaparecimento de registros antigos.

**F2 exige separar o endpoint genérico da UI atual.** A regra `image/tiff → image` em `files.upload`, sem ingestão raster, é **preexistente**. A UI candidata intercepta `image/tiff` e o encaminha a `raster.ingestGeoTiff`; atribuir a ela o percurso genérico seria incorreto. Entretanto, esse redirecionamento reduz condicionalmente a compatibilidade do upload TIFF anterior: introduz pré-condição de disponibilidade raster e restrição de nome derivado que o contrato baseline não exigia. Essas diferenças são **regressão demonstrável por contrato**, nos casos descritos na seção 4, mas **não provam falha ocorrida no ambiente real**. A rejeição dos outros dois MIME no `FileUpload` padrão já existia; a nova rota reconhecê-los depois da validação não completa a cobertura.

**F5 é integração incompleta do novo fluxo raster com o novo versionamento.** A candidata cria a versão inicial no upload genérico, mas não no raster. O baseline já tinha a tabela e `currentVersion = 1`, porém não criava a versão inicial no upload lido e não oferecia os novos endpoints/UI de histórico. Não se demonstrou remoção de uma garantia baseline de versionamento raster; demonstrou-se assimetria atual de cobertura.

**F1, F2 e F5 não foram corrigidos.** Nenhum código, migration, teste ou configuração foi alterado. A autorização para executar **F4 em cópia separada não autoriza ampliar o patch para F1/F2/F5**. As propostas deste relatório são pendências para decisão separada, não instruções incorporadas ao patch F4. Este trabalho não executa nem reavalia F4.

## 2. Critério de classificação e limites

- **preexistente:** o comportamento relevante já está no baseline; não basta a candidata possuir recurso novo relacionado para transformar a limitação antiga em regressão.
- **novo fluxo/cobertura incompleta:** a candidata introduz tipo, rota ou função, mas não integra todos os consumidores. É defeito ou lacuna atual, sem demonstrar retirada de uma capacidade anterior equivalente.
- **regressão demonstrável por contrato:** uma entrada/cenário admitido pelo percurso anterior passa a sofrer restrição nova no mesmo ponto de uso. A prova estática é condicional ao cumprimento das demais pré-condições; não é registro de incidente real nem julgamento de que a mudança de produto foi indevida.
- **não provado:** falta estabelecer ocorrência, contrato anterior equivalente, estado de dados ou ambiente para sustentar a alegação.

Não houve aplicação, testes, build, importação/execução de módulos do projeto, banco, rede, migrations executadas, configuração, commit, push ou deploy. O `git status --short --untracked-files=no` consultado após a leitura não indicou alterações rastreadas. Havia evidências não rastreadas preexistentes no repositório, que não foram removidas ou incorporadas. O único entregável criado por esta tarefa é este relatório, fora do repositório.

Não se verificaram schema live, conteúdo dos arquivos, sucesso do storage/scanner/worker, ambiente raster configurado, comportamento do navegador, clientes externos, automações de banco ou registros de versões. F3, F4 e análise ordinal não são objetos deste parecer.

## 3. Tabela de achados e tratamento proposto

| Achado | Baseline | Candidata | Classificação | Risco | Escopo proposto, fora do patch F4 | Prova que falta |
|---|---|---|---|---|---|---|
| **F1 — filtros e badge global não contemplam `geotiff`** | B `drizzle/schema.ts:97–99`: não há `geotiff`. B `db.ts:362–370`, `filesRouter.ts:307–314` e `Files.tsx:83–115`: categorias dos tipos antigos. TIFF pela UI era salvo como `image`. | C `rasterRouter.ts:68–72` grava `geotiff`; C `db.ts:389–397` e `filesRouter.ts:351–358` não o incluem; C `Files.tsx:83–117` cai no badge “Outro”. | **novo fluxo/cobertura incompleta**. O fallback genérico já existia, mas a nova saída `geotiff` torna a lacuna alcançável no fluxo raster. | **Médio:** descoberta/classificação incorreta dos novos arquivos; sem perda de bytes demonstrada. | Definir categoria de GeoTIFF e alinhar os dois mapas, ícone/badge global e rótulo do filtro. Não converter registros antigos automaticamente. **Não corrigido.** | Para alegar regressão de dados existentes: prova de que uma linha antiga foi alterada ou deixou de ser listada com as mesmas condições. Para ocorrência real: registros e observação autorizada da UI. O desencaixe lógico do novo rótulo já está provado. |
| **F2-A — `files.upload` genérico aceita TIFF como `image`, sem raster** | B `filesRouter.ts:78–93,155–162,167–169,209–228`; B dispatcher `fileProcessing.ts:221–258` não trata TIFF. | C `filesRouter.ts:80–97,159–167,172–174,214–233`; dispatcher C `fileProcessing.ts:232–269` segue sem TIFF. A promoção adicionada é vetorial, não raster. | **preexistente** quanto à classificação e falta de ingestão TIFF genérica. A divergência frente à nova rota raster é cobertura incompleta, não retirada de suporte genérico anterior. | **Médio:** chamadas diretas/outros clientes podem persistir TIFF sem camada raster; categoria `geospatial` pode coexistir com `fileType: image`. | Decidir se o endpoint preserva upload de imagem TIFF ou orienta ingestão especializada. Inventariar clientes antes de mudar seu contrato. **Não corrigido.** | Chamador efetivo, payload, passagem pelas validações e registro produzido para afirmar incidente. Não há prova de que a UI padrão candidata percorra este ramo para `image/tiff`; o código mostra o contrário. |
| **F2-B — UI TIFF passa a depender do serviço raster, sem opção/fallback genérico** | B `FileUpload.tsx:37,60,107–145` aceita `image/tiff` e chama `files.upload`, cujo contrato não depende de disponibilidade raster. | C `FileUpload.tsx:39,70,120,150–175` força TIFF para raster. C `rasterRouter.ts:59–60` rejeita antes do storage se indisponível; C `rasterIngestionAdapter.ts:31–38` define o caso não configurado. | **regressão demonstrável por contrato**, no cenário de storage/scanner/banco disponíveis e raster não configurado. Ocorrência real: **não provado**. | **Médio:** upload antes genérico torna-se bloqueado nessa configuração. Não é a regra genérica `TIFF → image` causando erro na UI. | Decisão separada de produto: exigir raster para todo TIFF ou permitir upload genérico explícito; comunicar pré-condição antes do envio. Não fazer fallback silencioso que finja ingestão raster bem-sucedida. **Não corrigido.** | Estado real da disponibilidade e comparação autorizada do mesmo TIFF nas duas versões, caso se queira confirmar ocorrência. Não se consultaram variáveis/configuração nem serviços. |
| **F2-C — nome TIFF curto aceito no baseline não satisfaz a nova entrada raster** | B `filesRouter.ts:55–62` não impõe mínimo ao nome do arquivo; B UI `FileUpload.tsx:136–145` transmite `filename` sem derivar `name` raster. | C UI `FileUpload.tsx:157` remove `.tif/.tiff`; C `rasterRouter.ts:48` exige `name.min(2)`. Para `a.tif`, o nome enviado é `a`. | **regressão demonstrável por contrato**, condicionada às validações comuns e ao arquivo aceito pelo baseline; não foi executada. | **Baixo:** entrada TIFF com nome-base de um caractere é rejeitada no novo schema antes da ingestão. | Alinhar derivação/validação de nome e comunicar a restrição ou adotar nome válido. **Não corrigido.** | Arquivo concreto e execução autorizada para afirmar falha real. A incompatibilidade entre a derivação e o mínimo do schema já está demonstrada textualmente. |
| **F2-D — os MIME `image/geotiff` e `application/geotiff` são reconhecidos pela rota, mas barrados no `FileUpload` padrão** | B `FileUpload.tsx:23–38,60–62` e `filesRouter.ts:78–99` não os permitem. | C `FileUpload.tsx:23–40,46,70–71` continua sem os dois; reconhecimento em C `120` só ocorre depois. Painel raster C `RasterIngestionPanel.tsx:10,35–49` e servidor C `rasterRouter.ts:14,45` permitem os três. | Rejeição no componente padrão: **preexistente**. Promessa de cobertura uniforme do novo raster: **novo fluxo/cobertura incompleta**. | **Baixo/médio:** resultado depende do MIME informado pelo navegador e da interface usada. | Alinhar aceitação das entradas entre as interfaces, com política explícita para MIME vazio. **Não corrigido.** | MIME real do navegador e ponto de entrada para alegar incidente. Não há retirada de aceitação padrão desses dois MIME frente ao baseline. |
| **F5 — caminho raster não cria a versão inicial** | B `filesRouter.ts:209–265` não grava versão inicial. B `schema.ts:116,127–140` já tem contador e tabela, mas busca estática não localiza integração de criação no upload. | C genérico `filesRouter.ts:245–256` grava versão; C raster `rasterRouter.ts:56–102` não chama o helper. C `FileList.tsx:27–43,172,212` mostra v1 e histórico para todos os arquivos. | **novo fluxo/cobertura incompleta**; ausência de versão automática no upload baseline também era **preexistente**. Não há regressão baseline raster demonstrada. | **Baixo/médio:** histórico/inventário inicial incompleto e mensagem potencialmente enganosa para raster recém-criado; original continua referenciado. | Integrar criação da versão inicial no raster com ID, hash e referência do original; definir atomicidade/idempotência e tratamento dos registros sem versão. Não confundir isso com mudança de enum. **Não corrigido.** | Para afirmar estado real: consulta autorizada a `file_versions` e exclusão de escritores externos/triggers. Para chamar de regressão: garantia ou fluxo baseline que já criasse versão inicial raster; não encontrado nas fontes examinadas. |

## 4. F1 — prova por fontes e diferença em relação ao baseline

O enum B (`drizzle/schema.ts:97–99`) admite `kml, kmz, shp, pdf, docx, xlsx, image, other`; o C acrescenta `geojson, geotiff`. O novo escritor raster C (`server/rasterRouter.ts:68–72`) grava literalmente `fileType: "geotiff"` e `isGeospatial: true`.

Os diffs pertinentes acrescentam somente GeoJSON aos consumidores:

```diff
# server/db.ts — hunk B -359 / C +386
-      geospatial: ["kml", "kmz", "shp"],
+      geospatial: ["kml", "kmz", "shp", "geojson"],

# server/filesRouter.ts — hunk B -304 / C +348
-          geospatial: ["kml", "kmz", "shp"],
+          geospatial: ["kml", "kmz", "shp", "geojson"],

# client/src/pages/Files.tsx — hunks B -84 / C +84 e B -101 / C +102
       case "shp":
+      case "geojson":
```

Nenhum dos arrays de categorias C inclui `geotiff`: `geospatial` enumera KML/KMZ/SHP/GeoJSON; `document` enumera PDF/DOCX/XLSX; `image` contém só `image`; `other`, só `other`. O global converte essas strings em `IN` (C `db.ts:395–397`), e o endpoint por projeto aplica `includes` (C `filesRouter.ts:357–358`). O badge global usa `default → Outro` (C `Files.tsx:114–115`). **“Outro” como texto de fallback não equivale a normalizar o `fileType` persistido para `other`.** Portanto, o filtro “Outros” não recupera esse rótulo.

“Todas” dispensa o filtro de categoria: C `filesRouter.ts:321–332` envia `undefined` ao helper global, e C `350` evita o filtro da lista por projeto. A inclusão continua subordinada a acesso, busca, paginação e exclusão lógica; não se promete que qualquer arquivo aparecerá na página atual. O badge do `FileList` por projeto usa `isGeospatial` (C `167–171`), não o switch global; por isso não se generaliza o texto “Outro” para toda a UI.

Para uma linha antiga ainda rotulada `image`, o mapa de imagens permaneceu igual. A mudança de **um novo upload TIFF** de `image` no percurso baseline para `geotiff` no percurso raster C muda sua classificação e expõe a lacuna. Isso não prova que a candidata altere automaticamente os registros anteriores. **Novo tipo ainda não contemplado não é, por si só, regressão funcional de linhas antigas.**

## 5. F2 — endpoint genérico, UI atual e regressão contratual condicional

### 5.1 A classificação TIFF genérica é anterior

B `server/filesRouter.ts:92,155–162` e C `96,159–167` aceitam `image/tiff` e terminam na regra `startsWith("image/") → "image"`. O acréscimo à união C é GeoJSON, não GeoTIFF. O dispatcher por extensão B (`fileProcessing.ts:221–258`) e C (`232–269`) não tem caso `tif/tiff`; quando acionado por `category: geospatial`, segue o retorno padrão sem `layerData`. A fórmula de `isGeospatial` B `filesRouter.ts:218` / C `223` também já permitia a categoria de entrada superar o `false` do processamento.

A promoção vetorial C (`vectorLayerPromotion.ts:16–24,33`) exige uma coleção válida e não substitui a ingestão raster. Assim, chamadas diretas ao endpoint genérico podem preservar a divergência semântica, mas **ela não foi introduzida na regra TIFF desse endpoint**.

### 5.2 A candidata não usa o endpoint genérico para TIFF na UI padrão

B `FileUpload.tsx:107–145` escolhia `image` para TIFF e usava exclusivamente `files.upload`. O diff C cria `rasterIngestMutation`, calcula MIME efetivo e troca a chamada por um ternário:

```diff
# client/src/components/FileUpload.tsx — hunk B -132 / C +146
-        const uploadPromise = uploadMutation.mutateAsync({
-          ...
-        });
+        const uploadPromise = isGeoTiff
+          ? rasterIngestMutation.mutateAsync({ /* dados raster */ })
+          : uploadMutation.mutateAsync({ /* upload genérico */ });
```

O trecho é abreviado para evidenciar a decisão; a fonte completa C está em `150–175`. C `120` reconhece `image/tiff`, `image/geotiff` e `application/geotiff`. C `54–60` também passa a inferir `image/tiff` para `.tif/.tiff` com MIME vazio; o baseline padrão o rejeitava. `ProjectDetail.tsx:407–414` monta `FileUpload` sem override de `acceptedTypes`, confirmando o uso da allowlist padrão nesse chamador.

Os dois MIME alternativos permanecem barrados no componente padrão antes do ternário; isso já ocorria no baseline. O painel dedicado é novo e aceita os três, mas sua validação C `RasterIngestionPanel.tsx:35–38` usa `file.type` sem o fallback do `FileUpload`. Essas diferenças são lacunas de integração de entradas, não prova de corrupção ou de regressão genérica para todos os uploads.

### 5.3 Restrição nova de disponibilidade — regressão demonstrável por contrato

Há um contraexemplo estático delimitado: editor/admin com acesso a projeto existente, TIFF seguro de tamanho permitido, storage e banco funcionando, **sem serviço raster configurado**. Não se afirma que esse seja o ambiente real.

1. B `FileUpload.tsx:37,60,121–145` admite MIME `image/tiff` e envia o upload genérico.
2. B `filesRouter.ts:53–100,105–141,155–162,205–265` não exige disponibilidade raster para salvar o original. O sucesso continua condicionado ao scanner, storage, banco e demais validações.
3. C `FileUpload.tsx:120,150–165` envia a mesma classe de entrada exclusivamente ao novo endpoint raster; não há fallback genérico no tratamento de falha.
4. C `rasterIngestionAdapter.ts:31–38` define `available: false` quando não há worker nem modo local explicitamente habilitado. C `rasterRouter.ts:59–60` lança `PRECONDITION_FAILED` **antes** de C `67–72` gravar original/metadados.

A dependência nova está provada no contrato. **Isso é regressão condicional da capacidade anterior de apenas armazenar TIFF pela mesma UI**, não prova de indisponibilidade de produção. Exigir ingestão para todos os TIFF pode ser uma decisão deliberada de produto; sem contrato de aceite que dispense armazenamento genérico, não é correto esconder a diferença sob a afirmação de que só faltou cobertura do tipo novo.

Outro contraexemplo textual é `a.tif`: C `FileUpload.tsx:157` envia `name: "a"`, enquanto C `rasterRouter.ts:48` exige pelo menos dois caracteres. O baseline não tinha esse campo raster obrigatório e seu `filename` era apenas `z.string()` (B `filesRouter.ts:56`). A incompatibilidade está demonstrada independentemente da configuração raster, mas a alegação de upload baseline bem-sucedido permanece condicionada ao arquivo e às validações comuns. Não se executou esse exemplo.

Por fim, um TIFF não georreferenciado anteriormente armazenável também passa a ser direcionado à ingestão. **Falha efetiva por ausência de georreferenciamento não foi provada neste parecer**; não se generaliza a restrição de disponibilidade/nome para afirmar que todo TIFF comum será rejeitado.

## 6. F5 — versão inicial ausente no caminho raster

O baseline já contém `files.currentVersion.default(1)` (B `drizzle/schema.ts:116`) e a tabela `file_versions` (B `127–140`). Porém, B `filesRouter.ts:209–265` salva o arquivo, o localiza, audita e retorna, sem inserir versão. A busca dirigida no baseline por `createFileVersion`, `buildInitialFileVersion`, `fileVersions`, `raster.ingestGeoTiff` e `rasterRouter`, em `server`, `client/src` e `drizzle/schema.ts`, encontra somente a declaração/tipos da tabela e sua importação em `db.ts`. A existência da tabela ou do contador **não prova versão 1 persistida**.

A candidata acrescenta os helpers `db.ts:336–348`, `fileVersioning.ts:1–39`, os endpoints `filesRouter.ts:397–427` e a UI de histórico. O diff do upload genérico inclui:

```diff
# server/filesRouter.ts — hunk B -226 / C +231
+      const versionId = await db.createFileVersion(buildInitialFileVersion({
+        fileId: file.id,
+        s3Key: file.s3Key,
+        s3Url: file.s3Url,
+        /* tamanho, MIME, hash e identificação do original */
+        source: "upload",
+      }));
```

Trecho abreviado; a chamada integral C está em `245–256`. Em contraste, a leitura integral da mutação raster C (`rasterRouter.ts:56–102`) mostra criação do arquivo, da camada, processamento, atualização e auditoria, mas **nenhuma inserção de versão**. A busca dirigida C localiza a chamada de produção apenas no upload genérico. `source: "upload" | "raster-ingestion"` em C `fileVersioning.ts:11` prevê o segundo uso no tipo, mas não o executa.

C `FileList.tsx:172` exibe o contador v1; C `27–43,212` consulta histórico para todo arquivo. C `db.ts:343–348` lê as linhas de `file_versions`, sem sintetizar versão a partir de `currentVersion`. Logo, na ausência de outro escritor, um raster recém-criado por esse caminho pode aparecer com contador v1 e histórico vazio; a mensagem C `FileList.tsx:41` menciona arquivos antigos, apesar de a lacuna também alcançar novos rasters.

A referência do original existe no fluxo C (`rasterRouter.ts:67–72`), e o download normal permanece separado do download de versão. **Histórico incompleto não demonstra perda do original, falha de download, nem alteração de rótulos.** Como o baseline não tinha essa criação automática nem o endpoint raster equivalente, a classificação principal é **novo fluxo/cobertura incompleta**, não regressão de uma garantia baseline retirada.

## 7. Encaminhamento e controle de escopo

O parecer não autoriza ampliar a implementação F4. **F1, F2 e F5 permanecem explicitamente não corrigidos**, inclusive as diferenças contratuais F2-B/F2-C. Eventual correção deve ter autorização e entrega próprias, com decisão sobre compatibilidade do upload TIFF, taxonomia e versionamento, sem misturar esses temas ao contrato do exportador de backup.

A leitura estática é suficiente para registrar os mapas incompletos, o roteamento da UI, as novas restrições de entrada e a ausência de chamada de versionamento no raster. Não é suficiente para atestar ocorrência real, integridade dos dados live ou aprovação global da candidata. O resultado é: **F1 e F5 são lacunas do novo fluxo; F2 genérico é preexistente, mas a substituição da rota TIFF na UI introduz perdas condicionais de compatibilidade demonstráveis pelo contrato.**
