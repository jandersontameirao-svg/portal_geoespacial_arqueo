import * as utm from "utm";

export function formatUTMCoordinates(lat: number, lng: number): string {
  try {
    const result = utm.fromLatLon(lat, lng);
    const easting = Math.round(result.easting);
    const northing = Math.round(result.northing);
    return `${result.zoneNum}${result.zoneLetter} ${easting.toLocaleString("pt-BR")}E ${northing.toLocaleString("pt-BR")}N`;
  } catch (error) {
    return "Coordenadas inválidas";
  }
}

export function getUTMComponents(lat: number, lng: number) {
  try {
    const result = utm.fromLatLon(lat, lng);
    return {
      zone: `${result.zoneNum}${result.zoneLetter}`,
      easting: Math.round(result.easting),
      northing: Math.round(result.northing),
      formatted: formatUTMCoordinates(lat, lng),
    };
  } catch (error) {
    return null;
  }
}
