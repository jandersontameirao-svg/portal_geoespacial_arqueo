import { useMapEvents } from "react-leaflet";

interface MapEventsHandlerProps {
  onMouseMove: (lat: number, lng: number) => void;
}

export function MapEventsHandler({ onMouseMove }: MapEventsHandlerProps) {
  useMapEvents({
    mousemove: (e) => {
      onMouseMove(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}
