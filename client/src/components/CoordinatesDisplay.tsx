import { useEffect, useState } from "react";
import * as utm from "utm";
import { Card } from "@/components/ui/card";

interface CoordinatesDisplayProps {
  lat: number;
  lng: number;
  utmZone?: number;
}

export function CoordinatesDisplay({ lat, lng, utmZone }: CoordinatesDisplayProps) {
  const [utmCoords, setUtmCoords] = useState<{ easting: number; northing: number; zone: number; letter: string } | null>(null);

  useEffect(() => {
    try {
      const result = utm.fromLatLon(lat, lng, utmZone);
      setUtmCoords({
        easting: Math.round(result.easting),
        northing: Math.round(result.northing),
        zone: result.zoneNum,
        letter: result.zoneLetter,
      });
    } catch (error) {
      console.error("Erro ao converter para UTM:", error);
      setUtmCoords(null);
    }
  }, [lat, lng, utmZone]);

  return (
    <Card className="absolute bottom-4 left-4 z-[1000] bg-white/95 backdrop-blur-sm shadow-lg p-3 text-sm">
      <div className="space-y-1">
        <div className="font-semibold text-xs text-gray-500 uppercase">Coordenadas</div>
        
        {/* UTM (Padrão) */}
        {utmCoords && (
          <div className="space-y-0.5">
            <div className="font-mono text-sm">
              <span className="font-semibold">UTM:</span> {utmCoords.zone}{utmCoords.letter}
            </div>
            <div className="font-mono text-xs text-gray-600">
              E: {utmCoords.easting.toLocaleString("pt-BR")} m
            </div>
            <div className="font-mono text-xs text-gray-600">
              N: {utmCoords.northing.toLocaleString("pt-BR")} m
            </div>
          </div>
        )}

        {/* Lat/Long (Secundário) */}
        <div className="pt-2 border-t border-gray-200">
          <div className="font-mono text-xs text-gray-500">
            Lat: {lat.toFixed(6)}°
          </div>
          <div className="font-mono text-xs text-gray-500">
            Lng: {lng.toFixed(6)}°
          </div>
        </div>
      </div>
    </Card>
  );
}
