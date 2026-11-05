import { AmbientCanvas } from "./ambient-canvas";
import { WaylumeLayer } from "@/components/ambient/waylume-layer";

/**
 * The living background of the Atmosphère interface (styles: app/appearance.css). Hidden with Clair
 * and Sombre, which are plain. The canvas is drawn by the graphics chip; a soft gradient of the
 * palette's colours shows until it draws, and stays when WebGL is missing.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="ambient">
      <AmbientCanvas />
      <WaylumeLayer />
    </div>
  );
}
