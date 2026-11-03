import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  INDE_CATALOG_LIMITS as LIMITS,
  type IndeMapImageInput,
  type IndeOrganization,
} from "../shared/indeCatalog";
import reviewedOrganizations from "../shared/indeOrganizations.json";
import {
  createIndeCatalogService,
  indeCatalogService,
  parseIndeCapabilities,
  validateIndeMapInput,
  validateIndePng,
} from "./indeCatalogService";

const org: IndeOrganization = {
  id: "synthetic",
  label: "Órgão sintético",
  name: "Órgão sintético",
  level: "Nacional",
  endpoint: "https://wms.example.org/ows",
  eligible: true,
  blocker: null,
};
const date = "2026-11-03T02:00:00.000Z";
const xml = (
  layers = "<Layer><Name>test:layer</Name><Title>A &amp; B &lt;img src=x onerror=alert(1)&gt;</Title><SRS>EPSG:3857</SRS></Layer>"
) =>
  Buffer.from(
    `<?xml version="1.0"?><WMT_MS_Capabilities version="1.1.1"><Capability><Layer><Title>Raiz</Title><SRS>EPSG:4326 EPSG:4674</SRS><LatLonBoundingBox minx="-60" miny="-30" maxx="-30" maxy="10"/>${layers}</Layer></Capability></WMT_MS_Capabilities>`
  );

// Fixture manual, sem download, DTD ou ENTITY; estrutura WMS 1.3.0 com namespace oficial.
const xml130 = (
  layers = "<Layer><Name>test:layer</Name><Title>A &amp; B &lt;img src=x onerror=alert(1)&gt;</Title></Layer>"
) =>
  Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.3.0">
  <Service><Name>WMS</Name><Title>Serviço sintético</Title><OnlineResource xlink:type="simple" xlink:href="https://wms.example.org/ows"/></Service>
  <Capability>
    <Request>
      <GetCapabilities><Format>text/xml</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="https://wms.example.org/ows"/></Get></HTTP></DCPType></GetCapabilities>
      <GetMap><Format>image/png</Format><DCPType><HTTP><Get><OnlineResource xlink:type="simple" xlink:href="https://wms.example.org/ows"/></Get></HTTP></DCPType></GetMap>
    </Request>
    <Exception><Format>XML</Format></Exception>
    <Layer><Title>Raiz sintética</Title><CRS>EPSG:3857</CRS><CRS>EPSG:4326</CRS>
      <EX_GeographicBoundingBox><westBoundLongitude>-60</westBoundLongitude><eastBoundLongitude>-30</eastBoundLongitude><southBoundLatitude>-30</southBoundLatitude><northBoundLatitude>10</northBoundLatitude></EX_GeographicBoundingBox>
      ${layers}
    </Layer>
  </Capability>
</WMS_Capabilities>`);

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const mapInput: IndeMapImageInput = {
  organizationId: org.id,
  layerName: "test:layer",
  bounds: [-180, -90, 180, 90],
  width: 512,
  height: 256,
  crs: "EPSG:4326",
};

describe("INDE capabilities parser", () => {
  it("extracts named descendants with inherited CRS and geographic bounds as plain text", () => {
    const body = xml();
    const result = parseIndeCapabilities(body, org.id, date);
    expect(result).toMatchObject({
      organizationId: org.id,
      version: "1.1.1",
      fetchedAt: date,
      truncated: false,
    });
    expect(result.capabilitySha256).toBe(
      createHash("sha256").update(body).digest("hex")
    );
    expect(result.layers).toEqual([
      {
        name: "test:layer",
        title: "A & B <img src=x onerror=alert(1)>",
        crs: ["EPSG:4326", "EPSG:4674", "EPSG:3857"],
        bounds: { west: -60, south: -30, east: -30, north: 10 },
      },
    ]);
    // No HTML object, renderer, OnlineResource or raw XML is returned to callers.
    expect(Object.keys(result.layers[0]).sort()).toEqual([
      "bounds",
      "crs",
      "name",
      "title",
    ]);
  });
  it("accepts namespace-qualified WMS 1.3.0, preserves its literal version/hash and inherits CRS/EX bounds", () => {
    const body = xml130();
    const result = parseIndeCapabilities(body, org.id, date);
    expect(result).toMatchObject({
      organizationId: org.id,
      version: "1.3.0",
      fetchedAt: date,
      capabilitySha256: createHash("sha256").update(body).digest("hex"),
      truncated: false,
      layers: [
        {
          name: "test:layer",
          title: "A & B <img src=x onerror=alert(1)>",
          crs: ["EPSG:3857", "EPSG:4326"],
          bounds: { west: -60, south: -30, east: -30, north: 10 },
        },
      ],
    });
  });
  it("converts WMS 1.3.0 EPSG:4326 fallback BoundingBox axes to lon/lat, including inherited fallback", () => {
    const body =
      xml130(`<Layer><Title>Grupo</Title><BoundingBox CRS="EPSG:4326" minx="-20" miny="-50" maxx="-10" maxy="-40"/>
      <Layer><Name>fallback</Name><Title>Fallback</Title></Layer>
      <Layer><Name>own</Name><Title>Própria</Title><BoundingBox CRS="EPSG:4326" minx="-15" miny="-48" maxx="-12" maxy="-42"/></Layer></Layer>`);
    const result = parseIndeCapabilities(body, org.id, date);
    expect(result.layers.map(layer => layer.bounds)).toEqual([
      { west: -50, south: -20, east: -40, north: -10 },
      { west: -48, south: -15, east: -42, north: -12 },
    ]);
  });
  it("keeps EX_GeographicBoundingBox and LatLonBoundingBox in lon/lat even on WMS 1.3.0", () => {
    const result = parseIndeCapabilities(
      xml130(`<Layer><Name>ex</Name><Title>EX</Title>
      <EX_GeographicBoundingBox><westBoundLongitude>-52</westBoundLongitude><eastBoundLongitude>-41</eastBoundLongitude><southBoundLatitude>-21</southBoundLatitude><northBoundLatitude>-11</northBoundLatitude></EX_GeographicBoundingBox>
      <BoundingBox CRS="EPSG:4326" minx="-2" miny="-5" maxx="-1" maxy="-4"/></Layer>
      <Layer><Name>latlon</Name><Title>Legado</Title><LatLonBoundingBox minx="-58" miny="-28" maxx="-38" maxy="-8"/></Layer>`),
      org.id,
      date
    );
    expect(result.layers.map(layer => layer.bounds)).toEqual([
      { west: -52, south: -21, east: -41, north: -11 },
      { west: -58, south: -28, east: -38, north: -8 },
    ]);
  });
  it("keeps legacy WMS 1.1.1 SRS BoundingBox in lon/lat without swapping", () => {
    const result = parseIndeCapabilities(
      xml(
        '<Layer><Name>fallback</Name><BoundingBox SRS="EPSG:4326" minx="-50" miny="-20" maxx="-40" maxy="-10"/></Layer>'
      ),
      org.id,
      date
    );
    expect(result.layers[0].bounds).toEqual({
      west: -50,
      south: -20,
      east: -40,
      north: -10,
    });
    expect(result.version).toBe("1.1.1");
  });
  it("handles groups without names, child bbox and SRS overrides/additions", () => {
    const result = parseIndeCapabilities(
      xml(
        '<Layer><SRS>EPSG:3857</SRS><Layer><Name>child</Name><Title>   teste\n nome </Title><LatLonBoundingBox minx="-50" miny="-20" maxx="-40" maxy="-10"/></Layer></Layer>'
      ),
      org.id,
      date
    );
    expect(result.layers[0]).toMatchObject({
      name: "child",
      title: "teste nome",
      crs: ["EPSG:4326", "EPSG:4674", "EPSG:3857"],
      bounds: { west: -50, south: -20, east: -40, north: -10 },
    });
  });
  it.each([
    '<!DOCTYPE WMT_MS_Capabilities SYSTEM "https://internal.invalid/dtd">',
    '<!DOCTYPE WMT_MS_Capabilities [<!ENTITY exploit SYSTEM "file:///etc/passwd">]>',
    '<!ENTITY x "payload">',
  ])(
    "rejects DTD / ENTITY rather than resolving or stripping them: %s",
    declaration => {
      expect(() =>
        parseIndeCapabilities(
          Buffer.concat([Buffer.from(declaration), xml()]),
          org.id,
          date
        )
      ).toThrow(/DTD|ENTITY/);
    }
  );
  it.each([
    '<!DOCTYPE WMS_Capabilities SYSTEM "https://internal.invalid/dtd">',
    '<!DOCTYPE WMS_Capabilities [<!ENTITY exploit SYSTEM "file:///etc/passwd">]>',
    '<!ENTITY x "payload">',
  ])("still rejects DTD/ENTITY on WMS 1.3.0: %s", declaration => {
    expect(() =>
      parseIndeCapabilities(
        Buffer.from(
          xml130()
            .toString()
            .replace("<WMS_Capabilities", `${declaration}<WMS_Capabilities`)
        ),
        org.id,
        date
      )
    ).toThrow(/DTD|ENTITY/);
  });
  it.each([
    "<ServiceExceptionReport><ServiceException>untrusted</ServiceException></ServiceExceptionReport>",
    "<html><body>not WMS</body></html>",
    '<WMS_Capabilities version="1.1.1"><Capability><Layer/></Capability></WMS_Capabilities>',
    '<WMT_MS_Capabilities version="1.1.1"><Capability></WMT_MS_Capabilities>',
    '<WMT_MS_Capabilities version="1.1.1"/>',
  ])(
    "rejects HTTP-200 exception XML, malformed XML, absent hierarchy and wrong version",
    body => {
      expect(() =>
        parseIndeCapabilities(Buffer.from(body), org.id, date)
      ).toThrow();
    }
  );
  it("rejects oversized XML and unsafe layer multi-selection", () => {
    expect(() =>
      parseIndeCapabilities(
        Buffer.alloc(LIMITS.capabilitiesBytes + 1),
        org.id,
        date
      )
    ).toThrow(/8 MiB/);
    expect(() =>
      parseIndeCapabilities(
        xml("<Layer><Name>a,b</Name></Layer>"),
        org.id,
        date
      )
    ).toThrow(/nome/);
  });
  it.each([
    '<WMT_MS_Capabilities version="1.3.0"><Capability><Layer/></Capability></WMT_MS_Capabilities>',
    '<WMS_Capabilities version="1.3.1"><Capability><Layer/></Capability></WMS_Capabilities>',
    '<WMS_Capabilities version="1.3.0"><Capability></WMS_Capabilities>',
    '<WMS_Capabilities version="1.3.0"/>',
  ])(
    "rejects mismatched roots/versions and malformed/absent WMS 1.3 hierarchy: %s",
    body => {
      expect(() =>
        parseIndeCapabilities(Buffer.from(body), org.id, date)
      ).toThrow();
    }
  );
  it.each([xml, xml130])(
    "preserves depth, node-count, unsafe-name and byte guards for both versions",
    fixture => {
      expect(() =>
        parseIndeCapabilities(
          fixture(`${"<Layer>".repeat(130)}${"</Layer>".repeat(130)}`),
          org.id,
          date
        )
      ).toThrow(/limites seguros/);
      expect(() =>
        parseIndeCapabilities(fixture("<x/>".repeat(200_001)), org.id, date)
      ).toThrow(/limites seguros/);
      expect(() =>
        parseIndeCapabilities(
          fixture("<Layer><Name>a,b</Name></Layer>"),
          org.id,
          date
        )
      ).toThrow(/nome/);
      expect(() =>
        parseIndeCapabilities(
          Buffer.concat([fixture(), Buffer.alloc(LIMITS.capabilitiesBytes)]),
          org.id,
          date
        )
      ).toThrow(/8 MiB/);
    }
  );
  it("shows truncation at 1000 unique named layers, not a claimed full list", () => {
    const body = (n: number) =>
      xml(
        Array.from(
          { length: n },
          (_, i) => `<Layer><Name>layer_${i}</Name></Layer>`
        ).join("")
      );
    const truncated = parseIndeCapabilities(body(1001), org.id, date);
    expect(truncated.layers).toHaveLength(1000);
    expect(truncated.truncated).toBe(true);
    expect(parseIndeCapabilities(body(1000), org.id, date).truncated).toBe(
      false
    );
  });
  it("does not inherit invalid geographic bounds and omits absent bounds", () => {
    const body = Buffer.from(
      '<WMT_MS_Capabilities version="1.1.1"><Capability><Layer><Name>a</Name><LatLonBoundingBox minx="-200" miny="-90" maxx="180" maxy="90"/></Layer></Capability></WMT_MS_Capabilities>'
    );
    expect(
      parseIndeCapabilities(body, org.id, date).layers[0].bounds
    ).toBeUndefined();
  });
});

describe("INDE fixed registry and cache", () => {
  it("loads reviewed metadata without probing, uses stable official IDs and keeps HTTP visible but blocked", async () => {
    const transport = vi.fn();
    const service = createIndeCatalogService({
      organizations: reviewedOrganizations,
      transport,
    });
    const listed = service.organizations();
    expect(listed.organizations).toHaveLength(71);
    expect(listed.sourceUrl).toBe(
      "https://visualizador.inde.gov.br/api/buscacamada"
    );
    expect(listed.fetchedAt).toBe(listed.listFetchedAt);
    expect(indeCatalogService.organizations().organizations).toHaveLength(71);
    const blocked = listed.organizations.filter(o =>
      o.endpoint.startsWith("http:")
    );
    expect(blocked).toHaveLength(4);
    for (const item of blocked) {
      expect(item.eligible).toBe(false);
      expect(item.blocker).toMatch(/HTTP/);
      await expect(service.layers(item.id)).rejects.toMatchObject({
        kind: "FORBIDDEN",
      });
    }
    await expect(
      service.layers("https://arbitrary.example.org/ows")
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("requests GetCapabilities 1.3.0 by default but accepts a well-behaved legacy 1.1.1 response without DTD", async () => {
    const transport = vi.fn().mockResolvedValue(xml());
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
    });
    expect((await service.layers(org.id)).version).toBe("1.1.1");
    expect(transport).toHaveBeenCalledWith(
      org.endpoint,
      {
        SERVICE: "WMS",
        VERSION: "1.3.0",
        REQUEST: "GetCapabilities",
      },
      LIMITS.capabilitiesBytes
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("deduplicates pending requests, caches validated XML for 5min, returns copies", async () => {
    let time = Date.parse(date);
    let complete!: (body: Buffer) => void;
    const transport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            complete = resolve;
          })
      )
      .mockResolvedValue(xml());
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
      now: () => time,
    });
    const a = service.layers(org.id);
    const b = service.layers(org.id);
    expect(transport).toHaveBeenCalledTimes(1);
    complete(xml());
    const [first, second] = await Promise.all([a, b]);
    first.layers[0].title = "mutated";
    expect(second.layers[0].title).not.toBe("mutated");
    expect((await service.layers(org.id)).layers[0].title).not.toBe("mutated");
    time += LIMITS.cacheTtlMs - 1;
    await service.layers(org.id);
    expect(transport).toHaveBeenCalledTimes(1);
    time++;
    await service.layers(org.id);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never caches invalid XML nor failed promises", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Buffer.from("<ServiceExceptionReport/>"))
      .mockResolvedValueOnce(xml());
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
    });
    await expect(service.layers(org.id)).rejects.toThrow();
    await expect(service.layers(org.id)).resolves.toMatchObject({
      version: "1.1.1",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("evicts after 80 cached organizations", async () => {
    const organizations = Array.from({ length: 81 }, (_, i) => ({
      ...org,
      id: String(i),
    }));
    const transport = vi.fn().mockResolvedValue(xml());
    const service = createIndeCatalogService({ organizations, transport });
    for (const item of organizations) await service.layers(item.id);
    expect(transport).toHaveBeenCalledTimes(81);
    await service.layers("80");
    expect(transport).toHaveBeenCalledTimes(81);
    await service.layers("0");
    expect(transport).toHaveBeenCalledTimes(82);
  });
  it("does not serialize requests for unrelated organizations", async () => {
    let release!: (body: Buffer) => void;
    const transport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue(xml());
    const service = createIndeCatalogService({
      organizations: [org, { ...org, id: "other" }],
      transport,
    });
    const slow = service.layers(org.id);
    await expect(service.layers("other")).resolves.toMatchObject({
      organizationId: "other",
    });
    release(xml());
    await slow;
  });
  it("caps pending capabilities at eight, permits existing dedup at capacity, and frees slots after failure", async () => {
    expect(LIMITS.maxConcurrentRequests).toBe(8);
    const organizations = Array.from({ length: 9 }, (_, i) => ({
      ...org,
      id: String(i),
    }));
    const deferreds: {
      resolve: (body: Buffer) => void;
      reject: (error: Error) => void;
    }[] = [];
    const transport = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<Buffer>((resolve, reject) =>
            deferreds.push({ resolve, reject })
          )
      );
    const service = createIndeCatalogService({ organizations, transport });
    const requests = organizations
      .slice(0, 8)
      .map(item => service.layers(item.id));
    const duplicate = service.layers("0");
    expect(transport).toHaveBeenCalledTimes(8);
    await expect(service.layers("8")).rejects.toMatchObject({
      kind: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("8"),
    });
    expect(transport).toHaveBeenCalledTimes(8);
    const failed = expect(requests[0]).rejects.toThrow("synthetic failure");
    const duplicateFailed =
      expect(duplicate).rejects.toThrow("synthetic failure");
    deferreds[0].reject(new Error("synthetic failure"));
    await Promise.all([failed, duplicateFailed]);
    const ninth = service.layers("8");
    expect(transport).toHaveBeenCalledTimes(9);
    deferreds.slice(1).forEach(item => item.resolve(xml130()));
    await Promise.all([...requests.slice(1), ninth]);
    transport.mockResolvedValueOnce(xml130());
    await expect(service.layers("0")).resolves.toMatchObject({
      version: "1.3.0",
    });
  });
  it("shares the eight-slot budget between cached-layer GetMaps and new capabilities, and recovers on map errors", async () => {
    const organizations = [
      org,
      { ...org, id: "other" },
      { ...org, id: "third" },
    ];
    const deferreds: {
      parameters: Record<string, string>;
      resolve: (body: Buffer) => void;
    }[] = [];
    const transport = vi
      .fn()
      .mockResolvedValueOnce(xml130())
      .mockImplementation(
        (_endpoint, parameters) =>
          new Promise<Buffer>(resolve =>
            deferreds.push({ parameters, resolve })
          )
      );
    const service = createIndeCatalogService({ organizations, transport });
    await service.layers(org.id);
    const maps = Array.from({ length: 7 }, () => service.mapImage(mapInput));
    await vi.waitFor(() => expect(deferreds).toHaveLength(7));
    const caps = service.layers("other");
    expect(deferreds).toHaveLength(8);
    await expect(service.mapImage(mapInput)).rejects.toMatchObject({
      kind: "TOO_MANY_REQUESTS",
    });
    await expect(service.layers("third")).rejects.toMatchObject({
      kind: "TOO_MANY_REQUESTS",
    });
    expect(transport).toHaveBeenCalledTimes(9); // one warm cache + exactly eight active requests
    const invalidMap = expect(maps[0]).rejects.toThrow(/PNG/);
    deferreds[0].resolve(Buffer.from("<ServiceExceptionReport/>"));
    await invalidMap;
    const resumedCaps = service.layers("third");
    expect(deferreds).toHaveLength(9);
    deferreds
      .slice(1)
      .forEach(item =>
        item.resolve(
          item.parameters.REQUEST === "GetMap" ? png(512, 256) : xml130()
        )
      );
    await Promise.all([...maps.slice(1), caps, resumedCaps]);
    transport.mockResolvedValueOnce(png(512, 256));
    await expect(service.mapImage(mapInput)).resolves.toHaveProperty("dataUrl");
  });
});

describe("INDE map image", () => {
  it("returns only a validated in-memory PNG dataURL using WMS 1.1.1 SRS / lon-lat", async () => {
    const image = png(512, 256);
    const transport = vi
      .fn()
      .mockResolvedValueOnce(xml())
      .mockResolvedValueOnce(image);
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
    });
    const result = await service.mapImage(mapInput);
    expect(result).toEqual({
      dataUrl: `data:image/png;base64,${image.toString("base64")}`,
      crs: "EPSG:4326",
      bounds: [-180, -90, 180, 90],
      attribution: `Fonte: ${org.label} — catálogo INDE`,
    });
    expect(transport).toHaveBeenLastCalledWith(
      org.endpoint,
      expect.objectContaining({
        REQUEST: "GetMap",
        VERSION: "1.1.1",
        SRS: "EPSG:4326",
        BBOX: "-180,-90,180,90",
        LAYERS: "test:layer",
        WIDTH: "512",
        HEIGHT: "256",
        TRANSPARENT: "TRUE",
        FORMAT: "image/png",
        EXCEPTIONS: "application/vnd.ogc.se_xml",
      }),
      LIMITS.imageBytes
    );
    expect(transport.mock.calls[1][1]).not.toHaveProperty("CRS");
  });
  it.each([
    {
      version: "1.3.0",
      crs: "EPSG:4326",
      bounds: [-180, -90, 180, 90],
      bbox: "-90,-180,90,180",
    },
    {
      version: "1.3.0",
      crs: "EPSG:4326",
      bounds: [-53, -24, -45, -17],
      bbox: "-24,-53,-17,-45",
    },
    {
      version: "1.3.0",
      crs: "EPSG:3857",
      bounds: [
        -LIMITS.webMercatorExtent,
        -LIMITS.webMercatorExtent,
        LIMITS.webMercatorExtent,
        LIMITS.webMercatorExtent,
      ],
      bbox: `${-LIMITS.webMercatorExtent},${-LIMITS.webMercatorExtent},${LIMITS.webMercatorExtent},${LIMITS.webMercatorExtent}`,
    },
    {
      version: "1.3.0",
      crs: "EPSG:3857",
      bounds: [-6000000, -3000000, -5000000, -2000000],
      bbox: "-6000000,-3000000,-5000000,-2000000",
    },
    {
      version: "1.1.1",
      crs: "EPSG:4326",
      bounds: [-180, -90, 180, 90],
      bbox: "-180,-90,180,90",
    },
    {
      version: "1.1.1",
      crs: "EPSG:4326",
      bounds: [-53, -24, -45, -17],
      bbox: "-53,-24,-45,-17",
    },
    {
      version: "1.1.1",
      crs: "EPSG:3857",
      bounds: [
        -LIMITS.webMercatorExtent,
        -LIMITS.webMercatorExtent,
        LIMITS.webMercatorExtent,
        LIMITS.webMercatorExtent,
      ],
      bbox: `${-LIMITS.webMercatorExtent},${-LIMITS.webMercatorExtent},${LIMITS.webMercatorExtent},${LIMITS.webMercatorExtent}`,
    },
    {
      version: "1.1.1",
      crs: "EPSG:3857",
      bounds: [-6000000, -3000000, -5000000, -2000000],
      bbox: "-6000000,-3000000,-5000000,-2000000",
    },
  ])(
    "uses negotiated GetMap version/CRS/exceptions and global/tile axes without changing API bounds: $version $crs $bbox",
    async ({ version, crs, bounds, bbox }) => {
      const image = png(512, 256);
      const transport = vi
        .fn()
        .mockResolvedValueOnce(version === "1.3.0" ? xml130() : xml())
        .mockResolvedValueOnce(image);
      const service = createIndeCatalogService({
        organizations: [org],
        transport,
      });
      const input = {
        ...mapInput,
        crs,
        bounds: [...bounds],
      } as IndeMapImageInput;
      const original = structuredClone(input);
      const result = await service.mapImage(input);
      expect(input).toEqual(original);
      expect(result.crs).toBe(crs);
      expect(result.bounds).toEqual(bounds);
      expect(result.bounds).not.toBe(input.bounds);
      expect(transport).toHaveBeenNthCalledWith(
        1,
        org.endpoint,
        { SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetCapabilities" },
        LIMITS.capabilitiesBytes
      );
      expect(transport).toHaveBeenLastCalledWith(
        org.endpoint,
        {
          SERVICE: "WMS",
          REQUEST: "GetMap",
          VERSION: version,
          LAYERS: "test:layer",
          STYLES: "",
          [version === "1.3.0" ? "CRS" : "SRS"]: crs,
          BBOX: bbox,
          WIDTH: "512",
          HEIGHT: "256",
          FORMAT: "image/png",
          TRANSPARENT: "TRUE",
          EXCEPTIONS:
            version === "1.3.0" ? "XML" : "application/vnd.ogc.se_xml",
        },
        LIMITS.imageBytes
      );
      expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      const returned = Buffer.from(result.dataUrl.split(",")[1], "base64");
      expect(returned).toEqual(image);
      expect(() => validateIndePng(returned, 512, 256)).not.toThrow();
      expect(returned.readUInt32BE(16)).toBe(512);
      expect(returned.readUInt32BE(20)).toBe(256);
    }
  );
  it.each([Buffer.from("<ServiceExceptionReport/>"), png(256, 256)])(
    "validates PNG signature and exact 3D IHDR on WMS 1.3.0, not just the requested MIME",
    async body => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce(xml130())
        .mockResolvedValueOnce(body);
      await expect(
        createIndeCatalogService({ organizations: [org], transport }).mapImage(
          mapInput
        )
      ).rejects.toThrow(/PNG|IHDR/);
    }
  );
  it("accepts Web Mercator meter bounds only for advertised EPSG:3857", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(xml())
      .mockResolvedValueOnce(png(1024, 512));
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
    });
    const bounds: [number, number, number, number] = [
      -LIMITS.webMercatorExtent,
      -LIMITS.webMercatorExtent,
      LIMITS.webMercatorExtent,
      LIMITS.webMercatorExtent,
    ];
    await expect(
      service.mapImage({
        ...mapInput,
        width: 1024,
        height: 512,
        crs: "EPSG:3857",
        bounds,
      })
    ).resolves.toMatchObject({ crs: "EPSG:3857", bounds });
  });
  it("rejects foreign layer names and unsupported advertised CRS before GetMap", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(xml("<Layer><Name>test:layer</Name></Layer>"));
    const service = createIndeCatalogService({
      organizations: [org],
      transport,
    });
    await expect(
      service.mapImage({ ...mapInput, layerName: "foreign" })
    ).rejects.toThrow(/não pertence/);
    await expect(
      service.mapImage({ ...mapInput, crs: "EPSG:3857" })
    ).rejects.toThrow(/não anunciado/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { layerName: "test:layer,foreign" },
    { layerName: "name\n" },
    { layerName: "" },
    { width: 1025 },
    { width: 1.5 },
    { width: 0 },
    { height: 513 },
    { height: 0 },
    { crs: "EPSG:4674" },
    { bounds: [-181, -90, 180, 90] },
    { bounds: [-180, -91, 180, 90] },
    { bounds: [0, 0, 0, 1] },
    { bounds: [1, 1, 0, 0] },
    { bounds: [0, 0, Infinity, 2] },
    { bounds: [0, 0, NaN, 2] },
    { crs: "EPSG:3857", bounds: [-20_037_509, -1, 1, 1] },
  ])(
    "rejects bad names/CRS/dimensions/BBOX without any network: %j",
    async changes => {
      const transport = vi.fn();
      const service = createIndeCatalogService({
        organizations: [org],
        transport,
      });
      await expect(
        service.mapImage({ ...mapInput, ...changes } as IndeMapImageInput)
      ).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    }
  );
  it("checks PNG signature, IHDR dimensions and chunks; rejects WMS exception XML HTTP200", async () => {
    expect(() => validateIndePng(png(512, 256), 512, 256)).not.toThrow();
    expect(() => validateIndePng(png(256, 256), 512, 256)).toThrow(/IHDR/);
    expect(() =>
      validateIndePng(Buffer.from("<ServiceExceptionReport/>"), 512, 256)
    ).toThrow(/PNG/);
    expect(() =>
      validateIndePng(png(512, 256).subarray(0, 40), 512, 256)
    ).toThrow();
    expect(() =>
      validateIndePng(Buffer.alloc(LIMITS.imageBytes + 1), 512, 256)
    ).toThrow();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(xml())
      .mockResolvedValueOnce(Buffer.from("<ServiceExceptionReport/>"));
    await expect(
      createIndeCatalogService({ organizations: [org], transport }).mapImage(
        mapInput
      )
    ).rejects.toThrow(/PNG/);
  });
  it("permits the required 3D global 512×256 EPSG:4326 request", () => {
    expect(() => validateIndeMapInput(mapInput)).not.toThrow();
  });
});
