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

// sounds the visitor can choose from; 'auto' follows the weather on screen
// rumble: deep sea, swell: wave size, rate: how often waves come, bright: wash hiss,
// wind: wind howl, rain: rain hiss
export const SOUNDS = [
  { id: 'auto', label: 'تلقائي (حسب الطقس)' },
  { id: 'calm', label: 'أمواج هادئة', rumble: 0.22, swell: 0.55, rate: 0.75, bright: 0.65, wind: 0, rain: 0 },
  { id: 'waves', label: 'أمواج البحر', rumble: 0.32, swell: 1, rate: 1, bright: 1, wind: 0.04, rain: 0 },
  { id: 'deep', label: 'هدير البحر المفتوح', rumble: 0.6, swell: 0.7, rate: 0.7, bright: 0.55, wind: 0.08, rain: 0 },
  { id: 'wind', label: 'رياح بحرية', rumble: 0.25, swell: 0.75, rate: 0.9, bright: 0.85, wind: 0.42, rain: 0 },
  { id: 'rain', label: 'مطر على البحر', rumble: 0.3, swell: 0.8, rate: 1, bright: 0.9, wind: 0.1, rain: 0.3 },
  { id: 'storm', label: 'بحر عاصف', rumble: 0.5, swell: 1.5, rate: 1.4, bright: 1.4, wind: 0.38, rain: 0.18 },
];

export default class Ambience {
  constructor() {
    this.ctx = null;
    this.level = 0; // target master volume
    this.weather = { rain: 0, waves: 1 };
    this.sound = 'auto';
    this.timer = null;
  }

  // the sound settings in use now
  params() {
    const fixed = SOUNDS.find((x) => x.id === this.sound && x.id !== 'auto');
    if (fixed) return fixed;
    const { rain, waves } = this.weather;
    return { rumble: 0.25 + 0.15 * Math.min(1.6, waves), swell: waves, rate: waves, bright: waves, wind: rain ? 0.12 : 0.04, rain: rain * 0.22 };
  }

  setSound(id) {
    this.sound = id;
    this.apply();
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

    // deep rumble of open water
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = 'lowpass';
    rumbleF.frequency.value = 220;
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0.35;
    loop(brown).connect(rumbleF).connect(this.rumble).connect(this.master);

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
      loop(brown).connect(f).connect(g).connect(p).connect(this.master);
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
    loop(white).connect(hp).connect(lp).connect(this.rain).connect(this.master);

    // wind: a narrow band of noise whose pitch and strength wander
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 500;
    this.windF.Q.value = 5;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    this.windLevel = ctx.createGain();
    this.windLevel.gain.value = 0;
    loop(white).connect(this.windF).connect(this.wind).connect(this.windLevel).connect(this.master);
    this.gust();

    this.layers.forEach((l, i) => setTimeout(() => this.swell(l), i * 2600));
    this.apply();
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
