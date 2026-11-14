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

// Sino curto (dois toques, sol e dó agudos) para a hora em que a roda para.
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
