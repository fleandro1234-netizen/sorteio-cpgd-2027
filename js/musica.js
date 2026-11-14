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
// Pedido dele: "um som de tambor, tipo rufem os tambores". O sintetizado ficou "bem estranho"; agora é
// gravação real (domínio público, Wikimedia Commons; ver ferramentas/preparar_tambor.py): o rufo repete
// em laço sem emenda e cresce durante o giro; o prato toca quando a roda para.
let ctxAudio = null;
function contexto() {
  ctxAudio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctxAudio.state === 'suspended') ctxAudio.resume();
  return ctxAudio;
}

export class Tambor {
  constructor(rufoSrc = 'audio/rufo.wav', pratoSrc = 'audio/prato.wav') {
    this.rufoSrc = rufoSrc;
    this.pratoSrc = pratoSrc;
    this.buffers = null;
    this._carregando = null;
    this._esperando = null;
    this.saida = null;
    this.fonte = null;
    this.ganho = null;
  }

  _saida(ctx) {
    if (!this.saida) {
      this.saida = ctx.createGain();
      this.saida.gain.value = 1;
      this.saida.connect(ctx.destination);
    }
    return this.saida;
  }

  // carrega e decodifica as duas gravações uma vez (ao abrir a roleta)
  preparar() {
    if (this.buffers) return Promise.resolve();
    if (this._carregando) return this._carregando;
    let ctx;
    try { ctx = contexto(); } catch { return Promise.resolve(); }
    const baixar = (u) => fetch(u)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => new Promise((ok, erro) => ctx.decodeAudioData(b, ok, erro)));
    this._carregando = Promise.all([baixar(this.rufoSrc), baixar(this.pratoSrc)])
      .then(([rufo, prato]) => { this.buffers = { rufo, prato }; })
      .catch(() => { this._carregando = null; });
    return this._carregando;
  }

  _iniciar(ctx, duracao) {
    const fonte = ctx.createBufferSource();
    fonte.buffer = this.buffers.rufo;
    fonte.loop = true;
    const ganho = ctx.createGain();
    const t = ctx.currentTime;
    ganho.gain.setValueAtTime(0.5, t);
    ganho.gain.linearRampToValueAtTime(1.0, t + Math.max(0.5, duracao));
    fonte.connect(ganho).connect(this._saida(ctx));
    fonte.start(t, Math.random() * this.buffers.rufo.duration); // cada giro começa num ponto do rufo
    this.fonte = fonte;
    this.ganho = ganho;
  }

  // rufo do tamanho do giro, crescendo de -6 dB até o volume cheio
  tocar(duracao) {
    try {
      const ctx = contexto();
      this.parar();
      if (this.buffers) { this._iniciar(ctx, duracao); return; }
      // ainda carregando (primeiro giro com internet lenta): entra assim que chegar, no tempo que sobrar
      const fim = performance.now() + duracao * 1000;
      const pedido = {};
      this._esperando = pedido;
      this.preparar().then(() => {
        const resta = (fim - performance.now()) / 1000;
        if (this._esperando === pedido && this.buffers && resta > 0.3) this._iniciar(contexto(), resta);
      });
    } catch { /* sem áudio: segue sem som */ }
  }

  parar() {
    this._esperando = null;
    if (!this.fonte) return;
    const f = this.fonte;
    const g = this.ganho;
    this.fonte = null;
    this.ganho = null;
    try {
      const t = contexto().currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.04);
      f.stop(t + 0.06);
    } catch { /* já parado */ }
  }

  // a roda parou: corta o rufo e toca o prato
  final() {
    try {
      const ctx = contexto();
      this.parar();
      if (!this.buffers) return;
      const p = ctx.createBufferSource();
      p.buffer = this.buffers.prato;
      p.connect(this._saida(ctx));
      p.start();
    } catch { /* sem áudio */ }
  }

  get tocando() { return !!this.fonte; }
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
