declare module "utm" {
  export interface UTMResult {
    easting: number;
    northing: number;
    zoneNum: number;
    zoneLetter: string;
  }

  export interface LatLonResult {
    latitude: number;
    longitude: number;
  }

  export function fromLatLon(
    latitude: number,
    longitude: number,
    forceZoneNum?: number
  ): UTMResult;

  export function toLatLon(
    easting: number,
    northing: number,
    zoneNum: number,
    zoneLetter: string,
    northern?: boolean
  ): LatLonResult;
}
