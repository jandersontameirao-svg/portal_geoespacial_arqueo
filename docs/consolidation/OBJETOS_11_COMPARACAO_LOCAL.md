# Verificação cruzada local — 11 objetos referenciados

**Data:** 2026-11-02
**Regra aplicada:** nenhum objeto foi dispensado, excluído, copiado, rebaixado, reprocessado, alterado ou teve sua permissão modificada.

## Método e limite de acesso

Foram consultados somente os nomes, chaves estáveis autorizadas, tamanhos e hashes dos artefatos locais acessíveis nesta tarefa:

- `portal_geoespacial_arqueo`;
- `portal_geoespacial_arqueo_isolated`;
- `atena_geoportal_homologacao_runtime`;
- `atena_prod_candidate_25f89366`;
- export sanitizado do baseline `04e64773`;
- diretório de uploads local acessível;
- pacote sanitizado de pré-release.

A varredura física por nome não encontrou cópia de bytes dos 11 itens. O resultado técnico correto é **inacessível nos workspaces/artefatos locais desta tarefa**. Isso **não prova ausência** no banco ou storage do projeto de homologação, pois o banco/storage proprietário daquele projeto não está montado nem exposto a esta tarefa em modo leitura.

A resposta HTTP 403 da verificação anterior também não é tratada como prova de inexistência. Nenhum acesso foi contornado.

## Resultado individual

| # | Registro estável | Nome original / título completo | Tamanho registrado | Resultado local | Estado de decisão | Próxima prova mínima não intrusiva |
|---:|---|---|---:|---|---|---|
| 1 | `base_layers:1` | Terras Indígenas | não registrado | Nenhum cache/arquivo físico correspondente foi encontrado nos workspaces acessíveis; há apenas referências de código/configuração. | **Inacessível; não dispensado** | Manifesto de cache/storage do outro projeto com chave estável, tamanho e hash ou prova de leitura autorizada. |
| 2 | `base_layers:2` | Terras Quilombolas | não registrado | Nenhum cache/arquivo físico correspondente foi encontrado nos workspaces acessíveis; há apenas referências de código/configuração. | **Inacessível; não dispensado** | Manifesto de cache/storage do outro projeto com chave estável, tamanho e hash ou prova de leitura autorizada. |
| 3 | `base_layers:3` | Sítios Arqueológicos | não registrado | Nenhum cache/arquivo físico correspondente foi encontrado nos workspaces acessíveis; há apenas referências de código/configuração. | **Inacessível; não dispensado** | Manifesto de cache/storage do outro projeto com chave estável, tamanho e hash ou prova de leitura autorizada. |
| 4 | `base_layers:4` | Rodovias Federais | não registrado | Nenhum cache/arquivo físico correspondente foi encontrado nos workspaces acessíveis; há apenas referências de código/configuração. | **Inacessível; não dispensado** | Manifesto de cache/storage do outro projeto com chave estável, tamanho e hash ou prova de leitura autorizada. |
| 5 | `files:1` | `test.kmz` | 411 B | Nenhum arquivo físico com esse nome/chave/tamanho foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de arquivo do outro projeto ou cópia sanitizada de metadados com hash do objeto. |
| 6 | `files:2` | `rodovia_completa.kmz` | 1.117 B | Nenhum arquivo físico com esse nome/chave/tamanho foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de arquivo do outro projeto ou cópia sanitizada de metadados com hash do objeto. |
| 7 | `files:3` | `teste_validacao.kmz` | 696 B | Nenhum arquivo físico com esse nome/chave/tamanho foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de arquivo do outro projeto ou cópia sanitizada de metadados com hash do objeto. |
| 8 | `gis_uploads:2` | `Trecho_Rodoviario.shp.kmz` (`gis-uploads/1/1768240977254-fe9iis-…`) | 224.618 B | Nenhum arquivo físico ou chave estável correspondente foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de storage do outro projeto contendo a chave completa e SHA-256, sem payload. |
| 9 | `gis_uploads:3` | `Trecho_Rodoviario.shp.kmz` (`gis-uploads/1/1768242017737-sk63z2-…`) | 224.618 B | Nenhum arquivo físico ou chave estável correspondente foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de storage do outro projeto contendo a chave completa e SHA-256, sem payload. |
| 10 | `gis_uploads:4` | `Trecho_Rodoviario.shp.kmz` (`gis-uploads/1/1768242026744-tybtw5-…`) | 224.618 B | Nenhum arquivo físico ou chave estável correspondente foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de storage do outro projeto contendo a chave completa e SHA-256, sem payload. |
| 11 | `gis_uploads:30001` | `KMZ Fazenda Bananeira.kmz` (`gis-uploads/1/1768497279050-d2goia-…`) | 819 B | Nenhum arquivo físico ou chave estável correspondente foi encontrado nos workspaces acessíveis. | **Inacessível; não dispensado** | Manifesto de storage do outro projeto contendo a chave completa e SHA-256, sem payload. |

## Relação com o inventário anterior

O inventário pré-release da produção registrou que as 11 leituras por chave retornaram indisponibilidade/403 e que nenhum byte foi copiado para o backup daquela rodada. Este documento **não reclassifica isso como ausência** e não altera registros. Ele apenas confirma que os artefatos locais da linha GIS e da linha de homologação acessíveis aqui não oferecem uma cópia alternativa verificável.

## Pacote mínimo necessário caso a comparação com o outro projeto seja exigida

Sem transportar nenhum dado de cliente, a tarefa proprietária da homologação deve fornecer um pacote sanitizado contendo, por item: `registro`, `nome original`, `chave estável`, `tamanho`, `SHA-256`, `data`, `projeto/camada`, `resultado de HEAD/GET autorizado` e `estado de recuperação`. Não é necessário transportar conteúdo do objeto, `.env`, dump ou URL assinada.

## Significado de uma eventual dispensa futura

Dispensar deve significar **somente uma exceção formal de backup de bytes**, preservando o registro e seus metadados. Não implica apagar, ocultar, alterar status ou liberar permissões. Visualmente, o registro continuará listado, porém download, reabertura e processamento dependentes dos bytes continuarão indisponíveis.
