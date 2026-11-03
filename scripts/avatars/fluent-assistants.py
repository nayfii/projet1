"""
The AI assistants' characters (CLAUDE.md §11, founder's reference: a soft, glossy 3D robot).

Base: Microsoft's Fluent Emoji "Robot" 3D (MIT licence, public/avatars/assistants/LICENSE-fluent-emoji.txt),
downloaded from github.com/microsoft/fluentui-emoji (assets/Robot/3D/robot_3d.png).
For each assistant: the antennas and the top light take its colour, and the eyes and mouth are removed
(painted over with the colours around them) so the app draws them live and animates them
(src/modules/avatars/ui/assistant-avatar.tsx, geometry in src/modules/avatars/assistants.ts).

Run: python3 -I scripts/avatars/fluent-assistants.py <robot_3d.png> public/avatars/assistants
"""
import colorsys
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Hue (degrees) the antennas and top light take, per assistant; None keeps the original colours.
HUES = {"auto": None, "openai": 158, "anthropic": 22, "google": 212}
EYES = [(75, 95, 94, 131), (162, 95, 181, 131)]  # x0, y0, x1, y1 on the 256 px image
MOUTH = (97, 184, 158, 206)
MARGIN = 8


def inpaint(px: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> None:
    """Fills the boxes smoothly from the colours around them (repeated averaging, like a soft blur inwards)."""
    mask = np.zeros(px.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in boxes:
        mask[y0 - MARGIN : y1 + MARGIN + 1, x0 - MARGIN : x1 + MARGIN + 1] = True
    rgb = px[..., :3].astype(float)
    # Start from the row-wise blend, then relax: each masked pixel becomes the mean of its neighbours.
    for _ in range(1500):
        avg = (np.roll(rgb, 1, 0) + np.roll(rgb, -1, 0) + np.roll(rgb, 1, 1) + np.roll(rgb, -1, 1)) / 4
        rgb[mask] = avg[mask]
    px[..., :3] = rgb.round().clip(0, 255).astype(np.uint8)


def recolour(px: np.ndarray, hue: float) -> None:
    """Moves the bright, saturated parts (antennas, top light) to `hue`, keeping their light and shade."""
    h, w = px.shape[:2]
    for y in range(h):
        for x in range(w):
            r, g, b, a = (int(v) for v in px[y, x])
            if a < 10:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            # The visor (and its lit rim) keeps its colours.
            if 34 <= x <= 222 and 70 <= y <= 165:
                continue
            if ss > 0.45 and vv > 0.45:
                nr, ng, nb = colorsys.hsv_to_rgb(hue / 360, min(1.0, ss * 0.85), vv)
                px[y, x, :3] = (round(nr * 255), round(ng * 255), round(nb * 255))


def main(source: str, out_dir: str) -> None:
    base = np.array(Image.open(source).convert("RGBA"))
    inpaint(base, [*EYES, MOUTH])
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    for name, hue in HUES.items():
        px = base.copy()
        if hue is not None:
            recolour(px, hue)
        Image.fromarray(px).save(Path(out_dir) / f"{name}.webp", "WEBP", lossless=True, method=6)
        print("wrote", name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
