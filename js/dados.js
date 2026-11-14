// Camada de dados do sorteio. Testada em testes/dados.test.mjs.
// O estado visível = último estado do banco + operações ainda na fila do aparelho.
// Sem internet, sortear, desfazer e corrigir o casal continuam funcionando (vão para a fila);
// cadastro e reset exigem conexão, para nada se perder.
import { novoId } from './nucleo.js';

const CHAVE_BASE = 'cpgd29:base';
const CHAVE_FILA = 'cpgd29:fila';

const vazio = () => ({ hoteis: [], quartos: [], sorteios: [], agora: null });
const copia = (x) => JSON.parse(JSON.stringify(x));
const agoraIso = () => new Date().toISOString();

export class ArmazemMemoria {
  constructor() { this.m = new Map(); }
  ler(k) { return this.m.has(k) ? this.m.get(k) : null; }
  gravar(k, v) { this.m.set(k, v); return true; }
  apagar(k) { this.m.delete(k); }
}

// gravar devolve false quando o navegador não guarda (aba privada, bloqueio, cheio): a tela avisa
export class ArmazemLocal {
  ler(k) { try { return globalThis.localStorage.getItem(k); } catch { return null; } }
  gravar(k, v) { try { globalThis.localStorage.setItem(k, v); return true; } catch { return false; } }
  apagar(k) { try { globalThis.localStorage.removeItem(k); } catch { /* idem */ } }
}

export const CHAVES_LOCAIS = [CHAVE_BASE, CHAVE_FILA];

export class ErroCodigo extends Error {
  constructor() { super('Código do evento recusado.'); this.name = 'ErroCodigo'; }
}
export class ErroRede extends Error {
  constructor(msg) { super(msg || 'Sem conexão com o banco.'); this.name = 'ErroRede'; }
}
export class ErroServidor extends Error {
  constructor(status, texto) { super(`O banco respondeu ${status}.`); this.name = 'ErroServidor'; this.status = status; this.texto = texto; }
}

// ------------------------------------------------------------------ estado derivado
export function estadoVisivel(base, fila) {
  const e = copia(base ?? vazio());
  for (const op of fila ?? []) {
    if (op.op === 'registrar') {
      if (!e.sorteios.some((s) => s.cliente_id === op.cliente_id)) {
        e.sorteios.push({ id: null, cliente_id: op.cliente_id, hotel_id: op.hotel_id, quarto_id: op.quarto_id,
          numero: op.numero, casal: op.casal || null, rodada: op.rodada || null, sorteado_em: op.sorteado_em,
          anulado_em: null, motivo_anulacao: null, pendente: true });
      }
    } else if (op.op === 'anular') {
      const s = e.sorteios.find((x) => x.cliente_id === op.cliente_id && !x.anulado_em);
      if (s) { s.anulado_em = op.quando; s.motivo_anulacao = op.motivo; s.pendente = true; }
    } else if (op.op === 'casal') {
      const s = e.sorteios.find((x) => x.cliente_id === op.cliente_id);
      if (s) { s.casal = op.casal || null; s.pendente = true; }
    }
  }
  return e;
}

const porOrdem = (a, b) => (a.ordem - b.ordem) || (a.id - b.id);

export function quartosDoHotel(e, hotelId) {
  return e.quartos.filter((q) => q.hotel_id === hotelId).sort(porOrdem);
}

export function livresDoHotel(e, hotelId) {
  const ocupados = new Set(e.sorteios.filter((s) => !s.anulado_em).map((s) => s.quarto_id));
  return quartosDoHotel(e, hotelId).filter((q) => !ocupados.has(q.id));
}

export function sorteiosDoHotel(e, hotelId, { incluirAnulados = false } = {}) {
  return e.sorteios
    .filter((s) => (hotelId == null || s.hotel_id === hotelId) && (incluirAnulados || !s.anulado_em))
    .sort((a, b) => String(b.sorteado_em).localeCompare(String(a.sorteado_em)));
}

export function contagens(e) {
  const m = new Map();
  for (const h of e.hoteis) m.set(h.id, { total: 0, sorteados: 0 });
  for (const q of e.quartos) { const c = m.get(q.hotel_id); if (c) c.total++; }
  const existentes = new Set(e.quartos.map((q) => q.id));
  for (const s of e.sorteios) {
    if (s.anulado_em || !existentes.has(s.quarto_id)) continue;
    const c = m.get(s.hotel_id); if (c) c.sorteados++;
  }
  return m;
}

function tempoLimite(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

// ------------------------------------------------------------------ banco (Supabase)
export class FonteRemota {
  constructor({ url, chave, codigo, armazem, fetch: f }) {
    this.url = url; this.chave = chave; this.codigo = codigo;
    this.armazem = armazem ?? new ArmazemLocal();
    this._fetch = f ?? ((...a) => globalThis.fetch(...a));
    this.base = vazio();
    this.fila = [];
    this.modo = 'remoto';
    this.aoConflito = null;
    this.aoMudar = null;
    this._enviando = null;
    this._conflitados = new Set();
    this._seqMescla = 0;
    this._mesclados = [];
    this.armazenamentoOk = true;
  }

  restaurar() {
    try { this.base = JSON.parse(this.armazem.ler(CHAVE_BASE)) || vazio(); } catch { this.base = vazio(); }
    try { this.fila = JSON.parse(this.armazem.ler(CHAVE_FILA)) || []; } catch { this.fila = []; }
    return this.estado();
  }

  _salvar() {
    const a = this.armazem.gravar(CHAVE_BASE, JSON.stringify(this.base));
    const b = this.armazem.gravar(CHAVE_FILA, JSON.stringify(this.fila));
    this.armazenamentoOk = a !== false && b !== false;
  }

  _avisar() { try { this.aoMudar?.(); } catch { /* tela não pode derrubar o dado */ } }

  estado() { return estadoVisivel(this.base, this.fila); }
  pendentes() { return this.fila.length; }

  async _rpc(nome, corpo) {
    let r;
    try {
      r = await this._fetch(`${this.url}/rest/v1/rpc/${nome}`, {
        method: 'POST',
        headers: { apikey: this.chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_codigo: this.codigo, ...corpo }),
        signal: tempoLimite(10000),
        cache: 'no-store',
      });
    } catch (e) {
      throw new ErroRede(e?.message);
    }
    if (r.status === 403) throw new ErroCodigo();
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch { /* sem corpo */ } throw new ErroServidor(r.status, t); }
    return r.json();
  }

  // Uma leitura que começou antes de um sorteio confirmado pode chegar depois dele, sem ele:
  // o que foi confirmado no meio do caminho é reaplicado sobre a leitura nova.
  async carregar() {
    const desde = this._seqMescla;
    const e = await this._rpc('estado', {});
    this.base = e;
    for (const m of this._mesclados) if (m.seq > desde) this._aplicar(m.s);
    this._salvar();
    this._avisar();
    return this.estado();
  }

  _aplicar(s) {
    const i = this.base.sorteios.findIndex((x) => x.cliente_id === s.cliente_id);
    if (i < 0) { this.base.sorteios.push({ ...s }); return; }
    const atual = this.base.sorteios[i];
    if (atual.anulado_em && !s.anulado_em) return; // anulação não volta atrás
    this.base.sorteios[i] = { ...atual, ...s };
  }

  _mesclar(s) {
    if (!s || !s.cliente_id) return;
    this._aplicar(s);
    this._seqMescla++;
    this._mesclados.push({ seq: this._seqMescla, s: { ...s } });
    if (this._mesclados.length > 300) this._mesclados.splice(0, this._mesclados.length - 300);
  }

  // Um envio por vez. A trava é limpa no .finally, que roda DEPOIS da atribuição: com a fila vazia
  // a função termina na hora, e um try/finally interno limpava a trava antes de ela ser gravada,
  // deixando-a presa para sempre (nenhum sorteio saía mais do aparelho).
  enviarFila() {
    if (!this._enviando) {
      this._enviando = this._enviarAgora().finally(() => { this._enviando = null; });
    }
    return this._enviando;
  }

  async _enviarAgora() {
    while (this.fila.length) {
      const op = this.fila[0];
      let r;
      try {
        if (op.op === 'registrar') {
          const corpo = { p_cliente_id: op.cliente_id, p_quarto_id: op.quarto_id, p_casal: op.casal || null };
          if (op.rodada) corpo.p_rodada = op.rodada; // só quando houver: compatível com a função antiga
          r = await this._rpc('registrar_sorteio', corpo);
        } else if (op.op === 'anular') {
          r = await this._rpc('anular_sorteio', { p_cliente_id: op.cliente_id, p_motivo: op.motivo });
        } else {
          r = await this._rpc('atualizar_casal', { p_cliente_id: op.cliente_id, p_casal: op.casal || null });
        }
      } catch (e) {
        if (e instanceof ErroCodigo) return { situacao: 'codigo_invalido' };
        if (e instanceof ErroRede) return { situacao: 'sem_conexao' };
        return { situacao: 'erro', erro: e };
      }
      this.fila.shift();
      if (op.op === 'registrar' && !r.ok) {
        // outro aparelho levou o quarto (ou ele saiu da lista): descarta este sorteio e o que vem atrás dele
        this.fila = this.fila.filter((o) => o.cliente_id !== op.cliente_id);
        this._conflitados.add(op.cliente_id);
        if (r.sorteio) this._mesclar(r.sorteio);
        try { this.aoConflito?.({ numero: op.numero, hotel_id: op.hotel_id, cliente_id: op.cliente_id, motivo: r.motivo, existente: r.sorteio || null }); } catch { /* idem */ }
      } else if (r && r.sorteio) {
        this._mesclar(r.sorteio);
      }
      this._salvar();
      this._avisar();
    }
    return { situacao: 'em_dia' };
  }

  _situacaoDe(clienteId, out) {
    if (this._conflitados.has(clienteId)) return 'conflito';
    if (this.fila.some((o) => o.cliente_id === clienteId)) return out.situacao === 'codigo_invalido' ? 'codigo_invalido' : 'pendente';
    return 'gravado';
  }

  async registrar({ hotel_id, quarto_id, numero, casal, rodada = null, cliente_id = novoId() }) {
    const op = { op: 'registrar', cliente_id, hotel_id, quarto_id, numero, casal: String(casal || '').trim(), rodada, sorteado_em: agoraIso() };
    this.fila.push(op);
    this._salvar();
    this._avisar();
    const sorteio = this.estado().sorteios.find((s) => s.cliente_id === op.cliente_id);
    const out = await this.enviarFila();
    return { sorteio, envio: this._situacaoDe(op.cliente_id, out) };
  }

  async anular(clienteId, motivo = 'desfeito') {
    this.fila.push({ op: 'anular', cliente_id: clienteId, motivo, quando: agoraIso() });
    this._salvar();
    this._avisar();
    const out = await this.enviarFila();
    return { envio: this._situacaoDe(clienteId, out) };
  }

  async atualizarCasal(clienteId, casal) {
    this.fila.push({ op: 'casal', cliente_id: clienteId, casal: String(casal || '').trim() });
    this._salvar();
    this._avisar();
    const out = await this.enviarFila();
    return { envio: this._situacaoDe(clienteId, out) };
  }

  async _exigirFilaVazia() {
    if (this.fila.length) await this.enviarFila();
    if (this.fila.length) {
      throw new Error('Sem internet: ainda há sorteios guardados no aparelho. Espere a conexão voltar.');
    }
  }

  async resetar(hotelId = null) {
    await this._exigirFilaVazia();
    const r = await this._rpc('resetar_sorteio', { p_hotel_id: hotelId });
    await this.carregar();
    return r;
  }

  async salvarHotel({ id = null, nome, prefixo = 'HOTEL', foto = null, ordem = 0 }) {
    const r = await this._rpc('salvar_hotel', { p_id: id, p_nome: nome, p_prefixo: prefixo, p_foto: foto, p_ordem: ordem });
    await this.carregar();
    return r;
  }

  async removerHotel(id) {
    await this._exigirFilaVazia();
    const r = await this._rpc('remover_hotel', { p_id: id });
    await this.carregar();
    return r;
  }

  async definirQuartos(hotelId, lista) {
    await this._exigirFilaVazia();
    const r = await this._rpc('definir_quartos', { p_hotel_id: hotelId, p_numeros: lista });
    await this.carregar();
    return r;
  }
}

// ------------------------------------------------------------------ demonstração (nada vai ao banco)
export class FonteDemo {
  constructor(base) {
    this.base = copia(base ?? vazio());
    this.fila = [];
    this.modo = 'demo';
    this.aoConflito = null;
    this.aoMudar = null;
    this._seq = 100000;
  }

  restaurar() { return this.estado(); }
  async carregar() { return this.estado(); }
  estado() { return copia(this.base); }
  pendentes() { return 0; }
  async enviarFila() { return { situacao: 'em_dia' }; }
  _avisar() { try { this.aoMudar?.(); } catch { /* idem */ } }

  async registrar({ hotel_id, quarto_id, numero, casal, rodada = null, cliente_id = novoId() }) {
    const s = { id: ++this._seq, cliente_id, hotel_id, quarto_id, numero, casal: String(casal || '').trim() || null, rodada,
      sorteado_em: agoraIso(), anulado_em: null, motivo_anulacao: null };
    if (this.base.sorteios.some((x) => x.quarto_id === quarto_id && !x.anulado_em)) return { sorteio: s, envio: 'conflito' };
    this.base.sorteios.push(s);
    this._avisar();
    return { sorteio: copia(s), envio: 'demonstracao' };
  }

  async anular(clienteId, motivo = 'desfeito') {
    const s = this.base.sorteios.find((x) => x.cliente_id === clienteId && !x.anulado_em);
    if (s) { s.anulado_em = agoraIso(); s.motivo_anulacao = motivo; }
    this._avisar();
    return { envio: 'demonstracao' };
  }

  async atualizarCasal(clienteId, casal) {
    const s = this.base.sorteios.find((x) => x.cliente_id === clienteId);
    if (s) s.casal = String(casal || '').trim() || null;
    this._avisar();
    return { envio: 'demonstracao' };
  }

  async resetar(hotelId = null) {
    let n = 0;
    for (const s of this.base.sorteios) {
      if (!s.anulado_em && (hotelId == null || s.hotel_id === hotelId)) { s.anulado_em = agoraIso(); s.motivo_anulacao = 'reset'; n++; }
    }
    this._avisar();
    return { ok: true, anulados: n };
  }

  async salvarHotel({ id = null, nome, prefixo = 'HOTEL', foto = null, ordem = 0 }) {
    let h;
    if (id == null) {
      h = { id: ++this._seq, nome: nome.trim(), prefixo, foto, ordem };
      this.base.hoteis.push(h);
    } else {
      h = this.base.hoteis.find((x) => x.id === id);
      if (!h) return { ok: false, motivo: 'nao_encontrado' };
      Object.assign(h, { nome: nome.trim(), prefixo, foto, ordem });
    }
    this.base.hoteis.sort(porOrdem);
    this._avisar();
    return { ok: true, hotel: copia(h) };
  }

  async removerHotel(id) {
    if (this.base.sorteios.some((s) => s.hotel_id === id && !s.anulado_em)) return { ok: false, motivo: 'tem_sorteio_valido' };
    this.base.hoteis = this.base.hoteis.filter((h) => h.id !== id);
    const fora = new Set(this.base.quartos.filter((q) => q.hotel_id === id).map((q) => q.id));
    this.base.quartos = this.base.quartos.filter((q) => q.hotel_id !== id);
    this.base.sorteios = this.base.sorteios.filter((s) => !fora.has(s.quarto_id));
    this._avisar();
    return { ok: true };
  }

  async definirQuartos(hotelId, lista) {
    const limpa = [];
    for (const x of lista) { const n = String(x).trim(); if (n && !limpa.includes(n)) limpa.push(n); }
    const validos = new Set(this.base.sorteios.filter((s) => !s.anulado_em).map((s) => s.quarto_id));
    const doHotel = this.base.quartos.filter((q) => q.hotel_id === hotelId);
    const mantidos = doHotel.filter((q) => !limpa.includes(q.numero) && validos.has(q.id)).sort(porOrdem).map((q) => q.numero);
    const sair = new Set(doHotel.filter((q) => !limpa.includes(q.numero) && !validos.has(q.id)).map((q) => q.id));
    this.base.quartos = this.base.quartos.filter((q) => !sair.has(q.id));
    this.base.sorteios = this.base.sorteios.filter((s) => !sair.has(s.quarto_id));
    limpa.forEach((numero, i) => {
      const q = this.base.quartos.find((x) => x.hotel_id === hotelId && x.numero === numero);
      if (q) q.ordem = i + 1;
      else this.base.quartos.push({ id: ++this._seq, hotel_id: hotelId, numero, ordem: i + 1 });
    });
    this._avisar();
    return { ok: true, total: limpa.length, mantidos };
  }
}
