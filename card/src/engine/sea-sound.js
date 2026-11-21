// The sound of the surf, made with Web Audio (no file): a deep brown-noise roar and a hiss of foam, both swelling and
// fading slowly like the waves. Browsers keep a page silent until the first tap, so it starts on the first interaction.

/** Volume (0..1) of the surf for waves of 0..1: a calm sea still murmurs. */
export const surfVolume = (waves) => 0.12 + 0.4 * Math.min(1, Math.max(0, waves));

/** A looping buffer of noise: white, or brown (integrated, a deep rumble). */
function noiseBuffer(ctx, seconds, brown) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export class SeaSound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.level = 0;
    this.wanted = false;
    this._unlock = () => this.ctx && this.ctx.resume && this.ctx.resume();
  }

  /** Start (once) the sound; `target` is the element whose first tap unlocks the audio. */
  start(target) {
    this.wanted = true;
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return;
    if (!this.ctx) this._build(new AC());
    if (target) target.addEventListener('pointerdown', this._unlock, { once: true });
    this._unlock();
    this.setLevel(this.level);
  }

  _build(ctx) {
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;
    const layer = (brown, type, freq, q, base, swell, rate, phase) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 6, brown);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = base;
      // the swell: a slow oscillator moves the gain, so the wave comes in and recedes
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = swell;
      lfo.connect(depth);
      depth.connect(g.gain);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(0, phase);
      lfo.start();
    };
    layer(true, 'lowpass', 420, 0.7, 0.55, 0.45, 0.11, 0);
    layer(false, 'bandpass', 1900, 0.5, 0.05, 0.05, 0.11, 2.3);
    layer(true, 'lowpass', 160, 0.5, 0.35, 0.25, 0.07, 3.1);
  }

  /** Volume from 0 to 1 (follows the waves of the moment), smoothed. */
  setLevel(v) {
    this.level = v;
    if (this.master && this.wanted) this.master.gain.setTargetAtTime(surfVolume(v) * 0.6, this.ctx.currentTime, 0.8);
  }

  stop() {
    this.wanted = false;
    if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  dispose() {
    this.stop();
    if (this.ctx && this.ctx.close) this.ctx.close();
    this.ctx = this.master = null;
  }
}
