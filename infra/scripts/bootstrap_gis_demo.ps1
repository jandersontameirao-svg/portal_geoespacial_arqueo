# ===================================
# Bootstrap GIS Demo - Sprint A (Windows)
# ===================================
# Este script inicializa o ambiente GIS demo no Windows:
# 1. Cria arquivo .env.gis a partir do .env.gis.example
# 2. Sobe os serviços Docker
# 3. Aguarda serviços ficarem saudáveis
# 4. Valida GetCapabilities do QGIS Server
# 5. Exibe URLs e comandos úteis

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  Bootstrap GIS Demo - Sprint A" -ForegroundColor Blue
Write-Host "  Grupo Arqueo - Portal Geoespacial" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

# Check if docker-compose is available
$dockerComposeCmd = $null
try {
    docker compose version | Out-Null
    $dockerComposeCmd = "docker compose"
    Write-Host "✅ Docker Compose is available" -ForegroundColor Green
} catch {
    try {
        docker-compose version | Out-Null
        $dockerComposeCmd = "docker-compose"
        Write-Host "✅ Docker Compose is available" -ForegroundColor Green
    } catch {
        Write-Host "❌ docker-compose is not installed. Please install it and try again." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Create .env.gis if it doesn't exist
if (-not (Test-Path .env.gis)) {
    Write-Host "📝 Creating .env.gis from .env.gis.example..." -ForegroundColor Yellow
    Copy-Item .env.gis.example .env.gis
    Write-Host "✅ .env.gis created" -ForegroundColor Green
    Write-Host "⚠️  Please review .env.gis and update passwords if needed" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "✅ .env.gis already exists" -ForegroundColor Green
    Write-Host ""
}

# Stop existing containers
Write-Host "🛑 Stopping existing containers..." -ForegroundColor Yellow
& $dockerComposeCmd -f docker-compose.gis.yml --env-file .env.gis down 2>$null
Write-Host ""

# Start services
Write-Host "🚀 Starting GIS services..." -ForegroundColor Yellow
& $dockerComposeCmd -f docker-compose.gis.yml --env-file .env.gis up -d

Write-Host ""
Write-Host "⏳ Waiting for services to become healthy..." -ForegroundColor Yellow
Write-Host "This may take 1-2 minutes on first run (downloading images)" -ForegroundColor Blue
Write-Host ""

# Wait for PostGIS
Write-Host "Waiting for PostGIS... " -NoNewline
for ($i = 1; $i -le 60; $i++) {
    try {
        docker exec arqueo_postgis pg_isready -U gis_user -d arqueo_gis 2>$null | Out-Null
        Write-Host "✅" -ForegroundColor Green
        break
    } catch {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }
}

# Wait for Redis
Write-Host "Waiting for Redis... " -NoNewline
for ($i = 1; $i -le 30; $i++) {
    try {
        docker exec arqueo_redis redis-cli ping 2>$null | Out-Null
        Write-Host "✅" -ForegroundColor Green
        break
    } catch {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }
}

# Wait for QGIS Server
Write-Host "Waiting for QGIS Server... " -NoNewline
for ($i = 1; $i -le 60; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities" -UseBasicParsing -TimeoutSec 3 2>$null
        if ($response.StatusCode -eq 200) {
            Write-Host "✅" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 3
    }
}

# Wait for Worker
Write-Host "Waiting for Worker... " -NoNewline
for ($i = 1; $i -le 30; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 3 2>$null
        if ($response.StatusCode -eq 200) {
            Write-Host "✅" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ GIS Environment Ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Validate GetCapabilities
Write-Host "📋 Validating QGIS Server..." -ForegroundColor Blue
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities" -UseBasicParsing
    if ($response.Content -match "demo_municipios") {
        Write-Host "✅ GetCapabilities OK - Layer 'demo_municipios' found" -ForegroundColor Green
    } else {
        Write-Host "⚠️  GetCapabilities responded but layer 'demo_municipios' not found" -ForegroundColor Yellow
        Write-Host "   This may be normal if the database is still initializing" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Could not validate GetCapabilities" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  Service URLs" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host "PostGIS:      " -NoNewline; Write-Host "localhost:5432" -ForegroundColor Green
Write-Host "              Database: arqueo_gis"
Write-Host "              User: gis_user"
Write-Host ""
Write-Host "QGIS Server:  " -NoNewline; Write-Host "http://localhost:8080/ows" -ForegroundColor Green
Write-Host "              GetCapabilities: " -NoNewline; Write-Host "http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities" -ForegroundColor Blue
Write-Host ""
Write-Host "Redis:        " -NoNewline; Write-Host "localhost:6379" -ForegroundColor Green
Write-Host ""
Write-Host "Worker:       " -NoNewline; Write-Host "http://localhost:3001/health" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  Useful Commands" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host "View logs:           " -NoNewline; Write-Host "$dockerComposeCmd -f docker-compose.gis.yml logs -f" -ForegroundColor Yellow
Write-Host "Stop services:       " -NoNewline; Write-Host "$dockerComposeCmd -f docker-compose.gis.yml down" -ForegroundColor Yellow
Write-Host "Restart services:    " -NoNewline; Write-Host "$dockerComposeCmd -f docker-compose.gis.yml restart" -ForegroundColor Yellow
Write-Host "Check health:        " -NoNewline; Write-Host "$dockerComposeCmd -f docker-compose.gis.yml ps" -ForegroundColor Yellow
Write-Host ""
Write-Host "Connect to PostGIS:  " -NoNewline; Write-Host "docker exec -it arqueo_postgis psql -U gis_user -d arqueo_gis" -ForegroundColor Yellow
Write-Host "Connect to Redis:    " -NoNewline; Write-Host "docker exec -it arqueo_redis redis-cli" -ForegroundColor Yellow
Write-Host ""
Write-Host "Test GetCapabilities: " -NoNewline; Write-Host "Invoke-WebRequest 'http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetCapabilities'" -ForegroundColor Yellow
Write-Host "Test GetMap:          " -NoNewline; Write-Host "Invoke-WebRequest 'http://localhost:8080/ows?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=demo_municipios&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:4674&WIDTH=800&HEIGHT=600&BBOX=-49.5,-20.2,-43.7,-15.5' -OutFile test_map.png" -ForegroundColor Yellow
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Next Steps" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "1. Open the portal at " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor Blue
Write-Host "2. Navigate to the map viewer"
Write-Host "3. Enable 'Camada Demo (WMS)' in the layers panel"
Write-Host "4. You should see the demo municipalities on the map"
Write-Host ""
Write-Host "Happy mapping! 🗺️" -ForegroundColor Blue
