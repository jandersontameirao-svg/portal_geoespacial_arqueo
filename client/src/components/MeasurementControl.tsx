/**
 * MEASUREMENT CONTROL
 * 
 * Ferramenta para medir distâncias e áreas no mapa
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

interface MeasurementControlProps {
  enabled: boolean;
  mode: "distance" | "area" | null;
  onMeasurementComplete?: (result: { value: number; unit: string }) => void;
}

export default function MeasurementControl({
  enabled,
  mode,
  onMeasurementComplete,
}: MeasurementControlProps) {
  const map = useMap();
  const drawControlRef = useRef<L.Control.Draw | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup>(new L.FeatureGroup());

  useEffect(() => {
    // Adicionar layer de itens desenhados
    const drawnItems = drawnItemsRef.current;
    map.addLayer(drawnItems);

    // Limpar ao desmontar
    return () => {
      map.removeLayer(drawnItems);
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
      }
    };
  }, [map]);

  useEffect(() => {
    if (!enabled || !mode) {
      // Remover controle se desabilitado
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
        drawControlRef.current = null;
      }
      return;
    }

    // Configurar controle de desenho
    const drawControl = new L.Control.Draw({
      position: "topright",
      draw: {
        polyline: mode === "distance" ? {
          shapeOptions: {
            color: "#3b82f6",
            weight: 3,
          },
          metric: true,
          feet: false,
          nautic: false,
        } : false,
        polygon: mode === "area" ? {
          shapeOptions: {
            color: "#10b981",
            weight: 2,
            fillOpacity: 0.2,
          },
          metric: true,
          showArea: true,
        } : false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItemsRef.current,
        remove: true,
      },
    });

    map.addControl(drawControl);
    drawControlRef.current = drawControl;

    // Handler para quando desenho é criado
    const onDrawCreated = (e: any) => {
      const layer = e.layer;
      drawnItemsRef.current.addLayer(layer);

      // Calcular medida
      if (mode === "distance" && layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs() as L.LatLng[];
        let distance = 0;
        for (let i = 0; i < latlngs.length - 1; i++) {
          distance += latlngs[i].distanceTo(latlngs[i + 1]);
        }
        
        const unit = distance > 1000 ? "km" : "m";
        const value = distance > 1000 ? distance / 1000 : distance;
        
        // Adicionar tooltip com medida
        layer.bindTooltip(
          `${value.toFixed(2)} ${unit}`,
          { permanent: true, direction: "center" }
        );
        
        if (onMeasurementComplete) {
          onMeasurementComplete({ value, unit });
        }
      } else if (mode === "area" && layer instanceof L.Polygon) {
        const latlngs = layer.getLatLngs()[0] as L.LatLng[];
        const area = L.GeometryUtil.geodesicArea(latlngs);
        
        const unit = area > 10000 ? "ha" : "m²";
        const value = area > 10000 ? area / 10000 : area;
        
        // Adicionar tooltip com medida
        layer.bindTooltip(
          `${value.toFixed(2)} ${unit}`,
          { permanent: true, direction: "center" }
        );
        
        if (onMeasurementComplete) {
          onMeasurementComplete({ value, unit });
        }
      }
    };

    map.on(L.Draw.Event.CREATED, onDrawCreated);

    return () => {
      map.off(L.Draw.Event.CREATED, onDrawCreated);
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current);
      }
    };
  }, [enabled, mode, map, onMeasurementComplete]);

  return null;
}
