import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INDE_CATALOG_LIMITS as LIMITS } from "../shared/indeCatalog";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: mocks.request }));
import {
  canonicalEndpoint,
  isPublicIp,
  pinnedLookup,
  requestPinnedWms,
} from "./indeCatalogService";

afterEach(() => {
  mocks.request.mockReset();
  vi.useRealTimers();
});
function networkReply(
  options: {
    status?: number;
    body?: Buffer;
    headers?: Record<string, string>;
  } = {}
) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: options.status ?? 200,
    headers: options.headers ?? {},
    destroy: vi.fn(),
  });
  const request = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    end: vi.fn(),
  });
  mocks.request.mockImplementation((_url, _options, callback) => {
    request.end.mockImplementation(() =>
      queueMicrotask(() => {
        callback(response);
        if (response.destroy.mock.calls.length) return;
        response.emit("data", options.body ?? Buffer.from("OK"));
        response.emit("end");
      })
    );
    return request;
  });
  return { request, response };
}

describe("INDE public-only DNS and pinned HTTPS", () => {
  it("limits all pinned DNS/HTTPS calls together to eight and frees slots on DNS failure and HTTP completion", async () => {
    const dns: {
      resolve: (addresses: { address: string; family: number }[]) => void;
    }[] = [];
    const resolver = vi
      .fn()
      .mockImplementation(() => new Promise(resolve => dns.push({ resolve })));
    const responses: EventEmitter[] = [];
    mocks.request.mockImplementation((_url, _options, callback) => {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: {},
        destroy: vi.fn(),
      });
      const request = Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        end: vi.fn(() =>
          queueMicrotask(() => {
            responses.push(response);
            callback(response);
          })
        ),
      });
      return request;
    });
    const calls = Array.from({ length: 8 }, (_, i) =>
      requestPinnedWms(
        "https://wms.example.org/ows",
        { REQUEST: i % 2 ? "GetMap" : "GetCapabilities" },
        1024,
        resolver
      )
    );
    const forbidden = expect(calls[0]).rejects.toMatchObject({
      kind: "FORBIDDEN",
    });
    const unusedResolver = vi.fn();
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, unusedResolver)
    ).rejects.toMatchObject({
      kind: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("8"),
    });
    expect(unusedResolver).not.toHaveBeenCalled();
    expect(resolver).toHaveBeenCalledTimes(8);
    expect(mocks.request).not.toHaveBeenCalled();
    dns[0].resolve([{ address: "127.0.0.1", family: 4 }]);
    await forbidden;
    const replacement = requestPinnedWms(
      "https://wms.example.org/ows",
      {},
      1024,
      resolver
    );
    expect(resolver).toHaveBeenCalledTimes(9);
    dns
      .slice(1)
      .forEach(item => item.resolve([{ address: "8.8.8.8", family: 4 }]));
    await vi.waitFor(() => expect(responses).toHaveLength(8));
    expect(mocks.request).toHaveBeenCalledTimes(8);
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, unusedResolver)
    ).rejects.toMatchObject({ kind: "TOO_MANY_REQUESTS" });
    expect(unusedResolver).not.toHaveBeenCalled();
    responses.forEach(response => {
      response.emit("data", Buffer.from("OK"));
      response.emit("end");
    });
    expect(await Promise.all([...calls.slice(1), replacement])).toEqual(
      Array.from({ length: 8 }, () => Buffer.from("OK"))
    );
    networkReply();
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).resolves.toEqual(Buffer.from("OK"));
  });
  it("does not leak global slots after canonical, DNS, synchronous HTTPS or upstream status errors", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const dnsError = vi
      .fn()
      .mockRejectedValue(new Error("private resolver detail"));
    for (let i = 0; i <= LIMITS.maxConcurrentRequests; i++) {
      await expect(
        requestPinnedWms("http://wms.example.org/ows", {}, 1024, resolver)
      ).rejects.toMatchObject({ kind: "FORBIDDEN" });
      await expect(
        requestPinnedWms("https://wms.example.org/ows", {}, 1024, dnsError)
      ).rejects.toMatchObject({
        kind: "BAD_GATEWAY",
        message: "Não foi possível resolver o DNS da origem WMS.",
      });
      mocks.request.mockImplementationOnce(() => {
        throw new Error("synthetic https failure");
      });
      await expect(
        requestPinnedWms("https://wms.example.org/ows", {}, 1024, resolver)
      ).rejects.toThrow("synthetic https failure");
    }
    networkReply({ status: 403 });
    for (let i = 0; i <= LIMITS.maxConcurrentRequests; i++) {
      await expect(
        requestPinnedWms("https://wms.example.org/ows", {}, 1024, resolver)
      ).rejects.toMatchObject({
        kind: "BAD_GATEWAY",
        message: "Origem WMS retornou HTTP 403.",
      });
    }
    networkReply();
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, resolver)
    ).resolves.toEqual(Buffer.from("OK"));
  });
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "127.0.0.1",
    "100.64.0.1",
    "100.127.255.254",
    "169.254.169.254",
    "169.254.170.2",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.2",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.1.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "ff02::1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "2001::1",
    "2001:2::1",
    "2001:10::1",
    "2002:7f00:1::1",
    "3fff::1",
    "not-ip",
  ])("rejects private, mapped, reserved or metadata IP %s", address =>
    expect(isPublicIp(address)).toBe(false)
  );
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2804:14c:5bb1::1",
  ])("permits public unicast %s", address =>
    expect(isPublicIp(address)).toBe(true)
  );
  it.each([
    "http://wms.example.org/ows",
    "https://user:password@wms.example.org/ows",
    "https://wms.example.org:443/ows",
    "https://wms.example.org:8443/ows",
    "https://wms.example.org/ows?token=1",
    "https://wms.example.org/ows?",
    "https://wms.example.org/ows#fragment",
    "https://wms.example.org/ows#",
    "https://127.0.0.1/ows",
    "https://2130706433/ows",
    "https://[::ffff:127.0.0.1]/ows",
    "https://[::1]:443/ows",
    "https://wms.example.org\\@127.0.0.1/ows",
  ])("rejects endpoints outside canonical HTTPS policy: %s", endpoint =>
    expect(() => canonicalEndpoint(endpoint)).toThrow()
  );
  it("requires every DNS A/AAAA to be public, not just the first", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "::1", family: 6 },
    ]);
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, resolver)
    ).rejects.toMatchObject({ kind: "FORBIDDEN" });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(() => pinnedLookup([])).toThrow();
    expect(() => pinnedLookup([{ address: "8.8.8.8", family: 6 }])).toThrow();
  });
  it("pins socket lookup to previously checked address, preserves TLS host and URI encodes parameters", async () => {
    networkReply();
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      requestPinnedWms(
        "https://wms.example.org/ows",
        { REQUEST: "GetMap", LAYERS: "namespace:a&URL=https://evil.invalid/x" },
        1024,
        resolver
      )
    ).resolves.toEqual(Buffer.from("OK"));
    expect(resolver).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.request.mock.calls[0];
    expect(url.origin).toBe("https://wms.example.org");
    expect(url.searchParams.get("LAYERS")).toBe(
      "namespace:a&URL=https://evil.invalid/x"
    );
    expect(url.searchParams.has("URL")).toBe(false);
    expect(options).toMatchObject({
      agent: false,
      rejectUnauthorized: true,
      servername: "wms.example.org",
    });
    const callback = vi.fn();
    options.lookup("wms.example.org", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    const callbackAll = vi.fn();
    options.lookup("wms.example.org", { all: true }, callbackAll);
    expect(callbackAll).toHaveBeenCalledWith(null, [
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it("never follows redirects even when Location points to internal metadata", async () => {
    networkReply({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    });
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).rejects.toThrow(/Redirect/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { body: Buffer.alloc(1025) },
    { headers: { "content-length": "1025" } },
    { headers: { "content-encoding": "gzip" } },
    { status: 500 },
  ])(
    "enforces streamed size, declared size, identity encoding and status %j",
    async reply => {
      networkReply(reply);
      await expect(
        requestPinnedWms("https://wms.example.org/ows", {}, 1024, async () => [
          { address: "8.8.8.8", family: 4 },
        ])
      ).rejects.toThrow();
    }
  );
  it("blocks private DNS without sending HTTP", async () => {
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, async () => [
        { address: "169.254.169.254", family: 4 },
      ])
    ).rejects.toThrow(/DNS/);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("strict TLS error is not retried with relaxed validation or HTTP", async () => {
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: vi.fn(),
    });
    mocks.request.mockImplementation(() => {
      request.end.mockImplementation(() =>
        queueMicrotask(() =>
          request.emit("error", new Error("CERT_HAS_EXPIRED"))
        )
      );
      return request;
    });
    await expect(
      requestPinnedWms("https://wms.example.org/ows", {}, 1024, async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).rejects.toThrow(/TLS/);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].rejectUnauthorized).toBe(true);
  });
  it("applies the 12s total timeout to a stuck DNS resolver", async () => {
    vi.useFakeTimers();
    const result = requestPinnedWms(
      "https://wms.example.org/ows",
      {},
      1024,
      () => new Promise(() => {})
    );
    const assertion = expect(result).rejects.toThrow(/12s/);
    await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs);
    await assertion;
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("applies the remaining total timeout to a stuck HTTPS request", async () => {
    vi.useFakeTimers();
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      end: vi.fn(),
    });
    mocks.request.mockReturnValue(request);
    const result = requestPinnedWms(
      "https://wms.example.org/ows",
      {},
      1024,
      async () => [{ address: "8.8.8.8", family: 4 }]
    );
    const assertion = expect(result).rejects.toThrow(/12s/);
    await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs);
    await assertion;
    expect(request.destroy).toHaveBeenCalled();
  });
});
