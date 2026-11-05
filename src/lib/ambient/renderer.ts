import type { AmbientPalette } from "./palettes";

/**
 * The living background, drawn by the graphics chip (WebGL): every pixel is computed, so the
 * gradients stay smooth at any size (no blur, no image to scale), with a fine dither against colour
 * banding. Two scenes: "silk" (lit folds that sway, after the founder's violet reference) and "glow"
 * (a band of light over a dark wave, after the amber sunset). One small shader, no library.
 */
const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_scene;
uniform float u_light;
uniform vec3 u_base;
uniform vec3 u_deep;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform vec3 u_rim;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Silk: vertical folds whose course sways with height and time; an asymmetric profile (a crisp
// crest, a soft hollow), as cloth falls.
float silk(vec2 p, float t) {
  float w = p.x * 1.45
    + 0.22 * sin(p.y * 2.3 + t * 0.34)
    + 0.13 * sin(p.y * 3.9 - t * 0.27 + p.x * 1.7)
    + 0.08 * sin(p.y * 1.1 + t * 0.19 + 1.3);
  float a = w * 6.2831;
  return sin(a) + 0.28 * sin(2.0 * a + 1.1);
}

vec3 silkScene(vec2 uv, vec2 p, float t) {
  float e = 1.5 / u_res.y;
  float h = silk(p, t);
  float hx = (silk(p + vec2(e, 0.0), t) - silk(p - vec2(e, 0.0), t)) / (2.0 * e);
  float hy = (silk(p + vec2(0.0, e), t) - silk(p - vec2(0.0, e), t)) / (2.0 * e);
  vec3 n = normalize(vec3(-hx * 0.055, -hy * 0.055, 1.0));
  vec3 l = normalize(vec3(-0.55, 0.45, 0.7));
  float diff = clamp(dot(n, l), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 28.0);
  float edge = pow(1.0 - n.z, 1.5);

  // Colour drifts slowly across the cloth.
  float m1 = noise(p * 0.9 + vec2(t * 0.025, -t * 0.02));
  float m2 = noise(p * 1.4 - vec2(t * 0.018, t * 0.03) + 7.0);
  vec3 tint = mix(u_c1, u_c2, smoothstep(0.15, 0.85, uv.x * 0.7 + m1 * 0.6));
  tint = mix(tint, u_c3, smoothstep(0.45, 0.95, (1.0 - uv.x) * 0.6 + m2 * 0.5) * 0.65);
  tint = mix(tint, u_c4, smoothstep(0.55, 0.95, m1 * 0.7 + (1.0 - uv.y) * 0.45) * 0.7);

  vec3 col;
  if (u_light < 0.5) {
    float lit = diff * diff;
    col = mix(u_base, tint, 0.08 + 0.92 * lit);
    col += tint * edge * 0.35;
    col += u_rim * spec * 0.42;
    col = mix(col, u_deep, smoothstep(0.35, -0.9, h) * 0.35);
    float v = smoothstep(1.35, 0.25, length(p * vec2(0.85, 1.05)));
    col *= mix(0.45, 1.0, v);
  } else {
    // Satin: broad, soft highlights rather than lines.
    float lit = 0.15 + 0.85 * diff;
    float sheen = pow(clamp(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 6.0);
    col = mix(u_deep, mix(u_base, tint, 0.6), lit);
    col = mix(col, u_rim, sheen * 0.35);
    col = mix(col, tint, edge * 0.35);
  }
  return col;
}

// Glow: a band of light from gold to red over a dark wave, a violet glow below.
vec3 glowScene(vec2 uv, float t) {
  float y0 = 0.66 + 0.05 * sin(uv.x * 2.2 + t * 0.28) + 0.025 * sin(uv.x * 4.6 - t * 0.21);
  float band = exp(-pow((uv.y - y0) / 0.23, 2.0));
  float core = exp(-pow((uv.y - y0 - 0.01) / 0.07, 2.0));
  float x = uv.x + 0.05 * sin(uv.y * 3.0 + t * 0.2);
  vec3 bandCol = mix(u_c1, u_c2, smoothstep(0.0, 0.35, x));
  bandCol = mix(bandCol, u_c3, smoothstep(0.3, 0.7, x));
  bandCol = mix(bandCol, u_c4, smoothstep(0.65, 1.0, x));
  // The dark wave rises on the left and falls away on the right, biting into the band.
  float yh = 0.42 + 0.14 * sin(uv.x * 2.2 + 1.2 + t * 0.14) + 0.035 * sin(uv.x * 5.3 - t * 0.11);
  float hill = smoothstep(yh + 0.07, yh - 0.07, uv.y);
  float glow = exp(-(pow((uv.x - 0.45 - 0.05 * sin(t * 0.17)) / 0.38, 2.0) + pow(uv.y / 0.24, 2.0)));

  vec3 col;
  if (u_light < 0.5) {
    col = mix(u_deep, u_base, smoothstep(0.0, 0.9, uv.y));
    col += bandCol * (band * 0.72 + core * 0.22);
    col = mix(col, u_base * 0.85 + u_deep * 0.25, hill * 0.9);
    col += u_rim * glow * 0.75;
    col *= mix(0.6, 1.0, smoothstep(1.3, 0.3, length((uv - 0.5) * vec2(1.2, 1.0))));
  } else {
    col = mix(u_deep, u_base, smoothstep(0.0, 0.9, uv.y));
    col = mix(col, bandCol, band * 0.75 + core * 0.15);
    col = mix(col, mix(u_base, vec3(1.0), 0.35), hill * 0.7);
    col = mix(col, u_rim, glow * 0.45);
  }
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  vec3 col = u_scene < 0.5 ? silkScene(uv, p, u_time) : glowScene(uv, u_time);
  // Dither (and a whisper of grain): no visible colour steps in the dark gradients.
  col += (hash(gl_FragCoord.xy + fract(u_time * 7.0) * vec2(17.0, 31.0)) - 0.5) * (2.2 / 255.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export type AmbientRenderer = {
  draw: (seconds: number, palette: AmbientPalette) => void;
  size: (width: number, height: number) => void;
  destroy: () => void;
};

/** A renderer on this canvas, or null when the browser has no WebGL (a CSS gradient stands in). */
export function createAmbientRenderer(canvas: HTMLCanvasElement): AmbientRenderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("ambient shader");
    return shader;
  };
  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(program);

  // One triangle covering the screen.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    res: u("u_res"),
    time: u("u_time"),
    scene: u("u_scene"),
    light: u("u_light"),
    base: u("u_base"),
    deep: u("u_deep"),
    c1: u("u_c1"),
    c2: u("u_c2"),
    c3: u("u_c3"),
    c4: u("u_c4"),
    rim: u("u_rim"),
  };
  let current: AmbientPalette | null = null;

  return {
    size(width, height) {
      gl.viewport(0, 0, width, height);
      gl.uniform2f(loc.res, width, height);
    },
    draw(seconds, palette) {
      if (palette !== current) {
        current = palette;
        gl.uniform1f(loc.scene, palette.scene === "glow" ? 1 : 0);
        gl.uniform1f(loc.light, palette.scheme === "light" ? 1 : 0);
        gl.uniform3fv(loc.base, rgb(palette.colors.base));
        gl.uniform3fv(loc.deep, rgb(palette.colors.deep));
        gl.uniform3fv(loc.c1, rgb(palette.colors.c1));
        gl.uniform3fv(loc.c2, rgb(palette.colors.c2));
        gl.uniform3fv(loc.c3, rgb(palette.colors.c3));
        gl.uniform3fv(loc.c4, rgb(palette.colors.c4));
        gl.uniform3fv(loc.rim, rgb(palette.colors.rim));
      }
      gl.uniform1f(loc.time, seconds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** A still image of a palette (for the Appearance previews), drawn once and handed back as a URL. */
export function renderAmbientStill(palette: AmbientPalette, width: number, height: number, seconds = 12): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createAmbientRenderer(canvas);
  if (!renderer) return null;
  renderer.size(width, height);
  renderer.draw(seconds, palette);
  const url = canvas.toDataURL("image/png");
  renderer.destroy();
  return url;
}
