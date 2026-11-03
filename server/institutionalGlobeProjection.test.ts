import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import InstitutionalGlobeOverlays, {
  type InstitutionalGlobeOverlaysProps,
} from "../client/src/components/InstitutionalGlobeOverlays";
import {
  assertInstitutionalGlobeImage,
  INSTITUTIONAL_GLOBE_BOUNDS,
  INSTITUTIONAL_GLOBE_MAX_LAYERS,
  INSTITUTIONAL_GLOBE_ROTATION_Y,
  institutionalGlobeCartesian,
  institutionalGlobeOverlayRadius,
  institutionalGlobeUv,
  isInstitutionalGlobeGlobalBounds,
  isInstitutionalGlobeRequestCurrent,
} from "../shared/institutionalGlobeProjection";

// Minimal PNG-shaped header, not a decodable image. Tests below validate the transport
// guard only: actual full-image decode is mandatory in the component's image.onload.
function pngHeader(width = 512, height = 256) {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
}

const payload = (dataUrl = pngHeader()) => ({
  dataUrl,
  crs: "EPSG:4326",
  bounds: [...INSTITUTIONAL_GLOBE_BOUNDS],
});

describe("institutional globe — global equirectangular projection (offline)", () => {
  it("uses west/east across u and south/north across v with texture.flipY=true", () => {
    expect(institutionalGlobeUv(-180, -90)).toEqual({ u: 0, v: 0 });
    expect(institutionalGlobeUv(-180, 90)).toEqual({ u: 0, v: 1 });
    expect(institutionalGlobeUv(180, -90)).toEqual({ u: 1, v: 0 });
    expect(institutionalGlobeUv(180, 90)).toEqual({ u: 1, v: 1 });
    expect(institutionalGlobeUv(0, 0)).toEqual({ u: 0.5, v: 0.5 });
    expect(institutionalGlobeUv(-90, 45)).toEqual({ u: 0.25, v: 0.75 });
  });

  it.each([
    [0, 0, [0, 0, 100]],
    [90, 0, [100, 0, 0]],
    [-90, 0, [-100, 0, 0]],
    [180, 0, [0, 0, -100]],
    [-180, 0, [0, 0, -100]],
    [0, 90, [0, 100, 0]],
    [0, -90, [0, -100, 0]],
  ])(
    "aligns longitude %s latitude %s to react-globe.gl axes",
    (lon, lat, expected) => {
      const position = institutionalGlobeCartesian(
        lon as number,
        lat as number
      );
      expect(position.x).toBeCloseTo((expected as number[])[0], 10);
      expect(position.y).toBeCloseTo((expected as number[])[1], 10);
      expect(position.z).toBeCloseTo((expected as number[])[2], 10);
    }
  );

  it("matches real THREE.SphereGeometry vertices/UVs across the entire global BBOX", () => {
    const geometry = new SphereGeometry(100, 192, 96);
    try {
      const positions = geometry.getAttribute("position");
      const uvs = geometry.getAttribute("uv");
      const axis = new Vector3(0, 1, 0);
      // Every vertex, including Three's polar UV offsets and both seam copies.
      for (let index = 0; index < positions.count; index++) {
        const lon = (uvs.getX(index) - 0.5) * 360;
        const lat = (uvs.getY(index) - 0.5) * 180;
        // At poles Three deliberately offsets u by half a texel (longitude is undefined).
        const expected = institutionalGlobeCartesian(
          Math.max(-180, Math.min(180, lon)),
          lat
        );
        const actual = new Vector3()
          .fromBufferAttribute(positions, index)
          .applyAxisAngle(axis, INSTITUTIONAL_GLOBE_ROTATION_Y);
        expect(actual.x).toBeCloseTo(expected.x, 4);
        expect(actual.y).toBeCloseTo(expected.y, 4);
        expect(actual.z).toBeCloseTo(expected.z, 4);
      }
    } finally {
      geometry.dispose();
    }
  });

  it("places Brasília in the southwest quadrant, not mirrored or quarter-turned", () => {
    const point = institutionalGlobeCartesian(-47.9292, -15.7801);
    const uv = institutionalGlobeUv(-47.9292, -15.7801);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeLessThan(0);
    expect(point.z).toBeGreaterThan(0);
    expect(uv.u).toBeLessThan(0.5);
    expect(uv.v).toBeLessThan(0.5);
  });

  it("rejects partial, axis-swapped, nonfinite and malformed BBOX values", () => {
    expect(isInstitutionalGlobeGlobalBounds([-180, -90, 180, 90])).toBe(true);
    for (const bounds of [
      null,
      "-180,-90,180,90",
      [-90, -180, 90, 180],
      [-80, -40, -30, 10],
      [-180, -90, 180],
      [-180, -90, 180, 90, 0],
      [-180, -90, NaN, 90],
    ]) {
      expect(isInstitutionalGlobeGlobalBounds(bounds)).toBe(false);
      expect(() =>
        assertInstitutionalGlobeImage({ ...payload(), bounds })
      ).toThrow(/BBOX/);
    }
  });

  it("rejects invalid coordinates and radii instead of wrapping them silently", () => {
    for (const [lon, lat] of [
      [181, 0],
      [-181, 0],
      [0, 91],
      [0, -91],
      [NaN, 0],
      [0, Infinity],
    ])
      expect(() => institutionalGlobeUv(lon, lat)).toThrow();
    for (const radius of [0, -1, Infinity, NaN]) {
      expect(() => institutionalGlobeCartesian(0, 0, radius)).toThrow();
      expect(() => institutionalGlobeOverlayRadius(radius, 0)).toThrow();
    }
  });

  it("keeps four distinct shells outside the actual globe and below project points", () => {
    expect(INSTITUTIONAL_GLOBE_MAX_LAYERS).toBe(4);
    for (const radius of [100, 250]) {
      let previous = radius;
      for (let index = 0; index < 4; index++) {
        const shell = institutionalGlobeOverlayRadius(radius, index);
        expect(shell).toBeGreaterThan(previous);
        expect(shell).toBeLessThan(radius * 1.01);
        previous = shell;
      }
    }
    for (const index of [-1, 4, 0.5, NaN])
      expect(() => institutionalGlobeOverlayRadius(100, index)).toThrow(
        /4 camadas/
      );
  });
});

describe("institutional globe — safe PNG envelope (no image fetch/decode)", () => {
  it("accepts only a global 512×256 PNG header in a base64 data URL", () => {
    expect(() => assertInstitutionalGlobeImage(payload())).not.toThrow();
  });

  it.each(["EPSG:3857", "CRS:84", "epsg:4326", undefined, null])(
    "rejects CRS %s",
    crs => {
      expect(() =>
        assertInstitutionalGlobeImage({ ...payload(), crs })
      ).toThrow(/CRS/);
    }
  );

  it.each([
    "https://example.invalid/map.png",
    "//example.invalid/map.png",
    "blob:local",
    "data:image/svg+xml,<svg/>",
    "data:image/jpeg;base64,AAAA",
    "data:image/png;base64,",
    "data:image/png;base64,!!!=",
    `data:image/png;base64,${Buffer.from("<html>not a PNG image at all</html>").toString("base64")}`,
  ])(
    "rejects external or non-PNG content without dereferencing it",
    dataUrl => {
      expect(() => assertInstitutionalGlobeImage(payload(dataUrl))).toThrow();
    }
  );

  it("rejects wrong PNG dimensions and oversized content before image allocation", () => {
    for (const [width, height] of [
      [256, 512],
      [1, 1],
      [1024, 512],
      [0, 256],
    ])
      expect(() =>
        assertInstitutionalGlobeImage(payload(pngHeader(width, height)))
      ).toThrow(/512×256/);
    expect(() =>
      assertInstitutionalGlobeImage(
        payload("data:image/png;base64," + "A".repeat(8 * 1024 * 1024))
      )
    ).toThrow(/tamanho/);
  });

  it.each([undefined, null, [], "PNG", 42])(
    "rejects a malformed response envelope",
    value => {
      expect(() => assertInstitutionalGlobeImage(value)).toThrow();
    }
  );
});

describe("institutional globe — stale request identity", () => {
  it("accepts a current enabled request, but not an aborted or removed one", () => {
    const controller = new AbortController();
    const request = {};
    expect(
      isInstitutionalGlobeRequestCurrent(controller.signal, request, request)
    ).toBe(true);
    expect(
      isInstitutionalGlobeRequestCurrent(controller.signal, request, undefined)
    ).toBe(false);
    controller.abort();
    expect(
      isInstitutionalGlobeRequestCurrent(controller.signal, request, request)
    ).toBe(false);
  });

  it("does not reinstall the old response when the same id is enabled again", () => {
    const oldController = new AbortController();
    const oldRequest = { id: "institution:layer" };
    const replacement = { id: "institution:layer" };
    expect(
      isInstitutionalGlobeRequestCurrent(
        oldController.signal,
        oldRequest,
        replacement
      )
    ).toBe(false);
    expect(
      isInstitutionalGlobeRequestCurrent(
        new AbortController().signal,
        replacement,
        replacement
      )
    ).toBe(true);
  });
});

// Tiny React commit harness: no React renderer, browser, timers, server or network.
// It exercises the adapter effects, not visual WebGL output or actual PNG decoding.
const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
  cleanups: [] as Array<() => void>,
  mounting: true,
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    return hooks.refs[index] ?? (hooks.refs[index] = { current: value });
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    if (deps?.length === 0 && !hooks.mounting) return;
    hooks.effects.push(effect);
  },
}));

class LocalImage {
  static instances: LocalImage[] = [];
  naturalWidth = 512;
  naturalHeight = 256;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    LocalImage.instances.push(this);
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

function renderOverlays(props: InstitutionalGlobeOverlaysProps) {
  hooks.cursor = 0;
  InstitutionalGlobeOverlays(props);
  for (const effect of hooks.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  }
  hooks.mounting = false;
}

function unmountOverlays() {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
}

async function settlePromises() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function adapterFixture(ids = ["layer-a"]) {
  vi.stubGlobal("Image", LocalImage);
  const scene = new Scene();
  const originalObject = new Object3D();
  scene.add(originalObject);
  const onStatus = vi.fn();
  const loadImage = vi.fn(
    async (_id: string, _signal: AbortSignal) =>
      payload() as Awaited<
        ReturnType<InstitutionalGlobeOverlaysProps["loadImage"]>
      >
  );
  const props: InstitutionalGlobeOverlaysProps = {
    globeRef: { current: { scene: () => scene, getGlobeRadius: () => 250 } },
    layers: ids.map(id => ({
      id,
      title: `<title>${id}</title>`,
      attribution: "<unsafe>plain metadata</unsafe>",
    })),
    loadImage,
    onStatus,
  };
  return { scene, originalObject, onStatus, loadImage, props };
}

afterEach(() => {
  unmountOverlays();
  hooks.refs = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.mounting = true;
  LocalImage.instances = [];
  vi.unstubAllGlobals();
});

describe("institutional globe — adapter effects with local mocks (no WebGL)", () => {
  it("does not report ready until Image.onload and leaves existing scene objects intact", async () => {
    const { props, scene, originalObject, onStatus, loadImage } =
      adapterFixture();
    renderOverlays(props);
    expect(onStatus).toHaveBeenCalledWith(
      "layer-a",
      "loading",
      expect.any(String)
    );
    await settlePromises();
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.some(call => call[1] === "ready")).toBe(false);
    expect(scene.children).toEqual([originalObject]);
    LocalImage.instances[0].onload?.();
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "ready",
      expect.any(String)
    );
    const mesh = scene.children[1] as Mesh<SphereGeometry, MeshBasicMaterial>;
    expect(mesh.scale.x).toBeCloseTo(institutionalGlobeOverlayRadius(250, 0));
    expect(mesh.rotation.y).toBe(INSTITUTIONAL_GLOBE_ROTATION_Y);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.map?.flipY).toBe(true);
    expect(mesh.userData.title).toBe("<title>layer-a</title>");
    const hits: unknown[] = [];
    mesh.raycast({} as never, hits as never);
    expect(hits).toEqual([]);
    expect(scene.children[0]).toBe(originalObject);
  });

  it("updates opacity/order without reloading and disposes texture/material/geometry on disable", async () => {
    const { props, scene, originalObject, loadImage } = adapterFixture();
    renderOverlays(props);
    await settlePromises();
    LocalImage.instances[0].onload?.();
    const mesh = scene.children[1] as Mesh<SphereGeometry, MeshBasicMaterial>;
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    const texture = mesh.material.map!;
    const textureDispose = vi.spyOn(texture, "dispose");
    const signal = loadImage.mock.calls[0][1];
    renderOverlays({ ...props, layers: [...props.layers], opacity: 0.3 });
    await settlePromises();
    expect(mesh.material.opacity).toBe(0.3);
    expect(loadImage).toHaveBeenCalledTimes(1);
    renderOverlays({ ...props, layers: [] });
    expect(signal.aborted).toBe(true);
    expect(scene.children).toEqual([originalObject]);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(texture.image).toBeNull();
    expect(LocalImage.instances[0].src).toBe("");
  });

  it("ignores a late backend response after disable and re-enable of the same id", async () => {
    const { props, scene, loadImage, onStatus } = adapterFixture();
    let resolveOld!: (
      value: Awaited<ReturnType<InstitutionalGlobeOverlaysProps["loadImage"]>>
    ) => void;
    loadImage.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOld = resolve;
        })
    );
    renderOverlays(props);
    await settlePromises();
    const oldSignal = loadImage.mock.calls[0][1];
    renderOverlays({ ...props, layers: [] });
    renderOverlays(props);
    await settlePromises();
    expect(oldSignal.aborted).toBe(true);
    expect(LocalImage.instances).toHaveLength(1);
    resolveOld(
      payload() as Awaited<
        ReturnType<InstitutionalGlobeOverlaysProps["loadImage"]>
      >
    );
    await settlePromises();
    expect(LocalImage.instances).toHaveLength(1);
    expect(scene.children).toHaveLength(1);
    LocalImage.instances[0].onload?.();
    expect(scene.children).toHaveLength(2);
    expect(
      onStatus.mock.calls.filter(call => call[1] === "ready")
    ).toHaveLength(1);
  });

  it("ignores a late image callback after unmount", async () => {
    const { props, scene, loadImage, onStatus } = adapterFixture();
    renderOverlays(props);
    await settlePromises();
    const lateOnload = LocalImage.instances[0].onload!;
    unmountOverlays();
    lateOnload();
    expect(loadImage.mock.calls[0][1].aborted).toBe(true);
    expect(scene.children).toHaveLength(1);
    expect(onStatus.mock.calls.some(call => call[1] === "ready")).toBe(false);
  });

  it("loads only four selected layers and explicitly reports the fifth as error", async () => {
    const { props, loadImage, onStatus } = adapterFixture([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    renderOverlays(props);
    await settlePromises();
    expect(loadImage.mock.calls.map(call => call[0])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(onStatus).toHaveBeenCalledWith(
      "e",
      "error",
      expect.stringContaining("4 camadas")
    );
    renderOverlays({ ...props, layers: props.layers.slice(1) });
    await settlePromises();
    expect(loadImage.mock.calls.map(call => call[0])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(loadImage.mock.calls[0][1].aborted).toBe(true);
  });

  it("surfaces backend failure and does not spin retries on status-driven parent renders", async () => {
    const { props, loadImage, onStatus } = adapterFixture();
    loadImage.mockRejectedValueOnce(new Error("backend unavailable"));
    renderOverlays(props);
    await settlePromises();
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "error",
      expect.any(String)
    );
    renderOverlays({ ...props, layers: [...props.layers] });
    await settlePromises();
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...payload(), crs: "EPSG:3857" },
    payload("https://example.invalid/map.png"),
  ])("rejects invalid payload before allocating an Image", async invalid => {
    const { props, loadImage, onStatus } = adapterFixture();
    loadImage.mockResolvedValueOnce(invalid as never);
    renderOverlays(props);
    await settlePromises();
    expect(LocalImage.instances).toHaveLength(0);
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "error",
      expect.any(String)
    );
  });

  it("surfaces image decode errors without claiming readiness", async () => {
    const { props, scene, onStatus } = adapterFixture();
    renderOverlays(props);
    await settlePromises();
    LocalImage.instances[0].onerror?.();
    expect(scene.children).toHaveLength(1);
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "error",
      expect.any(String)
    );
    expect(onStatus.mock.calls.some(call => call[1] === "ready")).toBe(false);
  });

  it("waits for a null ref without loading and starts after a parent readiness render", async () => {
    const { props, loadImage, onStatus } = adapterFixture();
    const nullRef = { current: null };
    renderOverlays({ ...props, globeRef: nullRef });
    renderOverlays({ ...props, globeRef: nullRef });
    await settlePromises();
    expect(loadImage).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledTimes(1);
    renderOverlays(props);
    await settlePromises();
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("falls back to radius 100 only when the globe radius method is absent", async () => {
    const { props, scene } = adapterFixture();
    renderOverlays({ ...props, globeRef: { current: { scene: () => scene } } });
    await settlePromises();
    LocalImage.instances[0].onload?.();
    expect(scene.children[1].scale.x).toBe(
      institutionalGlobeOverlayRadius(100, 0)
    );
  });

  it("rejects a bad globe radius without loading or mutating the original scene", async () => {
    const { props, scene, loadImage, onStatus } = adapterFixture();
    renderOverlays({
      ...props,
      globeRef: { current: { scene: () => scene, getGlobeRadius: () => NaN } },
    });
    await settlePromises();
    expect(loadImage).not.toHaveBeenCalled();
    expect(scene.children).toHaveLength(1);
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "error",
      expect.any(String)
    );
  });

  it("disposes installed resources on unmount as well as on disable", async () => {
    const { props, scene } = adapterFixture();
    renderOverlays(props);
    await settlePromises();
    LocalImage.instances[0].onload?.();
    const mesh = scene.children[1] as Mesh<SphereGeometry, MeshBasicMaterial>;
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    const textureDispose = vi.spyOn(mesh.material.map!, "dispose");
    unmountOverlays();
    expect(scene.children).toHaveLength(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("rejects decoded dimensions that disagree with the transport contract", async () => {
    const { props, scene, onStatus } = adapterFixture();
    renderOverlays(props);
    await settlePromises();
    LocalImage.instances[0].naturalWidth = 1024;
    LocalImage.instances[0].onload?.();
    expect(scene.children).toHaveLength(1);
    expect(onStatus).toHaveBeenLastCalledWith(
      "layer-a",
      "error",
      expect.stringContaining("512×256")
    );
  });

  it("changes render order and clamps opacity without refetching existing ids", async () => {
    const { props, scene, loadImage } = adapterFixture(["a", "b"]);
    renderOverlays(props);
    await settlePromises();
    LocalImage.instances.forEach(image => image.onload?.());
    const a = scene.children[1] as Mesh<SphereGeometry, MeshBasicMaterial>;
    const b = scene.children[2] as Mesh<SphereGeometry, MeshBasicMaterial>;
    renderOverlays({
      ...props,
      layers: props.layers.slice().reverse(),
      opacity: 2,
    });
    expect(a.renderOrder).toBe(2);
    expect(b.renderOrder).toBe(1);
    expect(a.material.opacity).toBe(1);
    expect(a.scale.x).toBeGreaterThan(b.scale.x);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });
});
