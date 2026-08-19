/* =========================================================
 * sound.js
 * WebAudio 合成による効果音・環境音 (音声ファイル不要)
 *
 * ブラウザの自動再生ポリシーのため、最初のタッチ/クリックで
 * resume() が呼ばれるまで音は出ない。キオスク常設で無操作でも
 * 鳴らしたい場合は Chromium を
 *   --autoplay-policy=no-user-gesture-required
 * 付きで起動する (server/README.md 参照)
 * ========================================================= */

"use strict";

const Sound = (() => {

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem("op-muted") === "1"; } catch (e) {}
  let isDay = true;
  let birdTimer = null;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startAmbient();
    return true;
  }

  function resume() {
    if (!ensure()) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  /* ---- 基本部品 ---- */

  function tone(freq, dur, opts = {}) {
    if (!ctx || muted) return;
    const { type = "sine", vol = 0.2, to = null, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, opts = {}) {
    if (!ctx || muted) return;
    const { vol = 0.2, freq = 1000, q = 1.2, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }

  /* ---- 効果音 ---- */

  const FX = {
    release() {                       // 放流: シュポーン + キラキラ
      tone(320, 0.35, { to: 900, vol: 0.25, type: "triangle" });
      [1200, 1500, 1800].forEach((f, i) => tone(f, 0.16, { delay: 0.26 + i * 0.07, vol: 0.12 }));
    },
    rare() {                          // きらきら個体のファンファーレ
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, { delay: i * 0.12, vol: 0.2, type: "triangle" }));
      [2093, 2637, 3136].forEach((f, i) => tone(f, 0.22, { delay: 0.5 + i * 0.09, vol: 0.09 }));
    },
    bubble() {                        // さかな
      for (let i = 0; i < 3; i++) {
        tone(380 + Math.random() * 160, 0.1, { to: 170, delay: i * 0.09, vol: 0.15 });
      }
    },
    chirp() {                         // とり
      for (let i = 0; i < 2; i++) {
        tone(1800, 0.07, { to: 2500, delay: i * 0.17, vol: 0.11 });
        tone(2400, 0.06, { to: 1600, delay: i * 0.17 + 0.07, vol: 0.09 });
      }
    },
    horn() {                          // くるま
      tone(300, 0.16, { type: "square", vol: 0.1 });
      tone(240, 0.16, { type: "square", vol: 0.1 });
      tone(300, 0.2, { type: "square", vol: 0.1, delay: 0.22 });
      tone(240, 0.2, { type: "square", vol: 0.1, delay: 0.22 });
    },
    yay() {                           // にんげん
      tone(500, 0.14, { to: 900, type: "triangle", vol: 0.18 });
      tone(650, 0.2, { to: 1100, delay: 0.12, type: "triangle", vol: 0.16 });
    },
    whoosh() {                        // ロケット
      noise(0.5, { freq: 500, vol: 0.16, q: 0.7 });
      tone(150, 0.45, { to: 420, vol: 0.1, type: "sawtooth" });
    },
    roar() {                          // きょうりゅう
      tone(130, 0.45, { to: 75, type: "sawtooth", vol: 0.18 });
      noise(0.45, { freq: 350, vol: 0.12, q: 0.6 });
    },
    munch() {                         // エサを食べた
      noise(0.06, { freq: 900, vol: 0.25 });
      noise(0.07, { freq: 700, delay: 0.12, vol: 0.22 });
      noise(0.06, { freq: 1100, delay: 0.24, vol: 0.18 });
    },
    plop() {                          // エサを落とした
      tone(600, 0.1, { to: 150, vol: 0.2 });
    },
    heart() {                         // ふれあい
      tone(900, 0.13, { to: 1350, vol: 0.08, type: "triangle" });
    },
    twinkle() {                       // 流れ星
      tone(1900 + Math.random() * 600, 0.5, { to: 900, vol: 0.08 });
    },
    splash() {                        // クジラの潮ふき
      noise(0.5, { freq: 1200, vol: 0.14 });
    },
    rain() {
      noise(1.2, { freq: 3000, vol: 0.05, q: 0.5 });
    },
  };

  function fx(name) {
    if (!ensure() || muted) return;
    const f = FX[name];
    if (f) f();
  }

  /* ---- 環境音: 波 + (昼だけ) ときどき鳥 ---- */

  function startAmbient() {
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    // 寄せては返すゆらぎ
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    s.connect(f).connect(g).connect(master);
    s.start();
    lfo.start();

    if (birdTimer) clearInterval(birdTimer);
    birdTimer = setInterval(() => {
      if (isDay && !muted && Math.random() < 0.5) {
        tone(2000 + Math.random() * 600, 0.06, { to: 2800, vol: 0.03 });
        tone(2600, 0.05, { to: 1900, delay: 0.08, vol: 0.025 });
      }
    }, 9000);
  }

  function setDay(day) { isDay = day; }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem("op-muted", muted ? "1" : "0"); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  function isMuted() { return muted; }

  return { resume, fx, toggleMute, isMuted, setDay };
})();
