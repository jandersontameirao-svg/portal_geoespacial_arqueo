import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

type Props = {
  featureGroup: L.FeatureGroup;
  draw: L.Control.DrawOptions;
  position?: L.ControlPosition;
  onCreated?: (event: L.DrawEvents.Created) => void;
  onEdited?: (event: L.DrawEvents.Edited) => void;
  onDeleted?: (event: L.DrawEvents.Deleted) => void;
};

/**
 * Adaptador fino para Leaflet.draw UMD. Mantém a instância no mesmo FeatureGroup
 * usado pelo React-Leaflet, evitando toolbar duplicada e listeners vazando em remount.
 */
export default function LeafletDrawControl({ featureGroup, draw, position = "topleft", onCreated, onEdited, onDeleted }: Props) {
  const map = useMap();
  const callbacks = useRef({ onCreated, onEdited, onDeleted });
  callbacks.current = { onCreated, onEdited, onDeleted };

  useEffect(() => {
    const control = new L.Control.Draw({ position, draw, edit: { featureGroup, edit: {}, remove: true } });
    const created: L.LeafletEventHandlerFn = (event) => {
      const drawEvent = event as L.DrawEvents.Created;
      featureGroup.addLayer(drawEvent.layer);
      callbacks.current.onCreated?.(drawEvent);
    };
    const edited: L.LeafletEventHandlerFn = (event) => callbacks.current.onEdited?.(event as L.DrawEvents.Edited);
    const deleted: L.LeafletEventHandlerFn = (event) => callbacks.current.onDeleted?.(event as L.DrawEvents.Deleted);
    map.addControl(control);
    map.on(L.Draw.Event.CREATED, created);
    map.on(L.Draw.Event.EDITED, edited);
    map.on(L.Draw.Event.DELETED, deleted);
    return () => {
      map.off(L.Draw.Event.CREATED, created);
      map.off(L.Draw.Event.EDITED, edited);
      map.off(L.Draw.Event.DELETED, deleted);
      map.removeControl(control);
    };
  }, [map, featureGroup, position, draw]);

  return null;
}
