// Sea sound made in code (Web Audio): no audio files, no licences.
// - a low ocean rumble, always there
// - waves that swell and wash in, every few seconds, left and right
// - rain hiss when it rains; bigger waves when the sea is rough
// Browsers only allow sound after the visitor clicks, so this starts from a button.

function noiseBuffer(ctx, seconds, brown) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
  }
  return buf;
}

// Two sounds: waves and rain. Each plays a recording if one is placed in
// site/public/media/sound/ (waves.mp3, rain.mp3); otherwise a sound made in code.
export const SOUNDS = [
  { id: 'waves', label: 'أمواج', file: 'media/sound/waves.mp3', rumble: 0.32, swell: 1, rate: 1, bright: 1, wind: 0.04, rain: 0 },
  { id: 'rain', label: 'مطر', file: 'media/sound/rain.mp3', rumble: 0.28, swell: 0.7, rate: 0.9, bright: 0.8, wind: 0.08, rain: 0.32 },
];

export default class Ambience {
  constructor() {
    this.ctx = null;
    this.level = 0; // target master volume
    this.weather = { rain: 0, waves: 1 };
    this.sound = 'waves';
    this.files = {}; // id -> decoded recording (or null if there is none)
    this.timer = null;
  }

  // the sound settings in use now
  params() {
    return SOUNDS.find((x) => x.id === this.sound) || SOUNDS[0];
  }

  setSound(id) {
    this.sound = id;
    this.apply();
    this.playFile();
  }

  // load a recording once; a missing file (or a page served instead) just means "use the code sound"
  async loadFile(id) {
    if (id in this.files) return this.files[id];
    this.files[id] = null;
    const def = SOUNDS.find((x) => x.id === id);
    try {
      const r = await fetch(def.file);
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('audio')) return null;
      this.files[id] = await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
      this.files[id] = null;
    }
    return this.files[id];
  }

  // switch between a recording (if there is one) and the sound made in code
  async playFile() {
    if (!this.ctx) return;
    const id = this.sound;
    const buf = await this.loadFile(id);
    if (!this.ctx || id !== this.sound) return;
    const t = this.ctx.currentTime;
    if (this.fileSrc) {
      const old = this.fileSrc;
      old.gain.gain.setTargetAtTime(0, t, 0.5);
      setTimeout(() => old.src.stop(), 2500);
      this.fileSrc = null;
    }
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start();
      gain.gain.setTargetAtTime(1, t, 0.8);
      this.fileSrc = { src, gain };
    }
    this.proc.gain.setTargetAtTime(buf ? 0 : 1, t, 0.6);
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const brown = noiseBuffer(ctx, 6, true);
    const white = noiseBuffer(ctx, 3, false);
    const loop = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.proc = ctx.createGain(); // everything made in code goes through here
    this.proc.connect(this.master);

    // deep rumble of open water
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = 'lowpass';
    rumbleF.frequency.value = 220;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0.35;
    loop(brown).connect(rumbleF).connect(this.rumble).connect(this.proc);

    // two wave layers (left / right) that swell and wash
    this.layers = [-0.6, 0.6].map((pan) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      loop(brown).connect(f).connect(g).connect(p).connect(this.proc);
      return { f, g };
    });

    // rain hiss
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    loop(white).connect(hp).connect(lp).connect(this.rain).connect(this.proc);

    // wind: a narrow band of noise whose pitch and strength wander
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 500;
    this.windF.Q.value = 5;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    this.windLevel = ctx.createGain();
    this.windLevel.gain.value = 0;
    loop(white).connect(this.windF).connect(this.wind).connect(this.windLevel).connect(this.proc);
    this.gust();

    this.layers.forEach((l, i) => setTimeout(() => this.swell(l), i * 2600));
    this.apply();
    this.playFile();
    this.fadeTo(this.level, 2.5);
  }

  // one wave: rises over ~2 s, washes out over ~3-4 s
  swell(layer) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const { swell: big, rate, bright } = this.params();
    const peak = (0.35 + Math.random() * 0.35) * Math.min(1.6, big);
    const rise = 1.6 + Math.random() * 1.2;
    const fall = 2.8 + Math.random() * 2;
    const g = layer.g.gain;
    const f = layer.f.frequency;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    f.setValueAtTime(f.value, t);
    g.linearRampToValueAtTime(peak, t + rise);
    f.exponentialRampToValueAtTime(700 + 1000 * Math.min(1.5, bright), t + rise);
    g.exponentialRampToValueAtTime(0.04, t + rise + fall);
    f.exponentialRampToValueAtTime(280, t + rise + fall);
    const next = (rise + fall) * 1000 * (0.75 + Math.random() * 0.3) / Math.max(0.7, rate);
    layer.timer = setTimeout(() => this.swell(layer), next);
  }

  // a gust every few seconds
  gust() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = 2 + Math.random() * 3;
    this.windF.frequency.setTargetAtTime(320 + Math.random() * 700, t, d / 3);
    this.wind.gain.setTargetAtTime(0.4 + Math.random() * 0.6, t, d / 3);
    this.windTimer = setTimeout(() => this.gust(), d * 1000);
  }

  setWeather({ rain = 0, waves = 1 }) {
    this.weather = { rain, waves };
    this.apply();
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = this.params();
    this.rain.gain.setTargetAtTime(p.rain, t, 1.2);
    this.rumble.gain.setTargetAtTime(p.rumble, t, 1.2);
    this.windLevel.gain.setTargetAtTime(p.wind, t, 1.2);
  }

  fadeTo(v, seconds = 1.5) {
    this.level = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(v, t + seconds);
  }

  stop() {
    if (!this.ctx) return;
    this.layers.forEach((l) => clearTimeout(l.timer));
    clearTimeout(this.windTimer);
    const ctx = this.ctx;
    this.fadeTo(0, 0.8);
    setTimeout(() => ctx.close(), 900);
    this.ctx = null;
  }
}
