/**
 * While a Waylume scene is shown, animation frames are capped at about 60 per second. The scene's
 * engine (kept verbatim) draws on every frame the screen offers: 120 on many recent laptops, which
 * doubles the graphics work for a slow drift nobody can tell apart at 60. Every animation of the
 * page shares the cap (60 frames a second stays smooth). Installed by the Waylume layer only; once
 * no scene is shown, the browser's own functions come back as soon as no frame asked through the
 * cap is still waiting (so a cancel never reaches the wrong function).
 */

type Pending = { native: number };

/** One frame every 1/60 s, on any screen (60, 90, 120, 144 Hz…): frames come when due, a little early is fine. */
const INTERVAL_MS = 1000 / 60;
const EARLY_MS = 2;
/** Our ids start far from the browser's, so a cancel with an id from before the cap is never mistaken for ours. */
const FIRST_ID = 1_000_000_000;

let users = 0;
let installed: { raf: typeof window.requestAnimationFrame; caf: typeof window.cancelAnimationFrame } | null = null;
const pending = new Map<number, Pending>();

export function capFrames(): () => void {
  if (typeof window === "undefined") return () => {};
  users += 1;
  if (!installed) install();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    restoreIfIdle();
  };
}

function install() {
  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  installed = { raf, caf };
  let nextId = FIRST_ID;
  let lastFrame = -Infinity;
  let nextDue = -Infinity;

  const schedule = (id: number, callback: FrameRequestCallback) => {
    const native = raf.call(window, (time) => {
      // A frame is used when it is due (all callbacks of one frame share its time); the next is due 1/60 s later.
      if (time !== lastFrame) {
        if (users > 0 && time < nextDue - EARLY_MS) return schedule(id, callback);
        nextDue = Math.max(nextDue + INTERVAL_MS, time + INTERVAL_MS / 2);
        lastFrame = time;
      }
      pending.delete(id);
      try {
        callback(time);
      } finally {
        restoreIfIdle();
      }
    });
    pending.set(id, { native });
  };

  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    schedule(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    const entry = pending.get(id);
    if (entry) {
      caf.call(window, entry.native);
      pending.delete(id);
      restoreIfIdle();
    } else {
      caf.call(window, id); // a frame asked before the cap was installed
    }
  };
}

function restoreIfIdle() {
  if (!installed || users > 0 || pending.size > 0) return;
  window.requestAnimationFrame = installed.raf;
  window.cancelAnimationFrame = installed.caf;
  installed = null;
}
