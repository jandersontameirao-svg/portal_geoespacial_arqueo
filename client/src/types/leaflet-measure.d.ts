declare module "leaflet-measure" {
  import type * as L from "leaflet";

  export interface MeasureOptions {
    position?: L.ControlPosition;
    primaryLengthUnit?: string;
    secondaryLengthUnit?: string;
    primaryAreaUnit?: string;
    secondaryAreaUnit?: string;
    activeColor?: string;
    completedColor?: string;
    captureZIndex?: number;
    popupOptions?: L.PopupOptions;
    decPoint?: string;
    thousandsSep?: string;
  }
  // Runtime side effect: registers L.Control.Measure on the Leaflet instance.
}
