# Integração da Atena na prévia

Implementação e validação desta rodada: Codex.

- `previa-local.config.mts`: o chat chama `atena.previewPlan`, mostra os parâmetros e envia `atena.previewRun` após confirmação. O download passa pelo mesmo endpoint usado pela área de mapa ou arquivos.
- `previa-local-fluxos.mts`: resolve camadas pelo projeto, valida parâmetros, calcula buffer e malha e grava os resultados como GeoJSON. A malha usa uma grade métrica UTM e conserva apenas pontos dentro do polígono. A malha triangular alterna o deslocamento entre linhas. A prévia usa interpretação por regras locais.
- `previa-exportar-vetor.mts`: converte GeoJSON com GDAL/ogr2ogr e entrega o Shapefile compactado com seus arquivos auxiliares.
- `previa-raster/angicos/prancha.mts`: projeta camadas em UTM 24S, compõe mapa, legenda e escala em milímetros e desenha o PDF A2. No atlas, as dimensões do quadro e a escala definem a distância entre centros. A sobreposição aproxima os centros sem alterar a escala comum. As folhas são numeradas da esquerda para a direita e de norte a sul.

Para o ambiente próprio, portar as operações para o servidor da aplicação, com autenticação e autorização por projeto. Substituir o armazenamento JSON da prévia pelo banco e pelo armazenamento de arquivos do ambiente. Configurar GDAL no servidor e expor operações com parâmetros validados à API do modelo. O modelo interpreta o pedido e prepara os argumentos. O servidor calcula as geometrias, produz os arquivos e verifica as permissões. Configurar o identificador de um modelo disponível na conta da API no momento da implantação.

Em commits de portabilidade, identificar a autoria com `Implementado por: Codex` no corpo da mensagem e registrar o fluxo alterado, os testes executados e as limitações verificadas.
