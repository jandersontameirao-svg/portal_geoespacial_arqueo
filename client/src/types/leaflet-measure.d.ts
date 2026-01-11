declare module "leaflet-measure" {
  import * as L from "leaflet";
  
  export interface MeasureOptions {
    position?: string;
    primaryLengthUnit?: string;
    secondaryLengthUnit?: string;
    primaryAreaUnit?: string;
    secondaryAreaUnit?: string;
    activeColor?: string;
    completedColor?: string;
    captureZIndex?: number;
    popupOptions?: L.PopupOptions;
  }
  
  export class Control extends L.Control {
    constructor(options?: MeasureOptions);
  }
  
  export default Control;
}
