/**
 * VISUALIZADOR DE CAMADAS BASE
 * 
 * Componente para visualizar camadas geoespaciais oficiais:
 * - Terras Indígenas (FUNAI)
 * - Terras Quilombolas (INCRA)
 * - Sítios Arqueológicos (IPHAN)
 */

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import MarkerClusterGroup from "@/components/MarkerClusterGroup";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Layers,
  MapPin,
  Loader2,
  Eye,
  EyeOff,
  Info,
  Filter,
  Ruler,
  Download,
} from "lucide-react";
import { BRAZILIAN_STATES, REGIONS } from "@/lib/brazilianStates";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

// Fix para ícones do Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LayerControl {
  id: string;
  name: string;
  source: "funai" | "incra" | "iphan";
  color: string;
  visible: boolean;
  opacity: number;
  data: FeatureCollection | null;
  loading: boolean;
}

// Componente para ajustar bounds do mapa
function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  
  return null;
}

export default function BaseLayersViewer() {
  const [layers, setLayers] = useState<LayerControl[]>([
    {
      id: "funai",
      name: "Terras Indígenas",
      source: "funai",
      color: "#10b981", // green-500
      visible: false,
      opacity: 70,
      data: null,
      loading: false,
    },
    {
      id: "incra",
      name: "Terras Quilombolas",
      source: "incra",
      color: "#a855f7", // purple-500
      visible: false,
      opacity: 70,
      data: null,
      loading: false,
    },
    {
      id: "iphan",
      name: "Sítios Arqueológicos",
      source: "iphan",
      color: "#f59e0b", // amber-500
      visible: false,
      opacity: 70,
      data: null,
      loading: false,
    },
  ]);

  const [bounds, setBounds] = useState<L.LatLngBoundsExpression | null>(null);
  const [selectedState, setSelectedState] = useState<string>("all");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [clusteringEnabled, setClusteringEnabled] = useState<boolean>(true);

  // Query para listar camadas disponíveis
  const { data: availableLayers } = trpc.baseLayers.list.useQuery();

  // Função para carregar dados de uma camada
  const loadLayerData = async (layerId: string) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    // Verificar se camada existe no banco
    const dbLayer = availableLayers?.find((l) => l.source === layer.source);
    if (!dbLayer || !dbLayer.dataUrl) {
      toast.error(`Camada ${layer.name} não está disponível. Baixe-a primeiro na página de Camadas Base.`);
      return;
    }

    // Marcar como carregando
    setLayers((prev) =>
      prev.map((l) =>
        l.id === layerId ? { ...l, loading: true } : l
      )
    );

    try {
      // Baixar GeoJSON do S3
      const response = await fetch(dbLayer.dataUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const geojson: FeatureCollection = await response.json();

      // Calcular bounds
      if (geojson.features.length > 0) {
        const coordinates: [number, number][] = [];
        geojson.features.forEach((feature: Feature) => {
          if (feature.geometry.type === "Point") {
            const [lng, lat] = feature.geometry.coordinates as [number, number];
            coordinates.push([lat, lng]);
          } else if (feature.geometry.type === "Polygon") {
            feature.geometry.coordinates[0].forEach((coord: any) => {
              coordinates.push([coord[1], coord[0]]);
            });
          } else if (feature.geometry.type === "MultiPolygon") {
            feature.geometry.coordinates.forEach((polygon: any) => {
              polygon[0].forEach((coord: any) => {
                coordinates.push([coord[1], coord[0]]);
              });
            });
          }
        });

        if (coordinates.length > 0) {
          setBounds(L.latLngBounds(coordinates));
        }
      }

      // Atualizar estado
      setLayers((prev) =>
        prev.map((l) =>
          l.id === layerId
            ? { ...l, data: geojson, loading: false, visible: true }
            : l
        )
      );

      toast.success(`${layer.name} carregada (${geojson.features.length} features)`);
    } catch (error: any) {
      console.error(`Erro ao carregar ${layer.name}:`, error);
      toast.error(`Erro ao carregar ${layer.name}: ${error.message}`);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === layerId ? { ...l, loading: false } : l
        )
      );
    }
  };

  // Handler para toggle de visibilidade
  const handleToggleVisibility = (layerId: string) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    if (!layer.data && !layer.visible) {
      // Carregar dados se ainda não foram carregados
      loadLayerData(layerId);
    } else {
      // Apenas toggle visibilidade
      setLayers((prev) =>
        prev.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        )
      );
    }
  };

  // Handler para mudança de opacidade
  const handleOpacityChange = (layerId: string, opacity: number) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === layerId ? { ...l, opacity } : l
      )
    );
  };

  // Função para filtrar features por estado/região
  const filterFeatures = (data: FeatureCollection): FeatureCollection => {
    if (selectedState === "all" && selectedRegion === "all") {
      return data;
    }

    const filtered: FeatureCollection = {
      ...data,
      features: data.features.filter((feature) => {
        const props = feature.properties;
        if (!props) return false;

        // Tentar extrair UF de diferentes propriedades
        const uf = props.uf || props.UF || props.sigla_uf || props.cd_geocuf;

        // Filtro por estado específico
        if (selectedState !== "all") {
          return uf === selectedState;
        }

        // Filtro por região
        if (selectedRegion !== "all") {
          const state = BRAZILIAN_STATES.find((s) => s.uf === uf);
          return state?.region === selectedRegion;
        }

        return true;
      }),
    };

    return filtered;
  };

  // Estilo para features
  const getFeatureStyle = (layer: LayerControl) => {
    return (feature?: Feature<Geometry, any>) => {
      const baseStyle = {
        color: layer.color,
        weight: 2,
        opacity: layer.opacity / 100,
        fillColor: layer.color,
        fillOpacity: (layer.opacity / 100) * 0.3,
      };

      // Estilo específico para pontos (sítios arqueológicos)
      if (feature?.geometry.type === "Point") {
        return {
          ...baseStyle,
          radius: 6,
        };
      }

      return baseStyle;
    };
  };

  // Handler para clique em feature
  const onEachFeature = (layer: LayerControl) => {
    return (feature: Feature, leafletLayer: L.Layer) => {
      if (feature.properties) {
        const props = feature.properties;
        let content = `<div class="p-2"><strong>${layer.name}</strong><br/>`;
        
        // Propriedades específicas por camada
        if (layer.source === "funai") {
          content += `<strong>Nome:</strong> ${props.terrai_nom || "—"}<br/>`;
          content += `<strong>Etnia:</strong> ${props.etnia_nome || "—"}<br/>`;
          content += `<strong>Situação:</strong> ${props.fase_ti || "—"}<br/>`;
        } else if (layer.source === "incra") {
          content += `<strong>Nome:</strong> ${props.nm_comunid || props.nome || "—"}<br/>`;
          content += `<strong>Município:</strong> ${props.municipio || "—"}<br/>`;
          content += `<strong>UF:</strong> ${props.uf || "—"}<br/>`;
        } else if (layer.source === "iphan") {
          content += `<strong>Nome:</strong> ${props.identificacao_bem || "—"}<br/>`;
          content += `<strong>Código:</strong> ${props.co_iphan || "—"}<br/>`;
          content += `<strong>Tipo:</strong> ${props.ds_classificacao || "—"}<br/>`;
          content += `<strong>Município:</strong> ${props.no_logradouro || "—"}<br/>`;
        }
        
        content += `</div>`;
        leafletLayer.bindPopup(content);
      }
    };
  };

  return (
    <div className="container py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Visualizador de Camadas Base</h1>
        <p className="text-muted-foreground">
          Visualize terras indígenas, quilombolas e sítios arqueológicos no mapa
        </p>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-6">
        {/* Painel de controle */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-5 h-5" />
                <h3 className="font-semibold">Filtros Geográficos</h3>
              </div>

              {/* Filtro por Região */}
              <div className="space-y-2 mb-4">
                <label className="text-sm font-medium">Região</label>
                <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todas as regiões" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as regiões</SelectItem>
                    {REGIONS.map((region) => (
                      <SelectItem key={region} value={region}>
                        {region}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro por Estado */}
              <div className="space-y-2 mb-4">
                <label className="text-sm font-medium">Estado (UF)</label>
                <Select value={selectedState} onValueChange={setSelectedState}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos os estados" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os estados</SelectItem>
                    {BRAZILIAN_STATES.map((state) => (
                      <SelectItem key={state.uf} value={state.uf}>
                        {state.uf} - {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Toggle de Clustering */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">Clustering</label>
                  <p className="text-xs text-muted-foreground">
                    Agrupar marcadores próximos
                  </p>
                </div>
                <Checkbox
                  checked={clusteringEnabled}
                  onCheckedChange={(checked) => setClusteringEnabled(checked === true)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-5 h-5" />
                <h3 className="font-semibold">Camadas</h3>
              </div>

              {layers.map((layer) => (
                <div key={layer.id} className="space-y-3 pb-4 border-b last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={layer.visible}
                        onCheckedChange={() => handleToggleVisibility(layer.id)}
                        disabled={layer.loading}
                      />
                      <div
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="text-sm font-medium">{layer.name}</span>
                    </div>
                    {layer.loading && (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {layer.visible && layer.data && (
                    <div className="space-y-2 ml-6">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Opacidade</span>
                        <span>{layer.opacity}%</span>
                      </div>
                      <Slider
                        value={[layer.opacity]}
                        onValueChange={([value]) => handleOpacityChange(layer.id, value)}
                        min={0}
                        max={100}
                        step={10}
                        className="w-full"
                      />
                      <div className="text-xs text-muted-foreground">
                        {(() => {
                          const filtered = filterFeatures(layer.data!);
                          const total = layer.data.features.length;
                          const shown = filtered.features.length;
                          return shown < total
                            ? `${shown.toLocaleString()} de ${total.toLocaleString()} features`
                            : `${total.toLocaleString()} features`;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Clique no checkbox para carregar e visualizar cada camada. Use o slider para
                  ajustar a transparência. Clique nas features para ver detalhes.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Mapa */}
        <Card>
          <CardContent className="p-0">
            <MapContainer
              center={[-15.7801, -47.9292]} // Brasília
              zoom={4}
              style={{ height: "calc(100vh - 200px)", width: "100%" }}
              className="rounded-lg"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Renderizar camadas visíveis */}
              {layers
                .filter((l) => l.visible && l.data)
                .map((layer) => {
                  const filteredData = filterFeatures(layer.data!);
                  const isPointLayer = layer.id === "iphan";
                  const useCluster = isPointLayer && clusteringEnabled;

                  const geoJsonElement = (
                    <GeoJSON
                      key={`${layer.id}-${selectedState}-${selectedRegion}-${clusteringEnabled}`}
                      data={filteredData}
                      style={getFeatureStyle(layer)}
                      onEachFeature={onEachFeature(layer)}
                      pointToLayer={(feature, latlng) => {
                        return L.circleMarker(latlng, {
                          radius: 6,
                          fillColor: layer.color,
                          color: layer.color,
                          weight: 2,
                          opacity: layer.opacity / 100,
                          fillOpacity: (layer.opacity / 100) * 0.6,
                        });
                      }}
                    />
                  );

                  return useCluster ? (
                    <MarkerClusterGroup
                      key={`cluster-${layer.id}-${selectedState}-${selectedRegion}`}
                      chunkedLoading
                      maxClusterRadius={50}
                      spiderfyOnMaxZoom
                      showCoverageOnHover={false}
                      zoomToBoundsOnClick
                    >
                      {geoJsonElement}
                    </MarkerClusterGroup>
                  ) : (
                    geoJsonElement
                  );
                })}

              {/* Ajustar bounds quando camada é carregada */}
              {bounds && <FitBounds bounds={bounds} />}
            </MapContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
