-- ===================================
-- Inicialização do Banco Demo
-- ===================================

-- Habilitar extensão PostGIS (já vem habilitada na imagem postgis/postgis, mas garantir)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Criar schema demo
CREATE SCHEMA IF NOT EXISTS demo;

-- Criar tabela de municípios demo
CREATE TABLE IF NOT EXISTS demo.municipios (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    codigo_ibge VARCHAR(7),
    uf VARCHAR(2),
    area_km2 NUMERIC(10, 2),
    populacao INTEGER,
    geom GEOMETRY(MultiPolygon, 4674), -- SIRGAS 2000 (EPSG:4674)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Criar índice espacial
CREATE INDEX IF NOT EXISTS idx_municipios_geom ON demo.municipios USING GIST (geom);

-- Inserir polígono demo (município fictício em Brasília-DF)
-- Coordenadas aproximadas de um quadrado ao redor de Brasília
INSERT INTO demo.municipios (name, codigo_ibge, uf, area_km2, populacao, geom)
VALUES (
    'Brasília Demo',
    '5300108',
    'DF',
    5802.04,
    3055149,
    ST_Multi(ST_GeomFromText('POLYGON((
        -47.95 -15.70,
        -47.95 -15.85,
        -47.80 -15.85,
        -47.80 -15.70,
        -47.95 -15.70
    ))', 4674))
);

-- Inserir mais alguns polígonos demo para visualização
INSERT INTO demo.municipios (name, codigo_ibge, uf, area_km2, populacao, geom)
VALUES (
    'Goiânia Demo',
    '5208707',
    'GO',
    739.49,
    1555626,
    ST_Multi(ST_GeomFromText('POLYGON((
        -49.35 -16.60,
        -49.35 -16.75,
        -49.20 -16.75,
        -49.20 -16.60,
        -49.35 -16.60
    ))', 4674))
);

INSERT INTO demo.municipios (name, codigo_ibge, uf, area_km2, populacao, geom)
VALUES (
    'Belo Horizonte Demo',
    '3106200',
    'MG',
    331.40,
    2521564,
    ST_Multi(ST_GeomFromText('POLYGON((
        -44.05 -19.85,
        -44.05 -20.00,
        -43.90 -20.00,
        -43.90 -19.85,
        -44.05 -19.85
    ))', 4674))
);

-- Criar view para facilitar consultas
CREATE OR REPLACE VIEW demo.v_municipios AS
SELECT 
    id,
    name,
    codigo_ibge,
    uf,
    area_km2,
    populacao,
    ST_AsText(geom) as geom_wkt,
    ST_AsGeoJSON(geom) as geom_geojson,
    ST_SRID(geom) as srid,
    ST_Area(geom::geography) / 1000000 as area_calculada_km2,
    geom
FROM demo.municipios;

-- Grant permissions
GRANT USAGE ON SCHEMA demo TO PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA demo TO PUBLIC;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA demo TO PUBLIC;

-- Log de sucesso
DO $$
BEGIN
    RAISE NOTICE 'Demo database initialized successfully!';
    RAISE NOTICE 'Schema: demo';
    RAISE NOTICE 'Table: demo.municipios';
    RAISE NOTICE 'Records inserted: %', (SELECT COUNT(*) FROM demo.municipios);
END $$;
