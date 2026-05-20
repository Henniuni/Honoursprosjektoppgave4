'use strict';
// "Settlement" — original ambient piece for Catan, C418-inspired
// Composed in G major, 63 BPM, 16 bars, piano + sparse bass + reverb

window.CatanMusic = (() => {
  let ctx = null;
  let master = null;
  let dryBus = null;
  let wetBus = null;
  let running = false;
  let loopTimer = null;

  const BPM = 63;
  const Q  = 60 / BPM;        // quarter  ≈ 0.952 s
  const H  = Q * 2;            // half
  const W  = Q * 4;            // whole
  const E  = Q / 2;            // eighth
  const DQ = Q * 1.5;          // dotted quarter
  const DH = Q * 3;            // dotted half

  // Equal-temperament frequency from note name like "G4", "C3"
  function hz(n) {
    const steps = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    return 440 * Math.pow(2, (steps[n[0]] - 9 + (+n[1] - 4) * 12) / 12);
  }

  function initCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Noise-based convolver reverb (2.5 s room)
    const len = Math.floor(ctx.sampleRate * 2.5);
    const ir  = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    conv.connect(master);

    wetBus = ctx.createGain();
    wetBus.gain.value = 0.30;
    wetBus.connect(conv);

    dryBus = ctx.createGain();
    dryBus.gain.value = 1.0;
    dryBus.connect(master);
  }

  // Synthesise one piano note: sine fundamental + weak 2nd harmonic + ADSR envelope
  function note(freq, t, dur, vol) {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g  = ctx.createGain();
    const g2 = ctx.createGain();

    o1.type = 'sine';  o1.frequency.value = freq;
    o2.type = 'sine';  o2.frequency.value = freq * 2;
    g2.gain.value = 0.15;

    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(dryBus);
    g.connect(wetBus);

    const atk = 0.004;
    const dec = freq < 220 ? 0.35 : 0.14;   // bass has slower decay
    const sus = freq < 220 ? 0.60 : 0.48;
    const rel = Math.max(0.4, Math.min(dur * 0.5, 1.0));

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.linearRampToValueAtTime(vol * sus, t + atk + dec);
    g.gain.setValueAtTime(vol * sus, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + rel);

    const end = t + dur + rel + 0.1;
    o1.start(t); o1.stop(end);
    o2.start(t); o2.stop(end);
  }

  // ── "Settlement" — original composition ──────────────────────────────────────
  //
  //  G major, 63 BPM, 4/4 time, 16 bars.
  //  Structure: A (bars 1–4) · B (bars 5–8) · C (bars 9–12) · D (bars 13–16)
  //
  function buildScore(t0) {
    const m = (f, t, d, v = 0.70) => note(hz(f), t0 + t, d, v);
    const b = (f, t, d, v = 0.26) => note(hz(f), t0 + t, d, v);  // bass
    const p = (f, t, d, v = 0.11) => note(hz(f), t0 + t, d, v);  // pad (very soft)

    // ── Phrase A — opening (bars 1–4) ──
    m('G4', 0,         H);
    m('E4', H,         Q);
    m('D4', H + Q,     Q);

    m('C4', W,         DH);
    m('D4', W + DH,    Q);

    m('E4', W * 2,     H);
    m('G4', W * 2 + H, Q);
    m('E4', W * 2 + H + Q, Q);

    m('D4', W * 3,     W);

    // ── Phrase B — development (bars 5–8) ──
    m('G4', W * 4,         Q);
    m('A4', W * 4 + Q,     Q);
    m('B4', W * 4 + H,     H);

    m('G4', W * 5,         H);
    m('E4', W * 5 + H,     H);

    m('D4', W * 6,         Q);
    m('G4', W * 6 + Q,     Q);
    m('A4', W * 6 + H,     H);

    m('G4', W * 7,         W);

    // ── Phrase C — peak (bars 9–12) ──
    m('E4', W * 8,         H);
    m('G4', W * 8 + H,     H);

    m('A4', W * 9,         DQ);
    m('G4', W * 9 + DQ,    E);
    m('E4', W * 9 + DQ + E,     Q);
    m('D4', W * 9 + DQ + E + Q, Q);

    m('B4', W * 10,        H,  0.62);
    m('G4', W * 10 + H,    H,  0.62);

    m('A4', W * 11,        W);

    // ── Phrase D — resolution (bars 13–16) ──
    m('G4', W * 12,        Q);
    m('E4', W * 12 + Q,    Q);
    m('D4', W * 12 + H,    H);

    m('C4', W * 13,        DH);
    m('D4', W * 13 + DH,   Q);

    m('E4', W * 14,        H);
    m('D4', W * 14 + H,    H);

    m('G4', W * 15,        W);

    // ── Bass — one root note per bar (G major tonal centres) ──
    b('G3', 0,     W);     // I
    b('C3', W,     W);     // IV
    b('G3', W * 2, W);     // I
    b('D3', W * 3, W);     // V
    b('C3', W * 4, W * 2); // IV (bars 5–6)
    b('D3', W * 6, W);     // V
    b('G3', W * 7, W);     // I
    b('E3', W * 8, W);     // vi
    b('D3', W * 9, W * 2); // V (bars 10–11)
    b('D3', W * 11, W);    // V pedal bar 12
    b('G3', W * 12, W);    // I
    b('C3', W * 13, W);    // IV
    b('G3', W * 14, W * 2);// I (bars 15–16)

    // ── Pad — sustained background colour (very quiet) ──
    p('B3', 0,      W * 4); // phrase A: G major warmth
    p('E3', W * 4,  W * 4); // phrase B: C/G colour
    p('C4', W * 8,  W * 2); // phrase C opening
    p('B3', W * 10, W * 2); // phrase C close
    p('B3', W * 12, W * 4); // phrase D: back to home
  }

  const LOOP_LEN = W * 16;  // 16 bars ≈ 61 s

  function scheduleLoop(t0) {
    buildScore(t0);
    const msUntilEnd = (t0 + LOOP_LEN - ctx.currentTime - 0.5) * 1000;
    loopTimer = setTimeout(() => {
      if (running) scheduleLoop(t0 + LOOP_LEN);
    }, Math.max(200, msUntilEnd));
  }

  function start() {
    if (running) return;
    initCtx();
    if (ctx.state === 'suspended') ctx.resume();
    running = true;
    // Fade in
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.42, ctx.currentTime + 2.5);
    scheduleLoop(ctx.currentTime + 0.3);
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(loopTimer);
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.8);
    }
  }

  function toggle() {
    if (running) stop(); else start();
    return running;
  }

  return { start, stop, toggle, isRunning: () => running };
})();
