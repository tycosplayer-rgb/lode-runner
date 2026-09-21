/**
 * 淘金者 — Web Audio 合成 NES 风格音效
 * 首次用户手势后解锁 AudioContext；静音偏好存 localStorage
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "lode-runner-muted";

  let ctx = null;
  let unlocked = false;
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_) {}

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  }

  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") {
      c.resume().catch(() => {});
    }
    // 极短静音缓冲，满足部分浏览器的“已播放”要求
    try {
      const buf = c.createBuffer(1, 1, c.sampleRate);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch (_) {}
    unlocked = true;
  }

  function isMuted() {
    return muted;
  }

  function setMuted(v) {
    muted = !!v;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (_) {}
    if (!muted) unlock();
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  function now() {
    const c = ensureCtx();
    return c ? c.currentTime : 0;
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (muted) return;
    const c = ensureCtx();
    if (!c || c.state === "suspended") return;
    const t0 = when != null ? when : c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    }
    const v = (vol != null ? vol : 0.08);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, when, hpFreq) {
    if (muted) return;
    const c = ensureCtx();
    if (!c || c.state === "suspended") return;
    const t0 = when != null ? when : c.currentTime;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = hpFreq || 800;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    const v = vol != null ? vol : 0.12;
    gain.gain.setValueAtTime(v, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    dig() {
      noise(0.08, 0.14, null, 600);
      tone(180, 0.06, "square", 0.06, now(), 90);
    },
    gold() {
      const t = now();
      tone(880, 0.07, "square", 0.09, t);
      tone(1175, 0.09, "square", 0.08, t + 0.06);
      tone(1568, 0.12, "square", 0.07, t + 0.12);
    },
    trap() {
      tone(220, 0.1, "triangle", 0.08, now(), 110);
      noise(0.06, 0.08, now(), 400);
    },
    enemyDie() {
      const t = now();
      tone(400, 0.08, "sawtooth", 0.07, t, 120);
      tone(200, 0.12, "square", 0.06, t + 0.08, 60);
      noise(0.1, 0.1, t + 0.05, 300);
    },
    die() {
      const t = now();
      tone(400, 0.1, "square", 0.09, t, 200);
      tone(250, 0.12, "square", 0.08, t + 0.1, 100);
      tone(120, 0.2, "triangle", 0.07, t + 0.2, 50);
    },
    clear() {
      const t = now();
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => tone(f, 0.14, "square", 0.08, t + i * 0.1));
    },
    win() {
      const t = now();
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
        tone(f, 0.12, "square", 0.07, t + i * 0.09)
      );
    },
    start() {
      const t = now();
      tone(330, 0.08, "square", 0.07, t);
      tone(440, 0.08, "square", 0.07, t + 0.08);
      tone(554, 0.12, "square", 0.08, t + 0.16);
    },
    ui() {
      tone(660, 0.04, "square", 0.05);
    },
    step() {
      tone(90, 0.025, "triangle", 0.03);
    },
    exit() {
      const t = now();
      tone(700, 0.08, "square", 0.06, t);
      tone(1050, 0.15, "square", 0.07, t + 0.08);
    },
    gameOver() {
      const t = now();
      tone(300, 0.15, "square", 0.08, t, 150);
      tone(150, 0.25, "triangle", 0.07, t + 0.15, 60);
    },
  };

  // 首次手势解锁
  function bindUnlock() {
    const once = () => {
      unlock();
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
      window.removeEventListener("touchstart", once, true);
    };
    window.addEventListener("pointerdown", once, true);
    window.addEventListener("keydown", once, true);
    window.addEventListener("touchstart", once, true);
  }
  bindUnlock();

  global.LodeAudio = {
    unlock,
    isMuted,
    setMuted,
    toggleMute,
    play(name) {
      if (typeof SFX[name] === "function") SFX[name]();
    },
    SFX,
  };
})(window);
