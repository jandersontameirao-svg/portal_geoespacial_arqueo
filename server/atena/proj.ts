/** Definições de projeção usadas pela Atena. Registradas uma vez no import. */
import proj4 from "proj4";

export const SIRGAS2000_GEOGRAPHIC = "EPSG:4674";
proj4.defs(SIRGAS2000_GEOGRAPHIC, "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs");

export { proj4 };
