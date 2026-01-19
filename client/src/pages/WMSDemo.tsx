/**
 * WMS Demo Page - Sprint A
 * 
 * Demonstra o overlay WMS do QGIS Server no Google Maps.
 * Permite controlar visibilidade e opacidade da camada demo.
 */

import { useState } from 'react';
import { MapView } from '@/components/Map';
import { WMSTileOverlay, WMSLayer } from '@/components/WMSTileOverlay';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, Layers, Server } from 'lucide-react';

export default function WMSDemo() {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [layerVisible, setLayerVisible] = useState(true);
  const [layerOpacity, setLayerOpacity] = useState(0.7);
  
  // WMS layer configuration
  const demoLayer: WMSLayer = {
    id: 'demo_municipios',
    name: 'Municípios Demo',
    url: 'http://localhost:8080/ows',
    layers: 'demo_municipios',
    version: '1.3.0',
    format: 'image/png',
    transparent: true,
    crs: 'EPSG:4674', // SIRGAS 2000
    opacity: layerOpacity,
    visible: layerVisible,
  };
  
  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">WMS Demo - Sprint A</h1>
        <p className="text-muted-foreground">
          Demonstração do overlay WMS do QGIS Server integrado ao Google Maps
        </p>
      </div>
      
      <Alert className="mb-6">
        <Info className="h-4 w-4" />
        <AlertTitle>Motor GIS Ativo</AlertTitle>
        <AlertDescription>
          Esta página demonstra a integração entre PostGIS, QGIS Server e Google Maps.
          A camada "Municípios Demo" é servida via WMS pelo QGIS Server rodando em Docker.
        </AlertDescription>
      </Alert>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Map */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Mapa com Overlay WMS
              </CardTitle>
              <CardDescription>
                Camada demo servida pelo QGIS Server (localhost:8080)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[600px] rounded-lg overflow-hidden border">
                <MapView
                  initialCenter={{ lat: -17.5, lng: -46.6 }}
                  initialZoom={7}
                  onMapReady={(mapInstance) => {
                    setMap(mapInstance);
                    // Configure map type
                    mapInstance.setMapTypeId('terrain');
                  }}
                />
                {map && (
                  <WMSTileOverlay
                    map={map}
                    layer={demoLayer}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Controls */}
        <div className="lg:col-span-1 space-y-6">
          {/* Layer Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Controles da Camada</CardTitle>
              <CardDescription>
                Ajuste visibilidade e opacidade
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Visibility Toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="layer-visible" className="flex flex-col gap-1">
                  <span>Visibilidade</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    Mostrar/ocultar camada
                  </span>
                </Label>
                <Switch
                  id="layer-visible"
                  checked={layerVisible}
                  onCheckedChange={setLayerVisible}
                />
              </div>
              
              {/* Opacity Slider */}
              <div className="space-y-2">
                <Label htmlFor="layer-opacity" className="flex flex-col gap-1">
                  <span>Opacidade</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {Math.round(layerOpacity * 100)}%
                  </span>
                </Label>
                <Slider
                  id="layer-opacity"
                  min={0}
                  max={1}
                  step={0.1}
                  value={[layerOpacity]}
                  onValueChange={([value]) => setLayerOpacity(value)}
                  disabled={!layerVisible}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* Layer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Server className="h-4 w-4" />
                Informações WMS
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="font-medium text-muted-foreground">Servidor</div>
                <div className="font-mono text-xs break-all">
                  localhost:8080/ows
                </div>
              </div>
              
              <div>
                <div className="font-medium text-muted-foreground">Camada</div>
                <div className="font-mono text-xs">
                  demo_municipios
                </div>
              </div>
              
              <div>
                <div className="font-medium text-muted-foreground">Versão WMS</div>
                <div className="font-mono text-xs">
                  1.3.0
                </div>
              </div>
              
              <div>
                <div className="font-medium text-muted-foreground">CRS</div>
                <div className="font-mono text-xs">
                  EPSG:4674 (SIRGAS 2000)
                </div>
              </div>
              
              <div>
                <div className="font-medium text-muted-foreground">Formato</div>
                <div className="font-mono text-xs">
                  image/png (transparente)
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Technical Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Detalhes Técnicos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                <strong>PostGIS:</strong> Banco de dados geoespacial com 3 municípios demo (Brasília, Goiânia, BH)
              </p>
              <p>
                <strong>QGIS Server:</strong> Servidor WMS que publica projeto QGIS via HTTP
              </p>
              <p>
                <strong>Google Maps:</strong> Renderiza tiles WMS como overlay transparente
              </p>
              <p>
                <strong>Conversão:</strong> Coordenadas de tile do Google Maps são convertidas para bbox WMS
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Instructions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Como Testar</CardTitle>
          <CardDescription>
            Siga estes passos para validar o motor GIS
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                  1
                </span>
                Iniciar Serviços
              </div>
              <p className="text-sm text-muted-foreground">
                Execute o script de bootstrap para subir PostGIS, QGIS Server, Redis e Worker:
              </p>
              <code className="block text-xs bg-muted p-2 rounded">
                ./infra/scripts/bootstrap_gis_demo.sh
              </code>
            </div>
            
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                  2
                </span>
                Verificar Serviços
              </div>
              <p className="text-sm text-muted-foreground">
                Confirme que todos os serviços estão saudáveis:
              </p>
              <code className="block text-xs bg-muted p-2 rounded">
                docker-compose -f docker-compose.gis.yml ps
              </code>
            </div>
            
            <div className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">
                  3
                </span>
                Visualizar Camada
              </div>
              <p className="text-sm text-muted-foreground">
                Você deve ver 3 polígonos laranjas no mapa representando Brasília, Goiânia e Belo Horizonte.
              </p>
              <p className="text-xs text-muted-foreground">
                Use os controles à direita para ajustar visibilidade e opacidade.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
