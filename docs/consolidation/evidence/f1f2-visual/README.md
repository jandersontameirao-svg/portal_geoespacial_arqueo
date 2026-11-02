# F1/F2 — harness visual offline dos componentes reais

## Resultado

A execução conclusiva `attempt-20261102T201541.889590Z-a0e7b6` passou em **10/10 cenários e 91/91 asserções**. O TypeScript também passou (`typecheck-20261102T201607Z.log`, exit 0). Esses dez cenários são testes visuais/DOM contra APIs simuladas; não devem ser somados como novos testes de persistência, OAuth ou backend.

Componentes importados diretamente, sem cópia, alias substituto ou alteração: `client/src/components/FileUpload.tsx` e `client/src/components/RasterIngestionPanel.tsx`. A política real `shared/tiffUploadPolicy.ts` é usada pelos componentes. SHA-256 antes/depois da execução constam no relatório e ficaram estáveis. Nenhum commit foi criado por este harness.

## Execução reproduzível

Na raiz do checkout, com dependências e Chromium já existentes:

```sh
python3 infra/scripts/run_f1f2_visual_harness.py
```

O executor cria uma pasta de tentativa exclusiva; usa `sudo -n unshare --net`, sobe apenas `lo` com `ip link set lo up`, e inicia o runner com `env -i`. O `VITE_APP_ID` é `synthetic`; os endpoints configurados terminam em `.invalid`. Vite usa `envDir: false`, não carrega dotenv nem plugin runtime Manus. Não há instalação de dependências.

Vite escuta somente em `127.0.0.1:4181`; Chromium CDP somente em `127.0.0.1:9228`. A evidência registra exclusivamente a interface `lo`, tabelas IPv4/IPv6 sem rotas e uma tentativa direta a `1.1.1.1:443` retornando `ENETUNREACH` (errno 101). Os recursos e requisições observados foram loopback ou data URI; nenhuma requisição externa foi observada. O namespace é diferente do namespace do processo chamador, registrado em `launch.json`.

O teste usa eventos DOM `change`, seleção real de modo e cliques CDP nos controles de disponibilidade/rejeição. Os arquivos são criados no navegador com `File` e `DataTransfer`: 13 bytes sintéticos, explicitamente **não são GeoTIFFs válidos**. Nenhum handler interno, função de política ou mutation é chamado diretamente pelo executor.

O runner é finito e finaliza os grupos de processos próprios de Chromium/Vite; na execução conclusiva ambos foram encerrados e o diretório temporário de perfil/cache foi removido (`cleanup` no relatório). O servidor não fica ativo depois da prova.

## APIs simuladas e fronteira da prova

Há `QueryClientProvider` e `trpc.Provider` reais, com um link tRPC **exclusivamente em memória**, sem HTTP link. APIs simuladas declaradas no código e no cabeçalho visual:

- `raster.ingestionAvailability`: retorna uma flag local controlada por checkbox.
- `files.upload`: captura o input e retorna confirmação em memória com `persisted: false`; não grava arquivo algum.
- `raster.ingestGeoTiff`: captura input; rejeita ou retorna confirmação sintética controlada por checkbox; não inicia worker nem gera COG/tiles/hash.

Não há montagem de `App`, fluxo OAuth, provider de autenticação ou bypass do aplicativo. Nenhum usuário, cookie, token ou registro persistente é criado. O painel recebe apenas `projectId=4242` e `canEdit=true` como props sintéticas de teste, não como uma prova de autorização.

**Não comprova storage, banco de dados, scanner, controle de acesso, OAuth, validação real do servidor, ingestão geoespacial, hash, COG ou tiles.** As mensagens de sucesso são as mensagens reais dos componentes diante das respostas simuladas. O cabeçalho dos screenshots deixa esse limite explícito, inclusive quando o painel exibe “COG processado”. Não houve schema/DDL/deploy/stage/prod/segredos.

## Casos executados na tentativa conclusiva

| Caso | Verificação | Asserções | Resultado |
|---|---|---:|---|
| 01-raster-unavailable | Modo raster padrão indisponível bloqueia antes de qualquer mutation; toast de erro e nenhum sucesso | 7 | PASS |
| 02-original-tiff | Modo original explícito funciona com disponibilidade falsa: somente `files.upload`, `image/tiff`, categoria `image` | 9 | PASS |
| 03-original-image-geotiff | `image/geotiff` normaliza para `image/tiff` em original; nenhuma mutation raster | 9 | PASS |
| 04-original-application-geotiff | `application/geotiff` normaliza para `image/tiff` em original; categoria `image` | 9 | PASS |
| 05-original-empty-mime | MIME vazio em `.tif` normaliza para `image/tiff` no modo original | 9 | PASS |
| 06-conflicting-mime-original | `application/x-msdownload` com nome `.tif` é recusado em original sem mutation | 7 | PASS |
| 07-conflicting-mime-raster | O mesmo MIME conflitante é recusado em raster disponível sem mutation | 7 | PASS |
| 08-short-raster-name | `a.tif` em raster disponível envia `name="a.tif"` (>=2) e mantém `filename="a.tif"`; resposta simulada aceita | 11 | PASS |
| 09-raster-rejection-no-fallback | Rejeição raster gera erro real no componente/toast, nenhuma chamada `files.upload`, nenhum DOM/toast de sucesso | 12 | PASS |
| 10-panel-short-empty-mime | `RasterIngestionPanel` real com `a.tif` e MIME vazio envia `image/tiff`, `name="a.tif"`, filename preservado | 11 | PASS |
| **Total** | | **91** | **10/10** |

Para rejeições e bloqueios, o estado é capturado imediatamente após o erro e novamente após **2,6 segundos**. O `onUploadComplete` de `FileUpload` também é chamado pelo componente após a limpeza de uma mutation falha; esse callback **não foi considerado sucesso**. No caso 09, `completionCallbacks` passa de 0 para 1, mas continua sem mutation genérica e sem sucesso DOM/toast. O card de erro transitório é comprovado em `immediate.body` do JSON; o screenshot é capturado depois da janela de observação, quando o card já foi removido e o toast de erro permanece. A ausência de fallback/sucesso é uma observação limitada a essa janela, não uma afirmação sobre tempo ilimitado.

## Arquivos de evidência

- [Relatório conclusivo](attempt-20261102T201541.889590Z-a0e7b6/report.json): contagens, snapshots DOM, todos os inputs capturados, flags, toasts, rede, hashes e cleanup.
- [Log conclusivo](attempt-20261102T201541.889590Z-a0e7b6/runner.log).
- [Screenshot de original normalizado](attempt-20261102T201541.889590Z-a0e7b6/04-original-application-geotiff.png).
- [Screenshot de rejeição raster](attempt-20261102T201541.889590Z-a0e7b6/09-raster-rejection-no-fallback.png).
- [Prova detalhada da rejeição, incluindo erro antes da limpeza](attempt-20261102T201541.889590Z-a0e7b6/09-raster-rejection-no-fallback.json).
- [Screenshot do painel com a.tif e MIME vazio](attempt-20261102T201541.889590Z-a0e7b6/10-panel-short-empty-mime.png).
- `cdp-events.json`, `vite.log`, `chromium.log`, `launch.json` e `exit.json` em cada pasta de tentativa.

Os screenshots foram inspecionados visualmente; o aviso de simulação e os toasts estão legíveis. O browser não reportou exceções JS não tratadas na execução conclusiva.

## Tentativa inicial mantida

`attempt-20261102T201412.747311Z-c2fa29` não foi apagada ou sobrescrita. Nela, seis cenários passaram (50 asserções passaram) e quatro pararam na preparação por erro do **executor**: `Runtime.evaluate` tentou serializar um elemento DOM, excedendo a cadeia de referência. Não foi detectado defeito no componente. A condição do runner foi corrigida para retornar um booleano, e uma tentativa nova foi executada. O relatório inicial permanece com `status="failed"`, quatro diagnósticos `*-failed.json`, screenshots de falha e logs completos. Seus seis passes não são contados novamente nos dez cenários conclusivos.

## Arquivos exclusivos criados

- `client/f1f2-upload-harness.html`
- `client/src/f1f2UploadHarness.tsx`
- `vite.f1f2-harness.config.ts`
- `infra/scripts/run_f1f2_visual_harness.py`
- Esta pasta `docs/consolidation/evidence/f1f2-visual/`

O executor anterior `infra/scripts/run_local_visual_harness.py` foi apenas consultado como referência de CDP e permaneceu intocado. Nenhum arquivo de trabalho do principal/agente F1 foi editado.
