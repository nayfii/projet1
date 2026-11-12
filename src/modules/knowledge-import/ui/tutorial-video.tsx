import { useTranslations } from "next-intl";
import { FilmIcon } from "lucide-react";

/** A YouTube or Vimeo link as its privacy-friendly embed address; null for a plain video file. */
export function embedAddress(url: string): string | null {
  try {
    const u = new URL(url, "https://local.invalid");
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const id = u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).at(-1);
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) {
      const id = u.pathname.split("/").filter(Boolean).at(-1);
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The slot for the tutorial video (how to export one's data from former tools). Until a video is set
 * (IMPORT_TUTORIAL_VIDEO_URL), a quiet placeholder says so: no play button, nothing to click.
 */
export function TutorialVideo({ url }: { url: string | null }) {
  const t = useTranslations("knowledgeImport");
  const embed = url ? embedAddress(url) : null;
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card" data-testid="import-tutorial">
      {/* 16:9 once a video is set; until then a short band, so the empty slot does not take the page. */}
      <div className={url ? "relative aspect-video w-full" : "relative h-32 w-full sm:h-36"}>
        {url && embed ? (
          <iframe src={embed} title={t("videoTitle")} className="absolute inset-0 size-full" allow="fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />
        ) : url ? (
          <video src={url} controls preload="metadata" className="absolute inset-0 size-full bg-black object-contain">
            {t("videoTitle")}
          </video>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(ellipse_at_center,var(--color-muted)_0%,transparent_70%)] px-6 text-center">
            <FilmIcon className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{t("videoSoon")}</p>
            <p className="max-w-sm text-xs text-muted-foreground">{t("videoSoonBody")}</p>
          </div>
        )}
      </div>
    </figure>
  );
}
