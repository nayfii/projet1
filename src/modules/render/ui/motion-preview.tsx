"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fontCss, prepareComposition, type CompositionInfo } from "../composition";
import { VENDOR } from "../vendor";

type Vendor = { gsap: string; runtime: string; latin: string; latinExt: string };
let vendor: Promise<Vendor> | null = null;

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function fetchOk(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  return response;
}

/** GSAP, the HyperFrames runtime and the fonts, loaded once per page from our own server. */
function loadVendor(): Promise<Vendor> {
  vendor ??= Promise.all([
    fetchOk(VENDOR.gsap).then((r) => r.text()),
    fetchOk(VENDOR.runtime).then((r) => r.text()),
    fetchOk(VENDOR.interLatin).then(async (r) => asDataUrl(await r.blob())),
    fetchOk(VENDOR.interLatinExt).then(async (r) => asDataUrl(await r.blob())),
  ])
    .then(([gsap, runtime, latin, latinExt]) => ({ gsap, runtime, latin, latinExt }))
    .catch((error: unknown) => {
      vendor = null;
      throw error;
    });
  return vendor;
}

/**
 * Plays the AI's composition in the browser before any video is made. The code runs in the HyperFrames
 * player's iframe with an opaque origin (no access to this page, its cookies or storage) and a policy
 * that blocks every request: libraries, fonts and images are inlined.
 */
export function MotionPreview({ html, info, assetIds }: { html: string; info: CompositionInfo; assetIds: Record<string, string> }) {
  const t = useTranslations("render");
  const box = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "failed">("loading");
  const assetKey = JSON.stringify(assetIds);

  React.useEffect(() => {
    let cancelled = false;
    let player: HTMLElement | null = null;
    const ids = JSON.parse(assetKey) as Record<string, string>;
    (async () => {
      try {
        const [files] = await Promise.all([loadVendor(), import("@hyperframes/player")]);
        const urls = new Map<string, string>();
        for (const name of info.assets) {
          if (!ids[name]) continue;
          const response = await fetch(`/api/attachments/${ids[name]}`);
          if (response.ok) urls.set(name, await asDataUrl(await response.blob()));
        }
        if (cancelled || !box.current) return;
        const srcdoc = prepareComposition(html, {
          mode: "preview",
          gsap: files.gsap,
          runtime: files.runtime,
          fontCss: fontCss({ latin: files.latin, latinExt: files.latinExt }),
          assetUrl: (name) => urls.get(name) ?? null,
        });
        player = document.createElement("hyperframes-player");
        // Opaque origin: the composition cannot reach this page. Set before the content is given.
        player.setAttribute("sandbox-origin", "opaque");
        player.setAttribute("controls", "");
        player.setAttribute("loop", "");
        // Compositions have no sound: the preview starts by itself, muted.
        player.setAttribute("autoplay", "");
        player.setAttribute("muted", "");
        player.setAttribute("width", String(info.width));
        player.setAttribute("height", String(info.height));
        player.setAttribute("aria-label", t("previewLabel"));
        player.style.cssText = "display:block;width:100%;height:100%";
        player.addEventListener("ready", () => !cancelled && setState("ready"));
        player.addEventListener("error", () => !cancelled && setState("failed"));
        box.current.replaceChildren(player);
        player.setAttribute("srcdoc", srcdoc);
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      player?.remove();
    };
  }, [html, info, assetKey, t]);

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-muted",
          info.format === "9:16" ? "max-w-[280px]" : info.format === "1:1" ? "max-w-[420px]" : "max-w-[640px]",
        )}
        style={{ aspectRatio: `${info.width} / ${info.height}` }}
      >
        <div ref={box} className="absolute inset-0" data-testid="motion-preview" />
        {state !== "ready" ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-muted-foreground">
            {state === "failed" ? t("previewFailed") : t("previewLoading")}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("previewHint")}</p>
    </div>
  );
}
