/**
 * WMS Tile Overlay Component
 * 
 * Renders WMS layers from QGIS Server as tile overlays on Google Maps.
 * Converts Google Maps tile coordinates to WMS GetMap bbox requests.
 * 
 * Sprint A - Motor GIS
 */

import { useEffect, useRef } from 'react';

export interface WMSLayer {
  id: string;
  name: string;
  url: string;
  layers: string;
  version?: '1.1.1' | '1.3.0';
  format?: string;
  transparent?: boolean;
  crs?: string;
  opacity?: number;
  visible?: boolean;
}

interface WMSTileOverlayProps {
  map: google.maps.Map | null;
  layer: WMSLayer;
}

/**
 * Convert Google Maps tile coordinates to geographic bounds
 * @param x Tile X coordinate
 * @param y Tile Y coordinate
 * @param zoom Zoom level
 * @returns Geographic bounds [minLon, minLat, maxLon, maxLat]
 */
function tileToLatLngBounds(x: number, y: number, zoom: number): [number, number, number, number] {
  const n = Math.pow(2, zoom);
  
  // Convert tile coordinates to longitude/latitude
  const minLon = (x / n) * 360 - 180;
  const maxLon = ((x + 1) / n) * 360 - 180;
  
  const minLatRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
  const maxLatRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  
  const minLat = (minLatRad * 180) / Math.PI;
  const maxLat = (maxLatRad * 180) / Math.PI;
  
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Build WMS GetMap URL for a tile
 */
function buildWMSUrl(layer: WMSLayer, x: number, y: number, zoom: number, tileSize: number = 256): string {
  const [minLon, minLat, maxLon, maxLat] = tileToLatLngBounds(x, y, zoom);
  
  const version = layer.version || '1.3.0';
  const format = layer.format || 'image/png';
  const transparent = layer.transparent !== false;
  const crs = layer.crs || 'EPSG:4674'; // SIRGAS 2000 padrão
  
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: version,
    LAYERS: layer.layers,
    STYLES: '',
    FORMAT: format,
    TRANSPARENT: transparent ? 'TRUE' : 'FALSE',
    WIDTH: tileSize.toString(),
    HEIGHT: tileSize.toString(),
  });
  
  // WMS 1.3.0 uses CRS and axis order lat,lon for EPSG:4326
  // WMS 1.1.1 uses SRS and axis order lon,lat
  if (version === '1.3.0') {
    params.set('CRS', crs);
    
    // For EPSG:4326 in WMS 1.3.0, axis order is lat,lon
    if (crs === 'EPSG:4326') {
      params.set('BBOX', `${minLat},${minLon},${maxLat},${maxLon}`);
    } else {
      // For other CRS (like EPSG:4674), use lon,lat
      params.set('BBOX', `${minLon},${minLat},${maxLon},${maxLat}`);
    }
  } else {
    // WMS 1.1.1 always uses lon,lat
    params.set('SRS', crs);
    params.set('BBOX', `${minLon},${minLat},${maxLon},${maxLat}`);
  }
  
  return `${layer.url}?${params.toString()}`;
}

/**
 * Custom ImageMapType for WMS layers
 */
class WMSImageMapType implements google.maps.MapType {
  tileSize: google.maps.Size;
  maxZoom: number;
  minZoom: number;
  name: string | null;
  alt: string | null;
  projection: google.maps.Projection | null;
  radius: number;
  opacity: number;
  private layer: WMSLayer;
  
  constructor(layer: WMSLayer) {
    this.layer = layer;
    this.tileSize = new google.maps.Size(256, 256);
    this.maxZoom = 20;
    this.minZoom = 0;
    this.name = layer.name;
    this.alt = `WMS Layer: ${layer.name}`;
    this.projection = null; // Use default projection
    this.radius = 6378137; // Earth radius in meters (WGS84)
    this.opacity = layer.opacity ?? 1.0;
  }
  
  getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): HTMLElement {
    const div = ownerDocument.createElement('div');
    div.style.width = '256px';
    div.style.height = '256px';
    div.style.opacity = this.opacity.toString();
    
    const img = ownerDocument.createElement('img');
    img.style.width = '256px';
    img.style.height = '256px';
    img.style.display = 'block';
    
    const url = buildWMSUrl(this.layer, coord.x, coord.y, zoom);
    img.src = url;
    
    // Handle errors gracefully
    img.onerror = () => {
      img.style.display = 'none';
      console.warn(`Failed to load WMS tile: ${url}`);
    };
    
    div.appendChild(img);
    return div;
  }
  
  releaseTile(tile: HTMLElement): void {
    // Clean up tile resources
    const img = tile.querySelector('img');
    if (img) {
      img.src = '';
    }
  }
}

/**
 * WMS Tile Overlay Component
 * 
 * Usage:
 * ```tsx
 * <WMSTileOverlay
 *   map={mapInstance}
 *   layer={{
 *     id: 'demo',
 *     name: 'Demo Municipalities',
 *     url: 'http://localhost:8080/ows',
 *     layers: 'demo_municipios',
 *     version: '1.3.0',
 *     crs: 'EPSG:4674',
 *     opacity: 0.7,
 *     visible: true,
 *   }}
 * />
 * ```
 */
export function WMSTileOverlay({ map, layer }: WMSTileOverlayProps) {
  const overlayRef = useRef<WMSImageMapType | null>(null);
  
  useEffect(() => {
    if (!map || !layer.visible) {
      // Remove overlay if map is null or layer is not visible
      if (overlayRef.current) {
        const overlays = map?.overlayMapTypes;
        if (overlays) {
          const index = overlays.getArray().indexOf(overlayRef.current);
          if (index !== -1) {
            overlays.removeAt(index);
          }
        }
        overlayRef.current = null;
      }
      return;
    }
    
    // Create and add overlay
    const overlay = new WMSImageMapType(layer);
    overlayRef.current = overlay;
    map.overlayMapTypes.push(overlay);
    
    // Cleanup on unmount or when dependencies change
    return () => {
      if (overlayRef.current && map) {
        const overlays = map.overlayMapTypes;
        const index = overlays.getArray().indexOf(overlayRef.current);
        if (index !== -1) {
          overlays.removeAt(index);
        }
      }
    };
  }, [map, layer, layer.visible]);
  
  // Update opacity when it changes
  useEffect(() => {
    if (overlayRef.current && layer.opacity !== undefined) {
      overlayRef.current.opacity = layer.opacity;
      // Force refresh by removing and re-adding
      if (map) {
        const overlays = map.overlayMapTypes;
        const index = overlays.getArray().indexOf(overlayRef.current);
        if (index !== -1) {
          overlays.removeAt(index);
          overlays.insertAt(index, overlayRef.current);
        }
      }
    }
  }, [layer.opacity, map]);
  
  return null; // This component doesn't render anything directly
}

export default WMSTileOverlay;
