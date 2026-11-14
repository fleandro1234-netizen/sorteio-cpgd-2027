// Roleta em canvas: o disco (fatias, números, divisórias, pinos) gira; o aro de ouro, o reflexo,
// o medalhão e o ponteiro ficam parados, como numa roleta de verdade sob uma luz fixa.
// A física do giro vem de nucleo.js (planejarGiro), testada em testes/nucleo.test.mjs.
import { planejarGiro, posicaoNoTempo, velocidadeNoTempo, fatiaSobPonteiro } from './nucleo.js';

const OURO = [[0, '#6E5320'], [0.22, '#C9A45C'], [0.42, '#F6E7B8'], [0.52, '#FFFDF0'], [0.62, '#E3C27E'], [1, '#8A6A2F']];
const FATIA_A = '#13304F';
const FATIA_B = '#0C2239';
const FATIA_C = '#183A5C';
const CREME = '#F5EFE3';
const MARINHO_PROFUNDO = '#0A1D2E';

const RAD = Math.PI / 180;

function gradienteOuro(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [p, c] of OURO) gr.addColorStop(p, c);
  return gr;
}

export function criarTique() {
  let ctx = null;
  let ultimo = 0;
  return () => {
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      if (t - ultimo < 0.05) return;           // no máximo 20 tiques por segundo
      ultimo = t;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(2100, t);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.05);
    } catch { /* sem áudio no aparelho: segue sem som */ }
  };
}

export class Roleta {
  constructor(alvo, { logo } = {}) {
    this.alvo = alvo;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'roleta-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Roleta dos quartos');
    alvo.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.logo = logo || null;
    this.quartos = [];
    this.rotacao = 0;
    this.velocidade = 0;
    this.destaque = -1;
    this.pulso = null;
    this.giro = null;
    this.ponteiro = { a: 0, v: 0 };
    this.som = null;
    this._sujo = true;
    this._t = null;
    this.disco = document.createElement('canvas');
    this.aro = document.createElement('canvas');
    if (this.logo && !this.logo.complete) this.logo.addEventListener('load', () => { this._prepararAro(); this._sujo = true; }, { once: true });
    this._ro = new ResizeObserver(() => this._medir());
    this._ro.observe(alvo);
    this._medir();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  destruir() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.canvas.remove();
  }

  definirQuartos(lista) {
    if (this.giro) return;
    this.quartos = lista.slice();
    this.destaque = -1;
    this.pulso = null;
    const n = this.quartos.length;
    if (n) {
      // começa com uma fatia centrada sob o ponteiro
      const w = 360 / n;
      const atual = fatiaSobPonteiro(this.rotacao, n);
      this.rotacao = -((atual + 0.5) * w) + Math.round(this.rotacao / 360) * 360;
    }
    this._prepararDisco();
    this._sujo = true;
  }

  // roleta já sorteada: a fatia vencedora fica em ouro, parada sob o ponteiro
  mostrarVencedor(indice) {
    if (this.giro) return;
    const n = this.quartos.length;
    if (!n || indice < 0 || indice >= n) return;
    const w = 360 / n;
    this.rotacao = -((indice + 0.5) * w) + Math.round(this.rotacao / 360) * 360;
    this.destaque = indice;
    this.pulso = null;
    this._prepararDisco();
    this._sujo = true;
  }

  girar(alvo, { duracao = 9, desvio = 0 } = {}) {
    if (this.giro) return Promise.reject(new Error('A roleta já está girando.'));
    const n = this.quartos.length;
    if (!n) return Promise.reject(new Error('Não há quartos na roleta.'));
    this.destaque = -1;
    this.pulso = null;
    this._prepararDisco();
    const plano = planejarGiro({ rotacao: this.rotacao, n, alvo, desvio, duracao });
    return new Promise((resolve) => {
      this.giro = { plano, t0: performance.now(), resolve };
      this._divisoria = Math.floor(this.rotacao / (360 / n));
    });
  }

  // ------------------------------------------------------------ medidas
  _medir() {
    const lado = Math.max(120, Math.floor(this.alvo.clientWidth));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (lado === this.lado && dpr === this.dpr) return;
    this.lado = lado;
    this.dpr = dpr;
    this.canvas.width = Math.round(lado * dpr);
    this.canvas.height = Math.round(lado * dpr);
    const c = lado / 2;
    this.geo = {
      c,
      rFora: c * 0.955,
      rDisco: c * 0.955 * 0.915,
      rMedalhao: c * 0.955 * 0.915 * 0.235,
    };
    this._prepararDisco();
    this._prepararAro();
    this._sujo = true;
  }

  // ------------------------------------------------------------ disco que gira
  _prepararDisco() {
    if (!this.geo) return;
    const dpr = this.dpr;
    const R = this.geo.rDisco * dpr;
    const lado = Math.ceil(2 * R);
    const d = this.disco;
    d.width = lado;
    d.height = lado;
    const g = d.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, lado, lado);
    g.translate(lado / 2, lado / 2);
    const n = this.quartos.length;
    if (!n) {
      g.fillStyle = FATIA_B;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      return;
    }
    const w = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * w;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R, a0, a0 + w + (n > 1 ? 0.002 : 0));
      g.closePath();
      if (i === this.destaque) {
        const mid = a0 + w / 2;
        g.fillStyle = gradienteOuro(g, Math.cos(mid) * R * 0.2, Math.sin(mid) * R * 0.2, Math.cos(mid) * R, Math.sin(mid) * R);
      } else {
        g.fillStyle = (n % 2 === 1 && i === n - 1 && n > 1) ? FATIA_C : (i % 2 === 0 ? FATIA_A : FATIA_B);
      }
      g.fill();
    }
    // veludo: centro mais fundo, borda com um respiro de luz
    const vel = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    vel.addColorStop(0, 'rgba(0,0,0,0.38)');
    vel.addColorStop(0.62, 'rgba(0,0,0,0.06)');
    vel.addColorStop(1, 'rgba(255,240,210,0.05)');
    g.fillStyle = vel;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();

    // divisórias em fio de ouro
    const rIn = this.geo.rMedalhao * dpr * 1.02;
    if (n > 1) {
      g.strokeStyle = 'rgba(214,178,104,0.9)';
      g.lineWidth = Math.max(1, (n > 80 ? 0.9 : 1.4) * dpr);
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * w;
        g.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
        g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      }
      g.stroke();
    }
    // fio de ouro perto da borda
    g.strokeStyle = 'rgba(214,178,104,0.55)';
    g.lineWidth = Math.max(1, 1 * dpr);
    g.beginPath(); g.arc(0, 0, R * 0.885, 0, Math.PI * 2); g.stroke();

    // Pedido dele: todas as roletas iguais, só com as linhas de cada quarto (sem número na fatia);
    // o sorteado aparece grande ao lado.
    this.modoTexto = 'linhas';

    // pinos (bolinhas de ouro) na borda, sobre as divisórias
    const passo = n > 1 ? Math.max(1, Math.ceil(n / 90)) : 0;
    if (passo) {
      const rp = Math.max(2 * dpr, R * (n > 60 ? 0.012 : 0.017));
      for (let i = 0; i < n; i += passo) {
        const a = -Math.PI / 2 + i * w;
        const x = Math.cos(a) * R * 0.955;
        const y = Math.sin(a) * R * 0.955;
        const bola = g.createRadialGradient(x - rp * 0.35, y - rp * 0.35, rp * 0.1, x, y, rp);
        bola.addColorStop(0, '#FFFDF0');
        bola.addColorStop(0.45, '#E3C27E');
        bola.addColorStop(1, '#6E5320');
        g.fillStyle = bola;
        g.beginPath(); g.arc(x, y, rp, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ------------------------------------------------------------ aro, reflexo e medalhão (parados)
  _prepararAro() {
    if (!this.geo) return;
    const dpr = this.dpr;
    const lado = this.canvas.width;
    const a = this.aro;
    a.width = lado;
    a.height = lado;
    const g = a.getContext('2d');
    g.clearRect(0, 0, lado, lado);
    const c = (this.lado / 2) * dpr;
    const rF = this.geo.rFora * dpr;
    const rD = this.geo.rDisco * dpr;
    const rM = this.geo.rMedalhao * dpr;

    // anel com sombra (a sombra cai para fora e também sobre a borda do disco)
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = rF * 0.06;
    g.shadowOffsetY = rF * 0.02;
    g.fillStyle = gradienteOuro(g, c - rF, c - rF, c + rF * 0.6, c + rF);
    g.beginPath();
    g.arc(c, c, rF, 0, Math.PI * 2);
    g.arc(c, c, rD, 0, Math.PI * 2, true);
    g.fill('evenodd');
    g.restore();

    // moldura dupla: sulco no meio do aro e fios nas bordas
    const largAro = rF - rD;
    g.lineWidth = Math.max(1, 1.2 * dpr);
    g.strokeStyle = 'rgba(70,50,15,0.75)';
    g.beginPath(); g.arc(c, c, rD + largAro * 0.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,250,230,0.55)';
    g.beginPath(); g.arc(c, c, rD + largAro * 0.5 + 1.4 * dpr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(60,42,12,0.9)';
    g.beginPath(); g.arc(c, c, rD + 0.6 * dpr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,248,225,0.6)';
    g.beginPath(); g.arc(c, c, rF - 0.8 * dpr, 0, Math.PI * 2); g.stroke();

    // reflexo de luz no alto, à esquerda (parado enquanto o disco gira)
    const brilho = g.createRadialGradient(c - rF * 0.55, c - rF * 0.7, 0, c - rF * 0.55, c - rF * 0.7, rF * 0.9);
    brilho.addColorStop(0, 'rgba(255,255,245,0.22)');
    brilho.addColorStop(1, 'rgba(255,255,245,0)');
    g.fillStyle = brilho;
    g.beginPath(); g.arc(c, c, rF, 0, Math.PI * 2); g.fill();

    // medalhão central com o símbolo do casal
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = rM * 0.25;
    const fundo = g.createRadialGradient(c - rM * 0.3, c - rM * 0.35, rM * 0.1, c, c, rM);
    fundo.addColorStop(0, '#1C3F63');
    fundo.addColorStop(1, MARINHO_PROFUNDO);
    g.fillStyle = fundo;
    g.beginPath(); g.arc(c, c, rM, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = Math.max(1.5, rM * 0.07);
    g.strokeStyle = gradienteOuro(g, c - rM, c - rM, c + rM, c + rM);
    g.beginPath(); g.arc(c, c, rM, 0, Math.PI * 2); g.stroke();
    g.lineWidth = Math.max(1, rM * 0.02);
    g.strokeStyle = 'rgba(214,178,104,0.8)';
    g.beginPath(); g.arc(c, c, rM * 0.86, 0, Math.PI * 2); g.stroke();
    if (this.logo && this.logo.complete && this.logo.naturalWidth) {
      const lw = rM * 1.3;
      const lh = lw * (this.logo.naturalHeight / this.logo.naturalWidth);
      g.drawImage(this.logo, c - lw / 2, c - lh / 2 + rM * 0.03, lw, lh);
    }
  }

  // ------------------------------------------------------------ ponteiro (balança nos pinos)
  _desenharPonteiro(g) {
    const dpr = this.dpr;
    const c = (this.lado / 2) * dpr;
    const rF = this.geo.rFora * dpr;
    const rD = this.geo.rDisco * dpr;
    const piv = { x: c, y: c - rF - rF * 0.005 };
    const comp = (rF - rD) + rF * 0.11;
    const larg = rF * 0.075;
    g.save();
    g.translate(piv.x, piv.y);
    g.rotate(this.ponteiro.a);
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = rF * 0.025;
    g.shadowOffsetY = rF * 0.01;
    g.beginPath();
    g.moveTo(-larg / 2, 0);
    g.bezierCurveTo(-larg / 2, comp * 0.45, -larg * 0.12, comp * 0.8, 0, comp);
    g.bezierCurveTo(larg * 0.12, comp * 0.8, larg / 2, comp * 0.45, larg / 2, 0);
    g.closePath();
    g.fillStyle = gradienteOuro(g, -larg / 2, 0, larg / 2, 0);
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = Math.max(1, 1 * dpr);
    g.strokeStyle = 'rgba(70,50,15,0.9)';
    g.stroke();
    // joia do pivô
    const rj = larg * 0.42;
    g.beginPath(); g.arc(0, larg * 0.05, rj, 0, Math.PI * 2);
    g.fillStyle = MARINHO_PROFUNDO; g.fill();
    g.lineWidth = Math.max(1, rj * 0.28);
    g.strokeStyle = gradienteOuro(g, -rj, -rj, rj, rj);
    g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------ quadro a quadro
  _passarDivisorias(r, v) {
    const n = this.quartos.length;
    if (n < 2) return;
    const idx = Math.floor(r / (360 / n));
    if (idx !== this._divisoria) {
      const passos = Math.min(3, Math.abs(idx - this._divisoria));
      this._divisoria = idx;
      const impulso = Math.min(9, 2.4 + v / 160);
      this.ponteiro.v -= impulso * passos;
      if (this.som) this.som();
    }
  }

  _loop(ts) {
    const dt = this._t == null ? 0.016 : Math.min(0.05, (ts - this._t) / 1000);
    this._t = ts;
    if (this.giro) {
      const t = (ts - this.giro.t0) / 1000;
      const p = this.giro.plano;
      const r = posicaoNoTempo(p, t);
      this.velocidade = velocidadeNoTempo(p, t);
      this._passarDivisorias(r, this.velocidade);
      this.rotacao = r;
      this._sujo = true;
      if (t >= p.duracao) {
        this.rotacao = p.rotacaoFinal;
        this.velocidade = 0;
        const g = this.giro;
        this.giro = null;
        const n = this.quartos.length;
        const parou = fatiaSobPonteiro(this.rotacao, n);
        this.destaque = parou;
        this._prepararDisco();
        this.pulso = { t0: ts };
        g.resolve({ indice: parou, quarto: this.quartos[parou], alvo: p.alvo });
      }
    }
    // mola do ponteiro
    const pt = this.ponteiro;
    const passos = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / passos;
    for (let i = 0; i < passos; i++) {
      pt.v += (-320 * pt.a - 18 * pt.v) * h;
      pt.a += pt.v * h;
      if (pt.a < -0.5) { pt.a = -0.5; pt.v = Math.max(0, pt.v); }
      if (pt.a > 0.12) { pt.a = 0.12; pt.v = Math.min(0, pt.v); }
    }
    const ponteiroMexendo = Math.abs(pt.a) > 0.0005 || Math.abs(pt.v) > 0.0005;
    if (this.pulso && ts - this.pulso.t0 > 2400) { this.pulso = null; this._sujo = true; }
    if (this._sujo || ponteiroMexendo || this.pulso) {
      this._desenhar(ts);
      this._sujo = false;
    }
    this._raf = requestAnimationFrame(this._loop);
  }

  _desenhar(ts) {
    if (!this.geo) return;
    const g = this.ctx;
    const dpr = this.dpr;
    const lado = this.canvas.width;
    const c = (this.lado / 2) * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, lado, lado);
    const R = this.disco.width / 2;

    const desenharDisco = (rot, alfa) => {
      g.save();
      g.globalAlpha = alfa;
      g.translate(c, c);
      g.rotate(rot * RAD);
      g.drawImage(this.disco, -R, -R);
      g.restore();
    };
    // borrão de movimento: cópias leves atrás, proporcionais à velocidade
    const v = this.velocidade;
    if (v > 260) {
      const copias = Math.min(4, Math.floor(v / 260));
      const arrasto = Math.min(14, v / 60);
      desenharDisco(this.rotacao, 1);
      for (let k = 1; k <= copias; k++) desenharDisco(this.rotacao - (arrasto * k) / copias, 0.22);
    } else {
      desenharDisco(this.rotacao, 1);
    }

    // brilho da fatia sorteada (um único momento, depois para)
    if (this.pulso && this.destaque >= 0 && this.quartos.length) {
      const t = (ts - this.pulso.t0) / 1000;
      const forca = Math.max(0, Math.sin(Math.min(1, t / 2.4) * Math.PI)) * 0.55;
      const n = this.quartos.length;
      const w = (Math.PI * 2) / n;
      g.save();
      g.translate(c, c);
      g.rotate(this.rotacao * RAD);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = forca;
      const a0 = -Math.PI / 2 + this.destaque * w;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a0 + w); g.closePath();
      const luz = g.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
      luz.addColorStop(0, 'rgba(255,230,160,0)');
      luz.addColorStop(1, 'rgba(255,236,180,0.9)');
      g.fillStyle = luz;
      g.fill();
      g.restore();
    }

    g.drawImage(this.aro, 0, 0);
    this._desenharPonteiro(g);
  }
}
