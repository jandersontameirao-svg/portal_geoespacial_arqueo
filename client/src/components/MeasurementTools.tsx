import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-measure/dist/leaflet-measure.css";
import { Button } from "./ui/button";
import { Ruler, Square as SquareIcon } from "lucide-react";
import { toast } from "sonner";

export default function MeasurementTools() {
  const map = useMap();
  const [measureControl, setMeasureControl] = useState<any>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  
  useEffect(() => {
    // Importar dinamicamente leaflet-measure
    import("leaflet-measure").then((module) => {
      const Control = (module as any).default || module;
      
      const control = new Control({
        position: "topleft",
        primaryLengthUnit: "meters", // UTM usa metros como padrão
        secondaryLengthUnit: "kilometers",
        primaryAreaUnit: "sqmeters", // UTM usa m² como padrão
        secondaryAreaUnit: "hectares",
        activeColor: "#3b82f6",
        completedColor: "#10b981",
        captureZIndex: 10000,
        popupOptions: {
          className: "leaflet-measure-resultpopup",
          autoPanPadding: [10, 10],
        },
        decPoint: ",", // Padrão brasileiro
        thousandsSep: ".", // Padrão brasileiro
      });
      
      map.addControl(control);
      setMeasureControl(control);
      
      // Eventos de medição
      map.on("measurestart", () => {
        setIsMeasuring(true);
        toast.info("Clique no mapa para começar a medir");
      });
      
      map.on("measurefinish", (e: any) => {
        setIsMeasuring(false);
        const result = e.result;
        if (result) {
          const message = result.area
            ? `Área: ${result.area.toFixed(2)} ${result.areaUnit}`
            : `Distância: ${result.length.toFixed(2)} ${result.lengthUnit}`;
          toast.success(message);
        }
      });
      
      return () => {
        if (control) {
          map.removeControl(control);
        }
      };
    });
  }, [map]);
  
  return null; // O controle é adicionado diretamente ao mapa
}
