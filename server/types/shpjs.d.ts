declare module "shpjs" {
  const shp: (data: ArrayBuffer) => Promise<unknown>;
  export default shp;
}
