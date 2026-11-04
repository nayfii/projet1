import { AmbientMotion } from "./ambient-motion";

/**
 * The living background behind the glass (styles: app/appearance.css, "The living background").
 * Two sets, one shown at a time: Midnight Aurora (silk folds with lit edges, violet and night blue)
 * and Solar Ember (a band of amber light over a dark wave, a violet glow below). Each set has two
 * layers that sway very slowly; colours follow the tokens, so light and dark schemes share the shapes.
 * Static markup, painted once; AmbientMotion only nudges the two layers a few times a second.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="ambient">
      <AmbientMotion />
      <svg width="0" height="0" className="absolute" focusable="false">
        <defs>
          <filter id="amb-blur-xl" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2800" height="2200">
            <feGaussianBlur stdDeviation="64" />
          </filter>
          <filter id="amb-blur-lg" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2800" height="2200">
            <feGaussianBlur stdDeviation="34" />
          </filter>
          <filter id="amb-blur-md" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2800" height="2200">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id="amb-blur-sm" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2800" height="2200">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
      </svg>

      <AmbientScene ambient="aurora" />
      <AmbientScene ambient="ember" />

      <div className="ambient-grain" />
      <div className="ambient-scrim" />
    </div>
  );
}

/** One background's shapes (the colours come from the tokens of the current scheme). */
export function AmbientScene({ ambient }: { ambient: "aurora" | "ember" }) {
  if (ambient === "aurora") {
    return (
      <div className="ambient-set" data-set="aurora">
        <Layer>
          <ellipse cx="260" cy="760" rx="520" ry="360" className="amb-fill-plum" opacity="0.45" filter="url(#amb-blur-xl)" />
          <ellipse cx="1420" cy="160" rx="420" ry="300" className="amb-fill-violet" opacity="0.18" filter="url(#amb-blur-xl)" />
        </Layer>
        <Layer sway="a">
          <Fold d="M 200 -80 C 70 180 40 360 150 540 C 260 720 320 860 250 1080" glow="blue" />
          <Fold d="M 990 -80 C 860 140 770 320 870 480 C 970 640 1110 720 1050 1080" glow="plum" />
        </Layer>
        <Layer sway="b">
          <Fold d="M 580 -80 C 400 120 320 300 440 470 C 560 640 640 760 540 1080" glow="violet" />
          <Fold d="M 1330 -80 C 1210 160 1150 330 1250 500 C 1350 670 1450 820 1410 1080" glow="indigo" />
        </Layer>
      </div>
    );
  }
  return (
    <div className="ambient-set" data-set="ember">
      <Layer>
        <ellipse cx="720" cy="1090" rx="680" ry="280" className="amb-fill-violet" opacity="0.85" filter="url(#amb-blur-xl)" />
        <ellipse cx="1480" cy="820" rx="440" ry="320" className="amb-fill-plum" opacity="0.7" filter="url(#amb-blur-xl)" />
      </Layer>
      <Layer sway="a">
        {/* The band of light: overlapping glows from gold to red, merged by the blur (solid fills
            take their colour where they are drawn, so a preview can show this set on any page). */}
        <g className="amb-ember-band" filter="url(#amb-blur-xl)">
          <ellipse cx="60" cy="390" rx="380" ry="150" className="amb-fill-gold" />
          <ellipse cx="430" cy="370" rx="420" ry="165" className="amb-fill-amber" />
          <ellipse cx="830" cy="355" rx="430" ry="170" className="amb-fill-coral" />
          <ellipse cx="1200" cy="345" rx="410" ry="165" className="amb-fill-orange" />
          <ellipse cx="1540" cy="340" rx="380" ry="160" className="amb-fill-red" />
        </g>
      </Layer>
      <Layer sway="b">
        <path
          d="M -220 1160 L -220 700 C 80 560 420 520 690 650 C 900 750 1030 860 1300 860 C 1500 860 1700 820 1860 790 L 1860 1160 Z"
          className="amb-fill-hill"
          opacity="0.94"
          filter="url(#amb-blur-lg)"
        />
      </Layer>
    </div>
  );
}

/** A small, still copy of a background, for the Appearance settings. */
export function AmbientPreview({ ambient, className }: { ambient: "aurora" | "ember"; className?: string }) {
  return (
    <div aria-hidden className={`ambient ambient-preview ${className ?? ""}`} data-ambient-scope={ambient}>
      <AmbientScene ambient={ambient} />
      <div className="ambient-grain" />
    </div>
  );
}

function Layer({ sway, children }: { sway?: "a" | "b"; children: React.ReactNode }) {
  return (
    <div className="ambient-layer" data-sway={sway}>
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        {children}
      </svg>
    </div>
  );
}

/** One silk fold: the shadow it casts to its right, a soft coloured glow, and its lit edge. */
function Fold({ d, glow }: { d: string; glow: "violet" | "plum" | "blue" | "indigo" }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} transform="translate(95 0)" className="amb-shade" strokeWidth="190" filter="url(#amb-blur-lg)" />
      <path d={d} transform="translate(-90 0)" className={`amb-glow-${glow}`} strokeWidth="300" filter="url(#amb-blur-xl)" />
      <path d={d} transform="translate(-14 0)" className="amb-rim-soft" strokeWidth="44" filter="url(#amb-blur-md)" />
      <path d={d} className="amb-rim" strokeWidth="3" filter="url(#amb-blur-sm)" />
    </g>
  );
}
