import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  assertInstitutionalGlobeImage,
  INSTITUTIONAL_GLOBE_IMAGE_HEIGHT,
  INSTITUTIONAL_GLOBE_IMAGE_WIDTH,
  INSTITUTIONAL_GLOBE_MAX_LAYERS,
  INSTITUTIONAL_GLOBE_ROTATION_Y,
  institutionalGlobeOverlayRadius,
  isInstitutionalGlobeRequestCurrent,
  type InstitutionalGlobeImage,
} from "@shared/institutionalGlobeProjection";

export interface InstitutionalGlobeLayer {
  id: string;
  title: string;
  attribution: string;
}

export type InstitutionalGlobeStatus = "loading" | "ready" | "error";

export interface InstitutionalGlobeOverlaysProps {
  globeRef: { current: any };
  /** Only enabled layers. Removing an id disables it and aborts its work. */
  layers: Array<InstitutionalGlobeLayer>;
  /** The caller owns the authorized backend request. No external URL is loaded here. */
  loadImage: (
    id: string,
    signal: AbortSignal
  ) => Promise<InstitutionalGlobeImage>;
  onStatus: (
    id: string,
    state: InstitutionalGlobeStatus,
    message: string
  ) => void;
  /** Global opacity in [0,1], clamped; changing it does not reload PNGs. */
  opacity?: number;
}

type OverlayMesh = THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
type OverlayRequest = {
  controller: AbortController;
  image?: HTMLImageElement;
  texture?: THREE.Texture;
  geometry?: THREE.SphereGeometry;
  material?: THREE.MeshBasicMaterial;
  mesh?: OverlayMesh;
  index: number;
  opacity: number;
  layer: InstitutionalGlobeLayer;
};

/** Only our own objects are removed; the scene, base material and points are untouched. */
function releaseOverlay(request: OverlayRequest) {
  request.controller.abort();
  if (request.image) {
    request.image.onload = null;
    request.image.onerror = null;
    request.image.removeAttribute("src");
    request.image = undefined;
  }
  request.mesh?.removeFromParent();
  request.geometry?.dispose();
  request.material?.dispose();
  request.texture?.dispose();
  if (request.texture) request.texture.image = null;
  request.mesh = undefined;
  request.geometry = undefined;
  request.material = undefined;
  request.texture = undefined;
}

function updateMesh(request: OverlayRequest, globeRadius: number) {
  if (!request.mesh) return;
  request.mesh.scale.setScalar(
    institutionalGlobeOverlayRadius(globeRadius, request.index)
  );
  request.mesh.renderOrder = request.index + 1;
  request.mesh.material.opacity = request.opacity;
  // Plain metadata only. This adapter never interprets titles/attributions as HTML.
  request.mesh.userData = {
    institutionalLayerId: request.layer.id,
    title: request.layer.title,
    attribution: request.layer.attribution,
  };
}

/**
 * Non-visual React adapter: adds global WMS spheres to the existing Three scene.
 * Mount alongside Globe after onGlobeReady (or cause a React render when ref becomes ready).
 * No renderer, animation loop, provider, backend request implementation or base-map mutation.
 */
export default function InstitutionalGlobeOverlays({
  globeRef,
  layers,
  loadImage,
  onStatus,
  opacity = 0.85,
}: InstitutionalGlobeOverlaysProps) {
  const requests = useRef(new Map<string, OverlayRequest>());
  const statuses = useRef(new Map<string, string>());
  const target = useRef<{
    globe: any;
    scene: THREE.Scene;
    radius: number;
  } | null>(null);
  const statusCallback = useRef(onStatus);

  useEffect(() => {
    statusCallback.current = onStatus;
  }, [onStatus]);

  useEffect(
    () => () => {
      for (const request of Array.from(requests.current.values()))
        releaseOverlay(request);
      requests.current.clear();
      statuses.current.clear();
      target.current = null;
    },
    []
  );

  // Reconcile after every React commit: fresh arrays/callbacks do not restart requests,
  // and a ref assigned during the parent's commit is observed without polling frames.
  useEffect(() => {
    const notify = (
      id: string,
      state: InstitutionalGlobeStatus,
      message: string
    ) => {
      const key = `${state}:${message}`;
      if (statuses.current.get(id) === key) return;
      statuses.current.set(id, key);
      statusCallback.current(id, state, message);
    };
    const enabled = new Map<string, InstitutionalGlobeLayer>();
    const rejected = new Map<string, string>();
    for (const layer of layers) {
      if (enabled.has(layer.id) || rejected.has(layer.id)) {
        enabled.delete(layer.id);
        rejected.set(
          layer.id,
          "Identificador de camada duplicado na seleção do globo."
        );
      } else if (!layer.id.trim()) {
        rejected.set(layer.id, "Identificador de camada vazio.");
      } else {
        enabled.set(layer.id, layer);
      }
    }
    // Keep the first four distinct valid ids; never silently ignore excess layers.
    for (const id of Array.from(enabled.keys()).slice(
      INSTITUTIONAL_GLOBE_MAX_LAYERS
    )) {
      enabled.delete(id);
      rejected.set(
        id,
        "No máximo 4 camadas institucionais simultâneas no globo; desative outra camada."
      );
    }
    const selectedIds = new Set(layers.map(layer => layer.id));
    for (const id of Array.from(statuses.current.keys())) {
      if (!selectedIds.has(id)) statuses.current.delete(id);
    }
    for (const [id, request] of Array.from(requests.current)) {
      if (!enabled.has(id)) {
        requests.current.delete(id); // invalidate identity before abort/decode callbacks
        releaseOverlay(request);
      }
    }
    for (const [id, message] of Array.from(rejected))
      notify(id, "error", message);

    const globe = globeRef.current;
    let scene: THREE.Scene | undefined;
    let radius = 100;
    let sceneError: string | undefined;
    try {
      if (globe) {
        scene = globe.scene?.();
        if (!scene?.isScene || typeof scene.add !== "function")
          throw new Error("Cena Three do globo indisponível.");
        radius =
          typeof globe.getGlobeRadius === "function"
            ? globe.getGlobeRadius()
            : 100;
        institutionalGlobeOverlayRadius(radius, 0); // validate before allocating resources
      }
    } catch {
      scene = undefined;
      sceneError =
        "Cena ou raio do globo inválido; aguarde a inicialização do globo.";
    }
    if (
      (target.current !== null || scene !== undefined) &&
      (target.current?.globe !== globe ||
        target.current?.scene !== scene ||
        target.current?.radius !== radius)
    ) {
      for (const request of Array.from(requests.current.values()))
        releaseOverlay(request);
      requests.current.clear();
      for (const id of Array.from(enabled.keys())) statuses.current.delete(id);
      target.current = scene ? { globe, scene, radius } : null;
    }
    if (!scene) {
      for (const id of Array.from(enabled.keys()))
        notify(
          id,
          sceneError ? "error" : "loading",
          sceneError ?? "Aguardando inicialização do globo."
        );
      return;
    }
    const currentScene = scene;
    const resolvedOpacity = Number.isFinite(opacity)
      ? Math.min(1, Math.max(0, opacity))
      : 0.85;
    let index = 0;
    for (const [id, layer] of Array.from(enabled)) {
      const existing = requests.current.get(id);
      if (existing) {
        existing.index = index++;
        existing.opacity = resolvedOpacity;
        existing.layer = layer;
        updateMesh(existing, radius);
        continue;
      }
      const request: OverlayRequest = {
        controller: new AbortController(),
        index: index++,
        opacity: resolvedOpacity,
        layer,
      };
      requests.current.set(id, request);
      const isCurrent = () =>
        isInstitutionalGlobeRequestCurrent(
          request.controller.signal,
          request,
          requests.current.get(id)
        );
      const fail = () => {
        if (!isCurrent()) return;
        // Retain an aborted tombstone until disabled, so parent status renders do not retry forever.
        releaseOverlay(request);
        notify(
          id,
          "error",
          "Não foi possível carregar o PNG institucional no globo. Desative e reative para tentar novamente."
        );
      };
      const failWithMessage = (message: string) => {
        if (!isCurrent()) return;
        releaseOverlay(request);
        notify(id, "error", message);
      };
      notify(id, "loading", "Carregando imagem institucional para o globo.");
      // Promise.resolve also catches a synchronous throw in a caller-provided loader.
      void Promise.resolve()
        .then(() => {
          if (!isCurrent()) return undefined;
          return loadImage(id, request.controller.signal);
        })
        .then(payload => {
          if (!isCurrent()) return;
          try {
            assertInstitutionalGlobeImage(payload);
          } catch (error) {
            failWithMessage(
              error instanceof Error
                ? error.message
                : "Imagem institucional inválida."
            );
            return;
          }
          const image = new Image();
          request.image = image;
          image.onload = () => {
            if (!isCurrent()) return;
            // Promise completion is NOT readiness: the PNG must actually decode first.
            if (
              image.naturalWidth !== INSTITUTIONAL_GLOBE_IMAGE_WIDTH ||
              image.naturalHeight !== INSTITUTIONAL_GLOBE_IMAGE_HEIGHT
            ) {
              failWithMessage(
                "Dimensões decodificadas inválidas: esperado PNG global 512×256."
              );
              return;
            }
            image.onload = null;
            image.onerror = null;
            try {
              request.texture = new THREE.Texture(image);
              request.texture.flipY = true;
              request.texture.colorSpace = THREE.SRGBColorSpace;
              request.texture.wrapS = THREE.ClampToEdgeWrapping;
              request.texture.wrapT = THREE.ClampToEdgeWrapping;
              request.texture.minFilter = THREE.LinearFilter;
              request.texture.magFilter = THREE.LinearFilter;
              request.texture.generateMipmaps = false;
              request.texture.needsUpdate = true;
              request.geometry = new THREE.SphereGeometry(1, 192, 96);
              request.material = new THREE.MeshBasicMaterial({
                map: request.texture,
                transparent: true,
                opacity: request.opacity,
                depthWrite: false,
                depthTest: true,
                side: THREE.FrontSide,
                toneMapped: false,
              });
              request.mesh = new THREE.Mesh(request.geometry, request.material);
              request.mesh.name = `institutional-globe-overlay:${id}`;
              request.mesh.rotation.y = INSTITUTIONAL_GLOBE_ROTATION_Y;
              request.mesh.raycast = () => {}; // overlays must not steal point picking
              updateMesh(request, radius);
              currentScene.add(request.mesh);
            } catch {
              fail();
              return;
            }
            notify(
              id,
              "ready",
              "PNG institucional decodificado e overlay instalado na cena do globo."
            );
          };
          image.onerror = fail;
          image.src = payload.dataUrl; // only the strictly validated inline PNG, never a URL
        })
        .catch(fail);
    }
  });

  return null;
}

export { InstitutionalGlobeOverlays };
