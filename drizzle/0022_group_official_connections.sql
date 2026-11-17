-- Restaura a organização das camadas oficiais por grupo (trabalho do update do
-- Codex). Define o grupo das fontes já seedadas (0019) e insere as fontes
-- oficiais que faltavam (fundiário INCRA/SIGEF, ANEEL, FUNAI, quilombolas INCRA),
-- todas desligadas por padrão — o usuário liga no painel "Camadas do mapa".

UPDATE `map_connections` SET `groupKey` = 'cavidades' WHERE `name` = 'ICMBio/CECAV · Cavidades (CANIE)';
--> statement-breakpoint
UPDATE `map_connections` SET `groupKey` = 'uso-solo' WHERE `name` = 'MapBiomas Brasil · Cobertura do solo 2024';
--> statement-breakpoint
UPDATE `map_connections` SET `groupKey` = 'recursos-hidricos' WHERE `name` IN ('ANA · Trechos de drenagem', 'ANA · Bacias, águas e monitoramento');
--> statement-breakpoint
UPDATE `map_connections` SET `groupKey` = 'patrimonio-estadual' WHERE `name` IN ('SP · Condephaat (patrimônio estadual)', 'MG · IEPHA (patrimônio estadual)', 'RS · IPHAE (patrimônio estadual)');
--> statement-breakpoint
INSERT INTO `map_connections` (`name`, `type`, `address`, `layer`, `enabled`, `groupKey`, `createdByName`) VALUES
('INCRA via Ibama · Imóveis rurais privados (SIGEF)', 'ArcGIS REST', 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/lim_imovel_sigef_privado_a/MapServer', '9', 0, 'fundiario', 'Fontes oficiais'),
('INCRA via Ibama · Imóveis rurais públicos (SIGEF)', 'ArcGIS REST', 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/lim_imovel_sigef_publico_a/MapServer', '10', 0, 'fundiario', 'Fontes oficiais'),
('INCRA via Ibama · Assentamentos rurais', 'ArcGIS REST', 'https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/assentamentos_incra/MapServer', '1', 0, 'fundiario', 'Fontes oficiais'),
('ANEEL · Linhas de transmissão (GGT)', 'ArcGIS REST', 'https://sigel.aneel.gov.br/arcgis/rest/services/GGT/Dados_WebApp_GGT/MapServer', '0', 0, 'infraestrutura-eletrica', 'Fontes oficiais'),
('FUNAI/CMR · Terras indígenas', 'WMS', 'https://cmr.funai.gov.br/geoserver/ows', 'CMR-PUBLICO:lim_terra_indigena_a', 0, NULL, 'Fontes oficiais'),
('INCRA · Territórios quilombolas (via Ibama)', 'ArcGIS REST', 'https://pamgia.ibama.gov.br/server/rest/services/BasesSincronizadas/lim_quilombos_incra_a/MapServer', '0', 0, NULL, 'Fontes oficiais');
