/**
 * MARKER CLUSTER GROUP COMPONENT
 * 
 * Wrapper para leaflet.markercluster compatível com React Leaflet v4
 */

import { createPathComponent } from "@react-leaflet/core";
import L from "leaflet";
import "leaflet.markercluster";

interface MarkerClusterGroupProps extends L.MarkerClusterGroupOptions {
  children: React.ReactNode;
}

const MarkerClusterGroup = createPathComponent<
  L.MarkerClusterGroup,
  MarkerClusterGroupProps
>(
  ({ children: _c, ...props }, ctx: any) => {
    const clusterProps: L.MarkerClusterGroupOptions = {};
    const clusterEvents: Record<string, any> = {};

    // Separar props de eventos
    Object.entries(props).forEach(([propName, prop]) => {
      if (propName.startsWith("on")) {
        clusterEvents[propName] = prop;
      } else {
        (clusterProps as any)[propName] = prop;
      }
    });

    // Criar cluster group
    const markerClusterGroup = L.markerClusterGroup(clusterProps);

    // Adicionar eventos
    Object.entries(clusterEvents).forEach(([eventAsProp, callback]) => {
      const event = eventAsProp.substring(2).toLowerCase();
      markerClusterGroup.on(event, callback);
    });

    return {
      instance: markerClusterGroup,
      context: { ...ctx, layerContainer: markerClusterGroup },
    };
  }
);

export default MarkerClusterGroup;
