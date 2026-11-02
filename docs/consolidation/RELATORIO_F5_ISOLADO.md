# F5 — versão inicial do arquivo no caminho raster

**Data:** 02/11/2026. **Autorização:** implementar F5 somente no ambiente isolado. **Resultado:** F5 implementado para novas ingestões; sete casos integrados e dois testes de regressão do helper aprovados. Não houve publicação ou operação em stage/produção.

## 1. Identidade e preservação

| Referência | Valor |
|---|---|
| Base F1/F2 preservada | `7886350d9fec7e7eaebeb4f82cca0a428516f1ab` |
| Código funcional F1/F2 que permanece na ancestralidade | `3b5e0f03160c84279671f7e764ff0dc7ce9d25a1` |
| **Código funcional F5** | **`97ff97bc0ba421cc851c1a9bac05b29e5ae12250`** |
| Cópia exclusiva | `/home/ubuntu/atena_geoportal_f5_isolado` |
| Branch local | `candidato/f5-raster-initial-version` |
| Baseline produtivo, não alterado | `04e64773d0c2a9b4cb25fa7f4d1015646fb11091` |

Foi criado e verificado um Git bundle recuperável privado de F1/F2 antes da edição; SHA-256 do bundle: `b805bab6db4cb8367b3dfdd7c510fc2a8e33df19adebf0fc649a690f260eead7`. O bundle não é compartilhado no pacote sanitizado. Fontes e pacotes F1/F2, F4, f7bf75e e fcbc5aa permanecem preservados. O manifesto externo do complemento distingue o commit funcional acima do checkpoint posterior de evidências; não existe SHA de deployment desta rodada porque não houve deploy.

## 2. Defeito e contrato implementado

No baseline F1/F2, `raster.ingestGeoTiff` armazenava o original, criava `files`, procurava o registro por uma listagem do projeto e iniciava camada/processamento. Não havia criação de `file_versions` nesse caminho. O upload genérico já possuía versão inicial, mas isso não atendia F5.

A alteração funcional limita-se a **`server/db.ts` e `server/rasterRouter.ts`**. O helper existente `buildInitialFileVersion` foi reutilizado sem mudança. Foram acrescentados um teste integrado e um executor descartável; não houve alteração de schema/migration, dependência, lockfile, autenticação, storage gerenciado ou UI.

### Fluxo novo

| Etapa | Comportamento |
|---|---|
| Validação e scanner | Contratos e autorização existentes, inalterados |
| Storage do original | Mesma chave única e mesmos bytes; implementação gerenciada inalterada |
| Transação SQL | `files` e `file_versions(version=1)` são confirmados juntos por `createRasterFileWithInitialVersion` |
| Identificação | ID obtido no insert e leitura pelo ID na transação; retirada a busca por listagem/find |
| Versão inicial | Chave/URL, MIME, tamanho, usuário e hash do scanner correspondem ao **original**, `source=raster-ingestion` |
| Camada e worker | Somente iniciados depois do commit de arquivo + versão |
| COG derivado | Continua nos metadados raster, com chave/hash distintos; não substitui a versão 1 |
| Resultado/auditoria | Campos adicionais `versionId` e `version: 1`; campos anteriores preservados |

A versão inicial reaproveita o mesmo objeto do upload, sem duplicação no storage. `metadata.immutableReference=true` descreve a referência estável; **não é certificação de WORM ou imutabilidade imposta pelo storage remoto**. As rotas existentes `files.versions` e `files.downloadVersion` passam a encontrar a versão do raster sem endpoint novo.

### Atomicidade e falhas

Se a criação da versão falhar, a transação desfaz também o registro de arquivo. Não são criados camada, auditoria de ingestão ou artefatos raster. Não existe transação distribuída com o storage: o objeto enviado **antes** da transação SQL pode permanecer sem referência. Nenhuma remoção automática foi implementada, inclusive no teste de erro. A identificação de órfãos e eventual limpeza requer política própria, sem autorização implícita para exclusão de objetos reais.

Se o arquivo/versão já foram confirmados e o worker rejeitar o raster, o original e exatamente uma versão inicial são preservados. O erro segue sendo devolvido; a camada fica `failed`, invisível e fora da listagem de mapas. **Não se declara ingestão concluída apenas porque há versão inicial.** O status preexistente do arquivo pode permanecer `metadata.rasterIngestion.status=processing` nessa falha; isso foi observado e registrado, sem correção silenciosa fora do escopo F5.

## 3. Execução realmente realizada

| Verificação | Resultado | Fronteira da prova |
|---|---:|---|
| `rasterInitialVersion.synthetic.test.ts` | **7/7 casos aprovados** | Routers, banco/driver/ORM, scanner e processamento GDAL reais locais |
| `fileVersioning.test.ts` | **2/2 aprovados** | Regressão pura do helper existente, não dois casos integrados novos |
| **Vitest dirigido** | **9/9, 2 arquivos** | Não é repetição nem substituição dos 112 históricos |
| TypeScript funcional e com o teste novo | Aprovados | Sem emissão, ambiente limpo |
| Build | Aprovado | Offline; avisos preexistentes não equivalem a falha |
| Cleanup conclusivo | Exit 0; datadir/socket/volume temporários removidos | Amostras sintéticas selecionadas foram preservadas fora da raiz descartável |

Engine: **MySQL `8.0.46-0ubuntu0.24.04.4`**, tabelas InnoDB, Drizzle/mysql2 instalados da base, sem mudança de dependências. **Não há mocks de banco, Drizzle, mysql2, scanner, adaptador raster, worker ou GDAL.** A única substituição é `storage` no arquivo de teste, gravando bytes reais em filesystem temporário com `flag: wx`, de modo que uma colisão não esconda sobrescrita.

Os callers tRPC usam contextos sintéticos; não houve App, login, cookie, sessão, bypass ou teste OAuth. Os downloads conferem o retorno dos procedimentos e os bytes locais correspondentes; não houve teste de entrega HTTP, URL assinada ou storage gerenciado.

## 4. Evidências por caso

| Caso integrado | Prova obtida |
|---|---|
| 1 — Sucesso com raster válido | Uma versão 1 do original, scanner/hash, tamanho/MIME/nome/usuário, relação SQL arquivo-versão-camada, resposta sem campos do driver, COG/tiles reais distintos do original, leitura/download e negativas entre projetos |
| 2 — Falha real TIFF no worker | Original e versão preservados; camada `failed`/invisível; erro retornado e nenhuma nova saída raster |
| 3 — Mesmo nome concorrente | Dois uploads com bytes distintos, IDs/chaves independentes e uma versão por arquivo; nenhum original sobrescrito; falha TIFF real evita processar outro COG desnecessário |
| 4 — Erro real de insert da versão | Trigger local `SIGNAL SQLSTATE 45000`; erro Drizzle/mysql2 e rollback das contagens; objeto pré-enviado preservado e explicitamente identificado como órfão sintético |
| 5 — Acesso negado | Client, não membro, não autenticado, projeto inexistente e outro projeto; nenhuma escrita storage/SQL/raster |
| 6 — Scanner real | Assinatura MZ rejeitada antes de qualquer objeto/versão/camada |
| 7 — Validações | Tamanho divergente, limite de 100 MiB, MIME inválido e zoom invertido rejeitados antes da persistência |

O caso 4 criou e removeu o trigger **somente no schema vazio sintético `geoportal_f5`**, após guardas de caminho/socket/schema. Não implica suporte a triggers na edição TiDB Serverless e não os introduz no aplicativo. A aplicação usa uma transação MySQL convencional; TiDB/Serverless não foram reensaiados nesta rodada.

### Amostras válidas e hashes completos

O primeiro caso processou uma cena **exclusivamente sintética**, gerada pelo script já existente. Não são imagens/clientes reais nem fixtures vazias. As amostras abaixo e os dois `gdalinfo.json` constam no complemento para revisão após o cleanup.

| Propriedade | Original | Derivado |
|---|---|---|
| Formato | GeoTIFF GTiff válido, não COG | COG válido |
| CRS | EPSG:4326 | EPSG:4674 |
| Dimensões | 2048 × 2048 | 2048 × 2048 |
| Tamanho | 587179 bytes | 377166 bytes |
| SHA-256 | `db63d16649f634da5fb4bce1984b14dc431b033c4a7761a33e2ae948e8bf0f92` | `7de383d180b4ff57ff5ae3696a03302c8e3c7148406ec6a4a086343e361a7d8e` |

A versão 1 guarda **o primeiro hash**, não o hash do COG. O pipeline gerou **16 tiles PNG XYZ no zoom 12**, com assinatura PNG, contagem, pirâmides/overviews e NoData verificados. Esses resultados validam a integração F5 entre versão original e processamento local; **não homologam Atlas/visualização/UI autenticada completa nem volume produtivo**.

### Contagens da prova de rollback

| Tabela | Antes da falha forçada | Depois |
|---|---:|---:|
| files | 4 | 4 |
| file_versions | 4 | 4 |
| layers | 4 | 4 |
| audit_logs | 16 | 16 |

Erro observado: `ER_SIGNAL_EXCEPTION`, SQLSTATE `45000`, propagado como erro interno de tRPC. Nenhum novo artefato raster foi criado; o trigger foi removido e sua ausência confirmada. O objeto sintético órfão ficou preservado durante a observação; apenas depois foi descartado junto com a raiz integral do ensaio, por cleanup autorizado de fixtures, não por uma função de exclusão do produto.

## 5. Isolamento, incidente de preparação e reprodução

O executor `infra/scripts/run_raster_f5_validation.sh` exige namespace de rede privado, somente loopback e ausência de rota externa. Foi chamado via `sudo unshare --net`, `env -i`, sem credenciais/API externas. O MySQL usa `--skip-networking --mysqlx=OFF`, apenas socket Unix; o teste exige exatamente `/tmp/atena-f5.*/mysql-data/mysql.sock`, schema `geoportal_f5` vazio, diretórios sem symlink e modo raster `direct-local` com volume temporário. DDL/migrations ocorreram **apenas como bootstrap do banco sintético**; nenhum arquivo SQL foi modificado e nada foi aplicado em stage/produção.

**Tentativa 1 preservada:** migrações locais passaram, mas a geração da fixture parou antes de Vitest porque NumPy 2 de `/usr/local` era incompatível com o GDAL do sistema. O banco foi limpo, exit 1. Não foi falha de F5 nem teste aprovado. O executor passou a exportar `PYTHONNOUSERSITE=1`, `PYTHONPATH=/usr/lib/python3/dist-packages`, `PROJ_NETWORK=OFF`, usando módulos compatíveis já instalados. Não houve instalação/downgrade de pacotes, configuração gerenciada ou mudança de pipeline.

**Tentativa 2 conclusiva:** preparação, nove testes e cleanup passaram. A execução durou cerca de dez segundos no Vitest; somente uma ingestão GDAL bem-sucedida foi necessária. Logs brutos privados foram preservados; cópias de logs do complemento têm apenas ANSI/espaços finais sanitizados, sem alteração dos resultados ou JSONs da prova.

Para reproduzir na worktree com dependências já existentes, escolher uma pasta **nova** de evidências:

```bash
SAFE_PATH="$(dirname "$(command -v pnpm)"):/usr/local/bin:/usr/bin:/bin"
sudo unshare --net -- sh -c \
  'ip link set lo up; exec sudo -u ubuntu env -i HOME=/home/ubuntu PATH="$1" CI=1 F5_EVIDENCE_DIR="$2" bash infra/scripts/run_raster_f5_validation.sh' \
  sh "$SAFE_PATH" /caminho/absoluto/novo/f5-evidence
```

Não usar esse executor em host produtivo nem substituir os guardas para apontar a banco/storage reais. A porta TCP do MySQL não é usada. Credenciais/sessões produtivas, `.env` reais, dumps, objetos de clientes e URLs assinadas não são parte desta entrega.

## 6. Diff, revisão e rollback preservando escritas

| Artefato | SHA-256 |
|---|---|
| `F5_INCREMENTAL_CODE.diff` | `fa9bb30941b5ffd4db2c1059fb17a2cf2ede125ecd50b950b4ae30225130e53d` |
| `F5_INCREMENTAL_CODE.patch` | `42209dc4944af996c51ebceb0182782564bab3b10b40c7f1060c45b05e28a7e2` |

São incrementais da base `7886350…` até o código `97ff97b…`, exportados sem ANSI. Ambos passaram em `git apply --check` na worktree F1/F2 preservada **sem aplicar o patch**. O pacote contém também diff completo com documentação/evidências e hashes por arquivo.

Não há down-migration F5. Uma reversão **local de código** pode selecionar F1/F2 anterior, preservando tabelas, arquivos e versões já gravadas, sem restaurar dump por cima de escritas posteriores. A versão anterior deixará de criar versões para **novas** ingestões raster, embora leia as versões que já existem; isso é retorno da limitação F5 e precisa ser reconhecido em qualquer decisão futura de rollback. Nenhuma reversão de produção foi feita. Isso não certifica o baseline produtivo completo executando sobre schema GIS novo; esse gate amplo continua pendente.

## 7. Escopo concluído e limites remanescentes

**F5 local concluído para novas ingestões:** a versão inicial existe antes do processamento, referencia o original verificado e permanece se o worker falhar; falha de persistência da versão não deixa arquivo SQL sem versão. Não há backfill de rasters anteriores, edição de dados reais ou criação de versões 2+; um novo upload sem alvo de substituição gera novo arquivo, conforme contrato existente.

Continuam fora desta entrega: atomicidade distribuída/storage remoto e política de órfãos; correção do status preexistente `processing` em arquivo cujo worker falhou; entrega HTTP/download remoto e OAuth; TiDB Serverless; UI/Atlas/globo integral autenticados; rollback amplo com schema novo. Não houve reteste visual desnecessário porque nenhuma UI foi modificada.

A comprovação do stage continua dependente do extrato administrativo sem efeitos de domínio/SHA/Auto-Publish, banco do deployment, namespace/propriedade storage e callbacks/origens OAuth. Nada foi reconsultado ou configurado nesta rodada. Os 11 objetos não foram dispensados/excluídos e os módulos Atena PR8 permanecem preservados para fase própria. Publicação permanece bloqueada.
