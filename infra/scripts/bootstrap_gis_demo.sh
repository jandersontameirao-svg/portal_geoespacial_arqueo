#!/bin/bash

# ===================================
# Bootstrap GIS Demo - Sprint A
# ===================================
# Este script inicializa o ambiente GIS demo:
# 1. Cria arquivo .env.gis a partir do .env.gis.example
# 2. Sobe os serviços Docker
# 3. Aguarda serviços ficarem saudáveis
# 4. Valida GetCapabilities do QGIS Server
# 5. Exibe URLs e comandos úteis

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Bootstrap GIS Demo - Sprint A${NC}"
echo -e "${BLUE}  Grupo Arqueo - Portal Geoespacial${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}❌ docker-compose is not installed. Please install it and try again.${NC}"
    exit 1
fi

# Determine docker compose command
if docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

echo -e "${GREEN}✅ Docker Compose is available${NC}"
echo ""

# Create .env.gis if it doesn't exist
if [ ! -f .env.gis ]; then
    echo -e "${YELLOW}📝 Creating .env.gis from .env.gis.example...${NC}"
    cp .env.gis.example .env.gis
    echo -e "${GREEN}✅ .env.gis created${NC}"
    echo -e "${YELLOW}⚠️  Please review .env.gis and update passwords if needed${NC}"
    echo ""
else
    echo -e "${GREEN}✅ .env.gis already exists${NC}"
    echo ""
fi

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
$DOCKER_COMPOSE -f docker-compose.gis.yml --env-file .env.gis down || true
echo ""

# Start services
echo -e "${YELLOW}🚀 Starting GIS services...${NC}"
$DOCKER_COMPOSE -f docker-compose.gis.yml --env-file .env.gis up -d

echo ""
echo -e "${YELLOW}⏳ Waiting for services to become healthy...${NC}"
echo -e "${BLUE}This may take 1-2 minutes on first run (downloading images)${NC}"
echo ""

# Wait for PostGIS
echo -n "Waiting for PostGIS... "
for i in {1..60}; do
    if docker exec arqueo_postgis pg_isready -U gis_user -d arqueo_gis > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Wait for Redis
echo -n "Waiting for Redis... "
for i in {1..30}; do
    if docker exec arqueo_redis redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Wait for QGIS Server
echo -n "Waiting for QGIS Server... "
for i in {1..60}; do
    if curl -sf http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 3
done

# Wait for Worker
echo -n "Waiting for Worker... "
for i in {1..30}; do
    if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ GIS Environment Ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Validate GetCapabilities
echo -e "${BLUE}📋 Validating QGIS Server...${NC}"
if curl -sf "http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities" | grep -q "demo_municipios"; then
    echo -e "${GREEN}✅ GetCapabilities OK - Layer 'demo_municipios' found${NC}"
else
    echo -e "${YELLOW}⚠️  GetCapabilities responded but layer 'demo_municipios' not found${NC}"
    echo -e "${YELLOW}   This may be normal if the database is still initializing${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Service URLs${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "PostGIS:      ${GREEN}localhost:5432${NC}"
echo -e "              Database: arqueo_gis"
echo -e "              User: gis_user"
echo -e ""
echo -e "QGIS Server:  ${GREEN}http://localhost:8080/ows${NC}"
echo -e "              GetCapabilities: ${BLUE}http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities${NC}"
echo -e ""
echo -e "Redis:        ${GREEN}localhost:6379${NC}"
echo -e ""
echo -e "Worker:       ${GREEN}http://localhost:3001/health${NC}"
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Useful Commands${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "View logs:           ${YELLOW}$DOCKER_COMPOSE -f docker-compose.gis.yml logs -f${NC}"
echo -e "Stop services:       ${YELLOW}$DOCKER_COMPOSE -f docker-compose.gis.yml down${NC}"
echo -e "Restart services:    ${YELLOW}$DOCKER_COMPOSE -f docker-compose.gis.yml restart${NC}"
echo -e "Check health:        ${YELLOW}$DOCKER_COMPOSE -f docker-compose.gis.yml ps${NC}"
echo -e ""
echo -e "Connect to PostGIS:  ${YELLOW}docker exec -it arqueo_postgis psql -U gis_user -d arqueo_gis${NC}"
echo -e "Connect to Redis:    ${YELLOW}docker exec -it arqueo_redis redis-cli${NC}"
echo -e ""
echo -e "Test GetCapabilities: ${YELLOW}curl 'http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities'${NC}"
echo -e "Test GetMap:          ${YELLOW}curl 'http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=demo_municipios&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:4674&WIDTH=800&HEIGHT=600&BBOX=-49.5,-20.2,-43.7,-15.5' -o test_map.png${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Next Steps${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "1. Open the portal at ${BLUE}http://localhost:3000${NC}"
echo -e "2. Navigate to the map viewer"
echo -e "3. Enable 'Camada Demo (WMS)' in the layers panel"
echo -e "4. You should see the demo municipalities on the map"
echo ""
echo -e "${BLUE}Happy mapping! 🗺️${NC}"
