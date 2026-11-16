-- Seed de fontes oficiais verificadas (trazidas do update do Codex) como
-- conexões pré-cadastradas. Desligadas por padrão; o usuário liga no mapa.
-- As WMS renderizam via ConnectionWmsLayers; ArcGIS REST ficam registradas.
INSERT INTO `map_connections` (`name`, `type`, `address`, `layer`, `enabled`, `createdByName`) VALUES
('IPHAN · Sítios arqueológicos (SICG)', 'WMS', 'https://geoserver.iphan.gov.br/geoserver/wms', 'SICG:sitios,SICG:sitios_pol', 0, 'Fontes oficiais'),
('ICMBio/CECAV · Cavidades (CANIE)', 'WMS', 'https://geoservicos.inde.gov.br/geoserver/ICMBio/ows', 'canie_052026_p', 0, 'Fontes oficiais'),
('SP · Condephaat (patrimônio estadual)', 'WMS', 'https://www.idesp.sp.gov.br/geoserver/idesp_acervo/wms', 'idesp_acervo:bem_tomb_a_2025_01_v0', 0, 'Fontes oficiais'),
('MG · IEPHA (patrimônio estadual)', 'WMS', 'https://geoserver.meioambiente.mg.gov.br/ows', 'IDE:ide_2017_mg_tombamento_iepha_pto,IDE:ide_2017_mg_ai_patrimonio_cultural_iepha_pol,IDE:ide_2017_mg_celebracoes_formas_expressao_iepha_pto,IDE:ide_2017_mg_lugares_iepha_pto,IDE:ide_2017_mg_saberes_iepha_pol', 0, 'Fontes oficiais'),
('RS · IPHAE (patrimônio estadual)', 'ArcGIS REST', 'https://iede.rs.gov.br/server/rest/services/CULTURA/', '', 0, 'Fontes oficiais'),
('MapBiomas Brasil · Cobertura do solo 2024', 'ArcGIS REST', 'https://tiles.arcgis.com/tiles/qFQYQQeTXZSPY7Fs/arcgis/rest/services/MapBiomas_Mapas_de_Cobertura_do_Solo/MapServer', '', 0, 'Fontes oficiais'),
('ANA · Trechos de drenagem', 'ArcGIS REST', 'https://www.snirh.gov.br/arcgis/rest/services/IG/Servicos_Base_IG/MapServer', '', 0, 'Fontes oficiais'),
('ANA · Bacias, águas e monitoramento', 'ArcGIS REST', 'https://www.snirh.gov.br/arcgis/rest/services/INDE/Camadas/MapServer', '', 0, 'Fontes oficiais');
