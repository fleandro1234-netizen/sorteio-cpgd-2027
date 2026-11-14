// Núcleo do sorteio: funções puras, testadas em testes/nucleo.test.mjs.
// Convenção da roleta: rotação r em graus, sentido horário; a fatia i ocupa os ângulos da roda
// [i*w, (i+1)*w) contados a partir do topo, no sentido horário; o ponteiro fica parado no topo.

export const LIMITE_QUARTOS = 600;
// alternativas longas antes das curtas: com "a" primeiro, "01 até 03" sobrava "té" como prefixo
const SEPARADOR_INTERVALO = /^(\D*?)(\d+)\s*(?:até|ate|à|a|-|–)\s*(\D*?)(\d+)$/i;

const mod = (x, m) => ((x % m) + m) % m;

export function normalizarCodigo(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function numeroComLargura(num, largura) {
  const s = String(num);
  return largura > 0 ? s.padStart(largura, '0') : s;
}

// "101 a 120, 205; 301-303" -> { quartos: ['101', ..., '120', '205', '301', '302', '303'], erros: [] }
export function interpretarListaQuartos(texto) {
  const itens = String(texto ?? '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const quartos = [];
  const erros = [];
  const visto = new Set();
  const somar = (q) => { if (!visto.has(q)) { visto.add(q); quartos.push(q); } };
  for (const item of itens) {
    const m = item.match(SEPARADOR_INTERVALO);
    if (m) {
      const [, pre1, a, pre2, b] = m;
      if (pre1.trim() !== pre2.trim()) { erros.push(`"${item}": começo e fim com letras diferentes`); continue; }
      const ini = Number(a), fim = Number(b);
      if (fim < ini) { erros.push(`"${item}": o fim vem antes do começo`); continue; }
      if (fim - ini + 1 > LIMITE_QUARTOS) { erros.push(`"${item}": passa de ${LIMITE_QUARTOS} quartos`); continue; }
      const zero = (a.length > 1 && a[0] === '0') || (b.length > 1 && b[0] === '0');
      const largura = zero ? Math.max(a.length, b.length) : 0;
      for (let k = ini; k <= fim; k++) somar(pre1.trim() + numeroComLargura(k, largura));
    } else if (item.length > 24) {
      erros.push(`"${item.slice(0, 30)}": nome de quarto com mais de 24 letras`);
    } else {
      somar(item);
    }
  }
  if (quartos.length > LIMITE_QUARTOS) {
    erros.push(`a lista tem ${quartos.length} quartos; o limite por hotel é ${LIMITE_QUARTOS}`);
  }
  return { quartos, erros };
}

// ['101','102','103','110'] -> "101 a 103, 110"
export function descreverLista(lista) {
  const partes = [];
  let ini = null, ant = null;
  const chave = (q) => {
    const m = String(q).match(/^(\D*)(\d+)$/);
    if (!m) return null;
    const zero = m[2].length > 1 && m[2][0] === '0';
    return { pre: m[1], num: Number(m[2]), larg: zero ? m[2].length : 0, txt: q };
  };
  const fechar = () => {
    if (!ini) return;
    partes.push(ini.txt === ant.txt ? ini.txt : `${ini.txt} a ${ant.txt}`);
    ini = ant = null;
  };
  for (const q of lista) {
    const c = chave(q);
    if (c && ant && c.pre === ant.pre && c.larg === ant.larg && c.num === ant.num + 1) { ant = c; continue; }
    fechar();
    if (c) { ini = ant = c; } else { partes.push(String(q)); }
  }
  fechar();
  return partes.join(', ');
}

// Roleta de nomes (hotel que só mandou nomes de casais) x roleta de quartos.
export function ehListaDeNomes(itens) {
  return itens.length > 0 && itens.every((t) => /[A-Za-zÀ-ÿ]{3,}/.test(String(t)));
}

export function u32Seguro() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

// Índice uniforme em [0, n): rejeita os valores do resto que dariam viés de módulo.
export function sortearIndice(n, proximoU32 = u32Seguro) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('quantidade de quartos inválida');
  const limite = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const x = proximoU32();
    if (x < limite) return x % n;
  }
}

// Desvio aleatório dentro da fatia, para a parada não cair sempre no meio exato.
export function sortearDesvio() {
  return (u32Seguro() / 0x100000000 - 0.5) * 0.6; // entre -0,3 e +0,3 da fatia
}

export function fatiaSobPonteiro(rotacao, n) {
  const w = 360 / n;
  return Math.min(n - 1, Math.floor(mod(-rotacao, 360) / w));
}

// Plano do giro: arranque com aceleração constante (rápido) e desaceleração longa
// (1 - (1-u)^k), com a velocidade contínua na emenda e parada exata no alvo.
export function planejarGiro({ rotacao = 0, n, alvo, desvio = 0, duracao = 9, arranque = 0.35, potencia = 3, velocidadeAlvo = 900 }) {
  const w = 360 / n;
  // o desvio dá naturalidade, mas nunca afasta a parada mais de 10 graus do centro da fatia
  // (com 2 quartos, 0,3 da fatia eram 54 graus e o número parava longe do ponteiro)
  const limite = Math.min(0.4, 10 / w);
  const d = Math.max(-limite, Math.min(limite, desvio));
  const anguloFinalNaRoda = (alvo + 0.5 + d) * w;
  const rBase = mod(-anguloFinalNaRoda, 360);
  const delta = mod(rBase - mod(rotacao, 360), 360);
  const tb = Math.max(0.5, duracao - arranque);
  const fator = arranque / 2 + tb / potencia;          // theta = vmax * fator
  const voltas = Math.max(2, Math.round((velocidadeAlvo * fator - delta) / 360));
  const theta = voltas * 360 + delta;
  const vmax = theta / fator;
  return {
    inicio: rotacao, theta, vmax, arranque, tb, potencia,
    duracao: arranque + tb, rotacaoFinal: rotacao + theta, alvo, n,
  };
}

export function posicaoNoTempo(p, t) {
  if (t <= 0) return p.inicio;
  if (t < p.arranque) return p.inicio + (p.vmax / p.arranque) * t * t / 2;
  const tt = t - p.arranque;
  if (tt >= p.tb) return p.inicio + p.theta;
  const thetaA = p.vmax * p.arranque / 2;
  const thetaB = p.theta - thetaA;
  const u = tt / p.tb;
  return p.inicio + thetaA + thetaB * (1 - (1 - u) ** p.potencia);
}

export function velocidadeNoTempo(p, t) {
  if (t <= 0) return 0;
  if (t < p.arranque) return p.vmax * t / p.arranque;
  const tt = t - p.arranque;
  if (tt >= p.tb) return 0;
  const thetaB = p.theta - p.vmax * p.arranque / 2;
  const u = tt / p.tb;
  return thetaB * p.potencia / p.tb * (1 - u) ** (p.potencia - 1);
}

export function gerarCsv(linhas) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n') + '\r\n';
}

export function novoId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function formatarHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatarDataHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
