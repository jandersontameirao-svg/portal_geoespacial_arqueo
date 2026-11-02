import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { MeasureOptions } from "leaflet-measure";
import "leaflet-measure/dist/leaflet-measure.css";
import { toast } from "sonner";

// leaflet-measure registers L.Control.Measure as a side effect. Its module
// export is not the control constructor (CommonJS/ESM wrappers vary).
type LeafletWithMeasure = typeof L & {
  Control: typeof L.Control & {
    Measure?: new (options?: MeasureOptions) => L.Control;
  };
};

interface MeasurementEvent extends L.LeafletEvent {
  area?: number;
  areaDisplay?: string;
  lengthDisplay?: string;
}

export default function MeasurementTools() {
  const map = useMap();

  useEffect(() => {
    let disposed = false;
    let control: L.Control | undefined;
    const onStart = () => toast.info("Clique no mapa para começar a medir");
    const onFinish = (event: MeasurementEvent) => {
      const display = event.area && event.area > 0
        ? event.areaDisplay
        : event.lengthDisplay;
      if (display) toast.success(`${event.area && event.area > 0 ? "Área" : "Distância"}: ${display}`);
    };

    void import("leaflet-measure").then(() => {
      if (disposed) return;
      const Control = (L as LeafletWithMeasure).Control.Measure;
      if (typeof Control !== "function") {
        throw new Error("O plugin de medição não registrou L.Control.Measure");
      }
      control = new Control({
        position: "topleft",
        primaryLengthUnit: "meters",
        secondaryLengthUnit: "kilometers",
        primaryAreaUnit: "sqmeters",
        secondaryAreaUnit: "hectares",
        activeColor: "#3b82f6",
        completedColor: "#10b981",
        captureZIndex: 10000,
        popupOptions: {
          className: "leaflet-measure-resultpopup",
          autoPanPadding: [10, 10],
        },
        decPoint: ",",
        thousandsSep: ".",
      });
      map.addControl(control);
      map.on("measurestart", onStart);
      map.on("measurefinish", onFinish);
    }).catch(() => {
      if (!disposed) toast.error("Não foi possível iniciar a medição. As demais ferramentas do mapa permanecem disponíveis.");
    });

    return () => {
      disposed = true;
      map.off("measurestart", onStart);
      map.off("measurefinish", onFinish);
      if (control) map.removeControl(control);
    };
  }, [map]);

  return null;
}
