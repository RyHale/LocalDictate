import { useEffect, useMemo, useRef, useState } from "react";

import {
  assertSafeResolvedThemeAssetUrl,
  isSafeResolvedThemeAssetUrl,
} from "../assets";
import type { ThemeSignal, WebConfig } from "../schema";

interface WebRendererProps {
  config: WebConfig;
  width: number;
  height: number;
  signal: ThemeSignal;
  onError: (error: Error) => void;
}

const WEB_THEME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "img-src blob: data: asset: ipc: http://asset.localhost https://asset.localhost",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "navigate-to 'none'",
].join("; ");

const BOOTSTRAP = `
(() => {
  'use strict';
  let token = null;
  let latestSignal = null;
  const subscribers = new Set();
  const send = (type, detail) => parent.postMessage({ type, token, detail }, '*');
  addEventListener('message', async (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'localdictate:init' && token === null) {
      token = message.token;
      try {
        const moduleUrl = URL.createObjectURL(new Blob([message.entrySource], { type: 'text/javascript' }));
        let module;
        try {
          module = await import(moduleUrl);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
        const mount = module.mount || module.default;
        if (typeof mount !== 'function') throw new Error('Web theme must export mount or default');
        const api = Object.freeze({
          root: document.getElementById('theme-root'),
          assets: Object.freeze({ ...message.assets }),
          onSignal(callback) {
            if (typeof callback !== 'function') throw new TypeError('Signal subscriber must be a function');
            subscribers.add(callback);
            if (latestSignal) callback(latestSignal);
            return () => subscribers.delete(callback);
          },
          getSignal() { return latestSignal; }
        });
        await mount(api);
        send('localdictate:ready');
      } catch (error) {
        send('localdictate:error', error instanceof Error ? error.message : 'Web theme failed');
      }
      return;
    }
    if (message.type === 'localdictate:signal' && message.token === token) {
      latestSignal = Object.freeze({ ...message.signal, spectrum: Object.freeze([...message.signal.spectrum]) });
      for (const callback of [...subscribers]) {
        try { callback(latestSignal); } catch (error) {
          send('localdictate:error', error instanceof Error ? error.message : 'Signal handler failed');
        }
      }
    }
  });
})();
`;

function webThemeDocument(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WEB_THEME_CSP}"><meta name="referrer" content="no-referrer"><style>html,body,#theme-root{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}</style></head><body><div id="theme-root"></div><script>${BOOTSTRAP}</script></body></html>`;
}

function createBridgeToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function WebRenderer({
  config,
  width,
  height,
  signal,
  onError,
}: WebRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(createBridgeToken());
  const [entrySource, setEntrySource] = useState<string>();
  const sourceDocument = useMemo(webThemeDocument, []);

  const safeConfig = useMemo(() => {
    const entry = assertSafeResolvedThemeAssetUrl(config.entry);
    const assets = Object.fromEntries(
      Object.entries(config.assets ?? {}).map(([key, value]) => {
        if (!isSafeResolvedThemeAssetUrl(value)) {
          throw new Error("Web theme contains a non-local asset URL");
        }
        return [key, value];
      }),
    );
    return { entry, assets };
  }, [config.assets, config.entry]);

  useEffect(() => {
    let cancelled = false;
    fetch(safeConfig.entry)
      .then((response) => {
        if (!response.ok)
          throw new Error("Web theme entry could not be loaded");
        return response.text();
      })
      .then((source) => {
        if (source.length > 5 * 1024 * 1024) {
          throw new Error("Web theme entry exceeds the runtime size limit");
        }
        if (!cancelled) setEntrySource(source);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(
            error instanceof Error
              ? error
              : new Error("Web theme entry could not be loaded"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError, safeConfig.entry]);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object") return;
      const record = message as Record<string, unknown>;
      if (record.token !== tokenRef.current) return;
      if (record.type === "localdictate:error") {
        onError(
          new Error(
            typeof record.detail === "string"
              ? record.detail
              : "Web theme failed",
          ),
        );
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onError]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "localdictate:signal",
        token: tokenRef.current,
        signal,
      },
      "*",
    );
  }, [signal]);

  if (signal.reducedMotion) {
    const reducedMotionAsset = assertSafeResolvedThemeAssetUrl(
      config.reducedMotionAsset,
    );
    return (
      <img
        alt=""
        aria-hidden="true"
        height={height}
        src={reducedMotionAsset}
        style={{ display: "block", height, objectFit: "contain", width }}
        width={width}
      />
    );
  }

  if (entrySource === undefined) return null;

  return (
    <iframe
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'; serial 'none'; bluetooth 'none'; midi 'none'; display-capture 'none'"
      aria-hidden="true"
      onLoad={() => {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "localdictate:init",
            token: tokenRef.current,
            entrySource,
            assets: safeConfig.assets,
          },
          "*",
        );
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "localdictate:signal",
            token: tokenRef.current,
            signal,
          },
          "*",
        );
      }}
      ref={iframeRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={sourceDocument}
      style={{
        background: "transparent",
        border: 0,
        display: "block",
        height,
        pointerEvents: "none",
        width,
      }}
      title=""
    />
  );
}

export { WEB_THEME_CSP };
