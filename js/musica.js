// Música de suspense durante o giro: "Sneaky Snitch", Kevin MacLeod (incompetech.com),
// licença Creative Commons Atribuição 4.0 (creativecommons.org/licenses/by/4.0/).
// Entra suave no arranque, continua de onde parou no giro anterior (não repete sempre o mesmo
// trecho), sai suave quando a roda para; o sino marca a revelação.

export class Musica {
  constructor(src, volume = 0.85) {
    this.src = src;
    this.volume = volume;
    this.audio = null;
    this.blobUrl = null;
    this._baixando = null;
    this._raf = null;
  }

  _garantir() {
    if (!this.audio) {
      this.audio = new Audio(this.blobUrl || this.src);
      this.audio.loop = true;
      this.audio.preload = 'auto';
      this.audio.volume = 0;
    }
    return this.audio;
  }

  // Carrega antes do primeiro giro. A cópia em memória (blob) passa pelo service worker como um
  // pedido comum, então a música toca até sem internet e sem depender de pedido por faixa.
  preparar() {
    try {
      this._garantir();
      if (!this.blobUrl && !this._baixando) {
        this._baixando = fetch(this.src)
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .then((b) => {
            this.blobUrl = URL.createObjectURL(b);
            if (this.audio && this.audio.paused) {
              const t = this.audio.currentTime;
              this.audio.src = this.blobUrl;
              try { this.audio.currentTime = t; } catch { /* início */ }
            }
          })
          .catch(() => { this._baixando = null; });
      }
    } catch { /* sem áudio no aparelho */ }
  }

  tocar() {
    try {
      const a = this._garantir();
      a.volume = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      this._rampa(this.volume, 350);
    } catch { /* segue sem música */ }
  }

  parar(ms = 900) {
    if (!this.audio) return;
    this._rampa(0, ms, () => { try { this.audio.pause(); } catch { /* idem */ } });
  }

  _rampa(alvo, ms, fim) {
    cancelAnimationFrame(this._raf);
    const a = this.audio;
    const v0 = a.volume;
    const t0 = performance.now();
    const passo = (t) => {
      const u = Math.min(1, (t - t0) / ms);
      a.volume = Math.max(0, Math.min(1, v0 + (alvo - v0) * u));
      if (u < 1) this._raf = requestAnimationFrame(passo);
      else if (fim) fim();
    };
    this._raf = requestAnimationFrame(passo);
  }
}

// ---------------------------------------------------------------- rufar de tambores
// Pedido dele: "um som de tambor, tipo rufem os tambores". Caixa sintetizada (esteira de ruído agudo
// + corpo grave curto), 26 toques por segundo crescendo durante todo o giro; quando a roda para,
// batida acentuada com bumbo e prato. Sincronizado com o giro porque é gerado na hora.
let ctxAudio = null;
function contexto() {
  ctxAudio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctxAudio.state === 'suspended') ctxAudio.resume();
  return ctxAudio;
}

let ruidoBuf = null;
function ruido(ctx) {
  if (ruidoBuf) return ruidoBuf;
  ruidoBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = ruidoBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ruidoBuf;
}

export class Tambor {
  constructor() {
    this.saida = null;
    this.rufo = null;
  }

  _saida(ctx) {
    if (!this.saida) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      comp.connect(g).connect(ctx.destination);
      this.saida = comp;
    }
    return this.saida;
  }

  _toque(ctx, destino, t, forca, decai) {
    const src = ctx.createBufferSource();
    src.buffer = ruido(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const pico = ctx.createBiquadFilter();
    pico.type = 'peaking';
    pico.frequency.value = 4200;
    pico.gain.value = 6;
    pico.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * forca, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decai);
    src.connect(hp).connect(pico).connect(g).connect(destino);
    src.start(t, Math.random() * 0.8, decai + 0.02);
    const corpo = ctx.createOscillator();
    corpo.type = 'triangle';
    corpo.frequency.setValueAtTime(210, t);
    corpo.frequency.exponentialRampToValueAtTime(160, t + 0.05);
    const gc = ctx.createGain();
    gc.gain.setValueAtTime(0.0001, t);
    gc.gain.exponentialRampToValueAtTime(0.32 * forca, t + 0.002);
    gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    corpo.connect(gc).connect(destino);
    corpo.start(t);
    corpo.stop(t + 0.07);
  }

  // rufo do tamanho exato do giro, crescendo
  tocar(duracao) {
    try {
      const ctx = contexto();
      this.parar();
      const rufo = ctx.createGain();
      rufo.gain.value = 1;
      rufo.connect(this._saida(ctx));
      this.rufo = rufo;
      const taxa = 26;
      const t0 = ctx.currentTime + 0.03;
      const n = Math.max(1, Math.floor(duracao * taxa));
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const t = t0 + i / taxa + (Math.random() - 0.5) * 0.006;
        const forca = (0.28 + 0.62 * u * u) * (i % 2 ? 0.86 : 1) * (0.92 + Math.random() * 0.16);
        this._toque(ctx, rufo, t, forca, 0.07);
      }
    } catch { /* sem áudio: segue sem som */ }
  }

  // corta o rufo na hora (todos os toques passam pelo mesmo controle de volume)
  parar() {
    if (!this.rufo) return;
    const g = this.rufo;
    this.rufo = null;
    try {
      const ctx = contexto();
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
      setTimeout(() => { try { g.disconnect(); } catch { /* já desligado */ } }, 400);
    } catch { /* idem */ }
  }

  // a roda parou: caixa acentuada, bumbo e prato
  final() {
    try {
      const ctx = contexto();
      this.parar();
      const out = this._saida(ctx);
      const t = ctx.currentTime + 0.01;
      this._toque(ctx, out, t, 1.3, 0.2);
      const bumbo = ctx.createOscillator();
      bumbo.type = 'sine';
      bumbo.frequency.setValueAtTime(140, t);
      bumbo.frequency.exponentialRampToValueAtTime(48, t + 0.18);
      const gb = ctx.createGain();
      gb.gain.setValueAtTime(0.0001, t);
      gb.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
      gb.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      bumbo.connect(gb).connect(out);
      bumbo.start(t);
      bumbo.stop(t + 0.55);
      const prato = ctx.createBufferSource();
      prato.buffer = ruido(ctx);
      prato.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5000;
      const gp = ctx.createGain();
      gp.gain.setValueAtTime(0.0001, t);
      gp.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
      gp.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      prato.connect(hp).connect(gp).connect(out);
      prato.start(t);
      prato.stop(t + 2.7);
      for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f * 2;
        const ho = ctx.createBiquadFilter();
        ho.type = 'highpass';
        ho.frequency.value = 7000;
        const go = ctx.createGain();
        go.gain.setValueAtTime(0.0001, t);
        go.gain.exponentialRampToValueAtTime(0.028, t + 0.004);
        go.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(ho).connect(go).connect(out);
        o.start(t);
        o.stop(t + 1.9);
      }
    } catch { /* sem áudio */ }
  }

  get tocando() { return !!this.rufo; }
}

// Sino curto (dois toques, sol e dó agudos) para a hora em que a roda para, quando o som é a música.
let ctxSino = null;
export function tocarSino() {
  try {
    ctxSino ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctxSino.state === 'suspended') ctxSino.resume();
    const agora = ctxSino.currentTime;
    const toque = (freq, inicio, forca) => {
      for (const [mult, peso] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
        const o = ctxSino.createOscillator();
        const g = ctxSino.createGain();
        o.type = 'sine';
        o.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, agora + inicio);
        g.gain.exponentialRampToValueAtTime(0.18 * forca * peso, agora + inicio + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + 1.6 / mult);
        o.connect(g).connect(ctxSino.destination);
        o.start(agora + inicio);
        o.stop(agora + inicio + 1.7);
      }
    };
    toque(1567.98, 0, 0.8);   // sol
    toque(2093.0, 0.16, 1);   // dó
  } catch { /* sem áudio: segue */ }
}
