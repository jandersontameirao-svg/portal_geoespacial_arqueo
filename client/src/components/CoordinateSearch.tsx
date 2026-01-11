import { useState } from "react";
import * as utm from "utm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search, X } from "lucide-react";
import { toast } from "sonner";

interface CoordinateSearchProps {
  onNavigate: (lat: number, lng: number) => void;
}

export function CoordinateSearch({ onNavigate }: CoordinateSearchProps) {
  const [searchValue, setSearchValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const parseAndNavigate = () => {
    if (!searchValue.trim()) {
      toast.error("Digite coordenadas para buscar");
      return;
    }

    try {
      // Tentar parsear como UTM (formato: 23K 500000 8000000 ou 23 K 500000 8000000)
      const utmMatch = searchValue.match(/(\d{1,2})\s*([A-Z])\s+([\d.]+)\s+([\d.]+)/i);
      if (utmMatch) {
        const zoneNum = parseInt(utmMatch[1]);
        const zoneLetter = utmMatch[2].toUpperCase();
        const easting = parseFloat(utmMatch[3]);
        const northing = parseFloat(utmMatch[4]);

        const result = utm.toLatLon(easting, northing, zoneNum, zoneLetter);
        onNavigate(result.latitude, result.longitude);
        toast.success(`Navegando para ${zoneNum}${zoneLetter} ${easting.toFixed(0)}E ${northing.toFixed(0)}N`);
        setSearchValue("");
        setIsOpen(false);
        return;
      }

      // Tentar parsear como Lat/Long (formato: -15.7801, -47.9292)
      const latLngMatch = searchValue.match(/([-+]?[\d.]+)\s*,\s*([-+]?[\d.]+)/);
      if (latLngMatch) {
        const lat = parseFloat(latLngMatch[1]);
        const lng = parseFloat(latLngMatch[2]);

        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          onNavigate(lat, lng);
          toast.success(`Navegando para ${lat.toFixed(6)}°, ${lng.toFixed(6)}°`);
          setSearchValue("");
          setIsOpen(false);
          return;
        }
      }

      toast.error("Formato inválido. Use: 23K 500000 8000000 ou -15.7801, -47.9292");
    } catch (error) {
      console.error("Erro ao parsear coordenadas:", error);
      toast.error("Erro ao processar coordenadas");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      parseAndNavigate();
    }
  };

  return (
    <div className="relative">
      {!isOpen ? (
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="bg-white/90 hover:bg-white shadow-lg"
          title="Buscar por Coordenadas"
        >
          <Search className="w-5 h-5" />
        </Button>
      ) : (
        <div className="bg-white/95 backdrop-blur-sm shadow-lg rounded-lg p-3 w-80">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold">Buscar Coordenadas</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6"
              onClick={() => {
                setIsOpen(false);
                setSearchValue("");
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <Input
            placeholder="23K 500000 8000000 ou -15.7801, -47.9292"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="mb-2"
            autoFocus
          />
          <div className="flex gap-2">
            <Button onClick={parseAndNavigate} size="sm" className="flex-1">
              Buscar
            </Button>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            <div><strong>UTM:</strong> 23K 500000 8000000</div>
            <div><strong>Lat/Long:</strong> -15.7801, -47.9292</div>
          </div>
        </div>
      )}
    </div>
  );
}
