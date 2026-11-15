// Telas do sorteio dos quartos do 29º CPGD.
// Regras dele (14/11/2026): um quarto sorteado por hotel; depois uma rodada bônus com os quartos de
// todos os hotéis; todas as roletas iguais (só as linhas); sem nome de casal; rufar de tambores.
// 14/11 à noite: confirmação por palavra em todo reset, Extrair ganhadores e o botão Ausente.
// 15/11: a roleta "Hospedagem em outra data", com os quartos de todos os hotéis, como a bônus; e os
// nomes do Majestic nas duas ("Coloque o nomes do majestic nas rodadas bônus!").
import {
  FonteRemota, FonteDemo, ArmazemLocal, ErroCodigo, ErroRede, CHAVES_LOCAIS,
  quartosDoHotel, contagens,
} from './dados.js';
import {
  normalizarCodigo, interpretarListaQuartos, descreverLista, sortearIndice, sortearDesvio,
  gerarCsv, formatarHora, formatarDataHora, novoId, ehListaDeNomes,
} from './nucleo.js';
import { Roleta, criarTique } from './roleta.js';
import { Musica, Tambor, tocarSino } from './musica.js';

const SUPABASE_URL = 'https://hfwrzhugtochmoukmbpr.supabase.co';
const SUPABASE_CHAVE = 'sb_publishable_tPlmP6NE4PTDFNzTDBKQ9g_9QZA6v2I';
const CH_CODIGO = 'cpgd29:codigo';
const CH_PREFS = 'cpgd29:prefs';
const BONUS = 'bonus';
// Pedido de 15/11: "mais um sorteio para todos do hotel, mas em dias diferentes ao encontro". Respostas
// dele: uma roleta só com os quartos de todos os hotéis (como a bônus), quem já ganhou fica de fora,
// nome "Hospedagem em outra data".
const OUTRA = 'outra_data';
const ESPECIAIS = [BONUS, OUTRA];
const RODADA = {
  [BONUS]: {
    hash: '#/bonus', titulo: 'Rodada bônus', coluna: 'Bônus', ir: 'Ir para a rodada bônus',
    aRoleta: 'a rodada bônus', da: 'da rodada bônus', ganhador: 'o ganhador da rodada bônus', resumo: 'a rodada bônus',
    tituloReset: 'Resetar a rodada bônus?', botaoReset: 'Resetar a rodada bônus',
    resetado: 'Rodada bônus resetada: a roleta pode girar de novo.',
  },
  [OUTRA]: {
    hash: '#/outra-data', titulo: 'Hospedagem em outra data', coluna: 'Hospedagem em outra data',
    ir: 'Ir para a hospedagem em outra data', aRoleta: 'a roleta da hospedagem em outra data',
    da: 'da hospedagem em outra data', ganhador: 'o ganhador da hospedagem em outra data', resumo: 'a hospedagem em outra data',
    tituloReset: 'Resetar o sorteio da hospedagem em outra data?', botaoReset: 'Resetar este sorteio',
    resetado: 'Sorteio da hospedagem em outra data resetado: a roleta pode girar de novo.',
  },
};
const ehEspecial = (id) => ESPECIAIS.includes(id);
const SONS = ['tambor', 'musica', 'nenhum'];
const NOME_SOM = { tambor: 'Som do giro: tambores', musica: 'Som do giro: música', nenhum: 'Som do giro: desligado' };
const FOTOS = [
  ['hotel-monte-real', 'Monte Real'], ['hotel-panorama', 'Panorama'], ['hotel-gloria', 'Grande Hotel Glória'],
  ['hotel-bela-vista', 'Recanto Bela Vista'], ['hotel-guarany', 'Guarany'], ['hotel-fredy', 'Fredy'],
  ['hotel-majestic', 'Majestic'],
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const semMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const maiuscula = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
const juntar = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}` : (xs[0] || ''));

const armazem = new ArmazemLocal();
const tique = criarTique();
const musica = new Musica('audio/suspense.mp3');
const tambor = new Tambor('audio/rufo.wav', 'audio/prato.wav');
const logoCasal = new Image();
logoCasal.src = 'img/logo-casal.png';

let fonte = null;
let prefs = { duracao: 9, som: false, somGiro: 'tambor' };
let tela = null;
let roleta = null;
let hotelId = null;             // id do hotel, ou BONUS / OUTRA nas rodadas com todos os hotéis
let fase = 'pronto';            // pronto | girando | resultado
let resultado = null;           // { quarto, cliente_id, envio, tipo, hotelNome }
let idsNaRoda = '';
let conexao = 'ok';             // ok | sem_conexao
let filtroHotel = 'todos';
let mostrarDesfeitos = false;
let outraAba = false;
let giroAutomatico = null;      // o giro que o Ausente agenda (cancelado se a tela mudar)

// ------------------------------------------------------------------ dados de demonstração
function dadosDemo() {
  const defs = [
    [1, 'Monte Real', 'HOTEL', 'hotel-monte-real', '101 a 124'],
    [2, 'Panorama', 'HOTEL', 'hotel-panorama', '201 a 216'],
    [3, 'Grande Hotel Glória', '', 'hotel-gloria', '1 a 36'],
    [4, 'Recanto Bela Vista', 'HOTEL', 'hotel-bela-vista', '11 a 22'],
    [5, 'Guarany', 'HOTEL', 'hotel-guarany', '301 a 330'],
    [6, 'Fredy', 'HOTEL', 'hotel-fredy', '1 a 8'],
    [7, 'Majestic', 'HOTEL', 'hotel-majestic', 'Casal Exemplo Um, Casal Exemplo Dois, Casal Exemplo Três, Casal Exemplo Quatro, Casal Exemplo Cinco, Casal Exemplo Seis'],
  ];
  let qid = 1000;
  const hoteis = [];
  const quartos = [];
  for (const [id, nome, prefixo, foto, faixa] of defs) {
    hoteis.push({ id, nome, prefixo, foto, ordem: id });
    interpretarListaQuartos(faixa).quartos.forEach((numero, i) => quartos.push({ id: ++qid, hotel_id: id, numero, ordem: i + 1 }));
  }
  return { hoteis, quartos, sorteios: [], agora: null };
}

// ------------------------------------------------------------------ regras do sorteio
function prefixoVisivel(h) {
  if (!h || !h.prefixo) return '';
  return h.nome.trim().toLowerCase().startsWith(h.prefixo.trim().toLowerCase()) ? '' : h.prefixo;
}

function nomeCompleto(h) {
  if (!h) return '';
  const p = prefixoVisivel(h);
  return p ? `${p.charAt(0)}${p.slice(1).toLowerCase()} ${h.nome}` : h.nome;
}

const emEspecial = () => ehEspecial(hotelId);

// Ausente: o sorteado não está no salão. O sorteio é anulado com o motivo 'ausente' e o quarto sai de
// todas as roletas até o reset daquela roleta. As regras são as mesmas de dados.js e ficam aqui também
// para a tela funcionar com um dados.js antigo guardado no aparelho na primeira abertura depois de publicar.
const AUSENTE = 'ausente';
const ehAusente = (s) => !!s.anulado_em && s.motivo_anulacao === AUSENTE;
const daRoleta = (s, id) => (ehEspecial(id) ? s.rodada === id : (!s.rodada && s.hotel_id === id));
function foraDoSorteio(e) {
  return new Set(e.sorteios.filter((s) => !s.anulado_em || ehAusente(s)).map((s) => s.quarto_id));
}
function ausentesDe(id, e = fonte.estado()) {
  return e.sorteios.filter((s) => ehAusente(s) && daRoleta(s, id));
}
const temAlgoParaResetar = (e) => e.sorteios.some((s) => !s.anulado_em || ehAusente(s));

const TEXTOS = {
  quartos: { rotulo: 'Quarto sorteado', um: 'quarto', varios: 'quartos' },
  nomes: { rotulo: 'Casal sorteado', um: 'casal', varios: 'casais' },
  bonus: { rotulo: 'Quarto sorteado', um: 'quarto', varios: 'quartos' },
  // rodadas com todos os hotéis quando o hotel de nomes entra nelas: quartos e casais na mesma roleta
  misto: { rotulo: 'Sorteado', um: 'quarto ou casal', varios: 'quartos e casais' },
};

function tipoDoHotel(id, e = fonte.estado()) {
  if (ehEspecial(id)) return 'bonus';
  return ehListaDeNomes(quartosDoHotel(e, id).map((q) => q.numero)) ? 'nomes' : 'quartos';
}

// hotéis que entram nas rodadas com todos os hotéis (bônus e outra data): todos. Até 15/11 o que só
// tem nomes (Majestic) ficava fora; ele pediu: "Coloque o nomes do majestic nas rodadas bônus!"
function hoteisDasRodadas(e) {
  return e.hoteis;
}
const temNomesNasRodadas = (e) => hoteisDasRodadas(e).some((h) => tipoDoHotel(h.id, e) === 'nomes');
// textos de contagem da roleta: nas rodadas com todos os hotéis, quartos e casais quando há nomes
function textosDe(id, e = fonte.estado()) {
  const tipo = tipoDoHotel(id, e);
  return tipo === 'bonus' && temNomesNasRodadas(e) ? TEXTOS.misto : TEXTOS[tipo];
}
const fraseDasRodadas = (e) => (temNomesNasRodadas(e) ? 'Quartos e casais de todos os hotéis' : 'Todos os quartos de todos os hotéis');

// o sorteio que encerra a roleta: um por hotel e um em cada rodada com todos os hotéis
function vencedorDe(id, e = fonte.estado()) {
  const validos = e.sorteios.filter((s) => !s.anulado_em);
  if (ehEspecial(id)) return validos.find((s) => s.rodada === id) || null;
  return validos.find((s) => s.hotel_id === id && !s.rodada) || null;
}

// o que vai na roda: antes do sorteio, os livres; depois, todos, com o vencedor em ouro
function rodaDe(id, e = fonte.estado()) {
  const v = vencedorDe(id, e);
  const especial = ehEspecial(id);
  if (!especial && v) return quartosDoHotel(e, id);
  const fora = foraDoSorteio(e);
  if (!especial) return quartosDoHotel(e, id).filter((q) => !fora.has(q.id));
  if (v) fora.delete(v.quarto_id); // o vencedor da rodada fica na roda, em ouro
  return hoteisDasRodadas(e).flatMap((h) => quartosDoHotel(e, h.id)).filter((q) => !fora.has(q.id));
}

function nomeDoHotel(id, e = fonte.estado()) {
  return nomeCompleto(e.hoteis.find((h) => h.id === id)) || 'Hotel removido';
}

// "quarto 101", ou o nome do casal quando o hotel só tem nomes
function itemDe(s, e = fonte.estado()) {
  return tipoDoHotel(s.hotel_id, e) === 'nomes' ? s.numero : `quarto ${s.numero}`;
}

function descricaoVencedor(s, e = fonte.estado()) {
  if (ehEspecial(s.rodada)) return `${itemDe(s, e)}, ${nomeDoHotel(s.hotel_id, e)}`;
  return itemDe(s, e);
}

// para frases: "quarto 101", "quarto 309 do Hotel Guarany" ou o nome do casal
function nomeDoSorteado(s, e = fonte.estado()) {
  if (ehEspecial(s.rodada)) return `${itemDe(s, e)} do ${nomeDoHotel(s.hotel_id, e)}`;
  return itemDe(s, e);
}
const comArtigo = (t) => (t.startsWith('quarto ') ? `o ${t}` : t);

// depois de um sorteio, o botão principal leva ao próximo passo do evento
function proximoDestino(e = fonte.estado()) {
  const pendente = e.hoteis.find((h) => h.id !== hotelId && rodaDe(h.id, e).length > 0 && !vencedorDe(h.id, e));
  if (pendente) return { hash: `#/roleta/${pendente.id}`, rotulo: `Próximo hotel: ${pendente.nome}` };
  for (const r of ESPECIAIS) {
    if (hotelId !== r && !vencedorDe(r, e) && rodaDe(r, e).length > 0) return { hash: RODADA[r].hash, rotulo: RODADA[r].ir };
  }
  return { hash: '#/resultados', rotulo: 'Ver os resultados' };
}

// ------------------------------------------------------------------ utilidades de tela
let avisoTempo = null;
function avisar(msg, ms = 5200) {
  const a = $('#aviso');
  a.textContent = msg;
  a.hidden = false;
  clearTimeout(avisoTempo);
  avisoTempo = setTimeout(() => { a.hidden = true; }, ms);
}

function mensagemErro(e) {
  if (e instanceof ErroCodigo) return 'O banco recusou o código do evento. Entre de novo com o código.';
  if (e instanceof ErroRede) return 'Sem conexão com o banco. Confira a internet e tente de novo.';
  if (e && /internet/i.test(e.message)) return e.message;
  return 'Não deu para concluir agora. Tente de novo em alguns segundos.';
}

function carregarPrefs() {
  try {
    const p = JSON.parse(armazem.ler(CH_PREFS) || '{}');
    if ([6, 9, 13].includes(p.duracao)) prefs.duracao = p.duracao;
    prefs.som = p.som === true;
    if (SONS.includes(p.somGiro)) prefs.somGiro = p.somGiro;
  } catch { /* fica o padrão */ }
}
function salvarPrefs() { armazem.gravar(CH_PREFS, JSON.stringify(prefs)); }

// diálogo de confirmação (pode exigir uma palavra digitada)
function confirmar({ titulo, texto, botao = 'Confirmar', exigir = null }) {
  const d = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-texto').textContent = texto || '';
  $('#dialogo-texto').hidden = !texto;
  const ok = $('#dialogo-ok');
  ok.textContent = botao;
  const input = $('#dialogo-campo');
  const cancelar = $('#dialogo-cancelar') || $('#dialogo button[value="cancelar"]');
  $('#dialogo-rotulo').hidden = !exigir;
  const rotulo = $('#dialogo-campo-texto');
  rotulo.replaceChildren();
  if (exigir) {
    const palavra = document.createElement('strong');
    palavra.textContent = exigir;
    rotulo.append('Para confirmar, digite ', palavra);
  }
  input.value = '';
  input.placeholder = exigir || '';
  const conferir = () => { ok.disabled = !!exigir && input.value.trim().toUpperCase() !== exigir; };
  input.oninput = conferir;
  conferir();
  // o foco nunca começa no botão que confirma: um Enter ou Espaço sem querer não faz nada
  const alvo = exigir ? input : cancelar;
  ok.autofocus = false;
  input.autofocus = !!exigir;
  if (cancelar) cancelar.autofocus = !exigir;
  return new Promise((resolve) => {
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.returnValue = '';
    d.showModal();
    alvo?.focus();
    setTimeout(() => alvo?.focus(), 30);
  });
}

function cancelarGiroAutomatico() {
  clearTimeout(giroAutomatico);
  giroAutomatico = null;
}

// depois de cancelar, o foco sai do botão que abriu o diálogo: senão o próximo Espaço ou Enter o reabre
function focarDepoisDeCancelar() {
  setTimeout(() => {
    if (tela === 'roleta') {
      const alvo = $('#bloco-resultado').hidden ? $('#botao-girar') : $('#proximo');
      if (alvo && !alvo.disabled) { alvo.focus({ preventScroll: true }); return; }
    }
    document.activeElement?.blur?.();
  }, 0);
}

function atualizarEstadoBanco() {
  let txt;
  let estado;
  if (!fonte) return;
  if (fonte.modo === 'demo') {
    txt = 'Demonstração: quartos de exemplo, nada é gravado';
    estado = 'demo';
  } else if (fonte.armazenamentoOk === false) {
    txt = 'Atenção: este navegador não está guardando os sorteios no aparelho. Não recarregue a página sem internet.';
    estado = 'pendente';
  } else if (fonte.pendentes()) {
    txt = `Sem conexão: ${plural(fonte.pendentes(), 'sorteio guardado', 'sorteios guardados')} neste aparelho, envio automático`;
    estado = 'pendente';
  } else if (conexao !== 'ok' || !navigator.onLine) {
    txt = 'Sem conexão com o banco agora';
    estado = 'pendente';
  } else {
    txt = 'Banco conectado';
    estado = 'ok';
  }
  for (const el of $$('.estado-banco')) { el.textContent = txt; el.dataset.estado = estado; }
}

// ------------------------------------------------------------------ início
function usarFonte(f) {
  fonte = f;
  fonte.aoMudar = aoMudarDados;
  fonte.aoConflito = aoConflito;
  document.body.classList.toggle('modo-demo', fonte.modo === 'demo');
  atualizarEstadoBanco();
}

async function iniciar() {
  carregarPrefs();
  ligarEventos();
  vigiarOutraAba();
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    usarFonte(new FonteDemo(dadosDemo()));
    rotear();
    return;
  }
  const codigo = armazem.ler(CH_CODIGO);
  if (!codigo) { mostrarEntrada(); return; }
  usarFonte(new FonteRemota({ url: SUPABASE_URL, chave: SUPABASE_CHAVE, codigo }));
  fonte.restaurar();
  rotear();
  try {
    await fonte.carregar();
    conexao = 'ok';
  } catch (e) {
    if (e instanceof ErroCodigo) { esquecerCodigo('O código guardado neste aparelho não vale mais. Digite o código do evento.'); return; }
    conexao = 'sem_conexao';
    avisar('Sem conexão com o banco agora. A tela mostra o que está guardado neste aparelho.');
  }
  atualizarEstadoBanco();
  if (fonte.pendentes()) fonte.enviarFila().then(atualizarEstadoBanco);
}

// Duas abas sorteando no mesmo aparelho brigam pela mesma fila: avisa para usar só uma.
function vigiarOutraAba() {
  if (!('BroadcastChannel' in window)) return;
  const canal = new BroadcastChannel('cpgd29-sorteio');
  const aviso = () => {
    if (outraAba) return;
    outraAba = true;
    avisar('O sorteio já está aberto em outra aba ou janela deste aparelho. Feche uma delas e sorteie por uma só.', 15000);
  };
  canal.onmessage = (ev) => {
    if (ev.data === 'oi') { canal.postMessage('aqui'); aviso(); } else if (ev.data === 'aqui') aviso();
  };
  canal.postMessage('oi');
}

function esquecerCodigo(msg) {
  armazem.apagar(CH_CODIGO);
  fonte = null;
  mostrarEntrada(msg);
}

function rotear() {
  // Voltar do navegador, botão do mouse ou gesto do touchpad com um diálogo aberto: o diálogo fecha
  // como cancelado, para nunca confirmar algo sobre uma roleta que já não é a da tela
  const dlg = $('#dialogo');
  if (dlg?.open) dlg.close('cancelar');
  cancelarGiroAutomatico();
  if (!fonte) { mostrarEntrada(); return; }
  // durante o giro a tela fica na roleta: trocar de hotel no meio misturava a roda de um com o nome de outro
  if (fase === 'girando' && tela === 'roleta' && hotelId != null) {
    const aqui = emEspecial() ? RODADA[hotelId].hash : `#/roleta/${hotelId}`;
    if (location.hash !== aqui) {
      history.replaceState(null, '', aqui);
      avisar('Espere a roleta parar.');
    }
    return;
  }
  const h = location.hash || '#/hoteis';
  const m = h.match(/^#\/roleta\/(\d+)$/);
  if (m) mostrarRoleta(Number(m[1]));
  else if (h === RODADA[BONUS].hash) mostrarRoleta(BONUS);
  else if (h === RODADA[OUTRA].hash) mostrarRoleta(OUTRA);
  else if (h === '#/resultados') mostrarResultados();
  else if (h === '#/configurar') mostrarConfig();
  else mostrarHoteis();
}

function ativarTela(nome) {
  for (const s of $$('.tela')) s.hidden = s.id !== `tela-${nome}`;
  tela = nome;
  document.body.dataset.tela = nome;
  window.scrollTo(0, 0);
  atualizarEstadoBanco();
}

function chaveDaRoda(e = fonte.estado()) {
  const v = vencedorDe(hotelId, e);
  return `${rodaDe(hotelId, e).map((q) => q.id).join(',')}|${v ? v.cliente_id : ''}`;
}

function aoMudarDados() {
  atualizarEstadoBanco();
  if (tela === 'hoteis') renderHoteis();
  else if (tela === 'resultados') renderResultados();
  else if (tela === 'roleta') {
    if (fase === 'pronto' && chaveDaRoda() !== idsNaRoda) montarRoda();
    if (fase === 'resultado' && resultado) {
      // o sorteio que estava guardado no aparelho chegou ao banco: o aviso acompanha
      const s = fonte.estado().sorteios.find((x) => x.cliente_id === resultado.cliente_id);
      if (s && !s.pendente && !s.anulado_em && resultado.envio === 'pendente') { resultado.envio = 'gravado'; }
    }
    atualizarPainelRoleta();
  }
}

function aoConflito(c) {
  const ex = c.existente;
  const item = maiuscula(itemDe(c));
  const jaEra = ex && ex.hotel_id != null ? ` (${itemDe(ex)})` : '';
  const msgs = {
    quarto_ja_sorteado: `${item} já tinha sido sorteado em outro aparelho. Nada foi gravado.`,
    hotel_ja_sorteado: `Este hotel já tinha o sorteio feito em outro aparelho${jaEra}. Nada foi gravado.`,
    bonus_ja_sorteado: `A rodada bônus já tinha sido sorteada em outro aparelho${jaEra}. Nada foi gravado.`,
    outra_data_ja_sorteada: `A hospedagem em outra data já tinha sido sorteada em outro aparelho${jaEra}. Nada foi gravado.`,
    quarto_ausente: `${item} foi marcado como ausente em outro aparelho. Nada foi gravado.`,
  };
  const msg = msgs[c.motivo] || `${item} saiu da lista do hotel e o sorteio não foi gravado.`;
  const eAtual = resultado && resultado.cliente_id === c.cliente_id;
  if (eAtual) { resultado.envio = 'conflito'; resultado.mensagem = msg; }
  // enquanto a roda gira o aviso espera, para não entregar nada antes da hora
  if (!(eAtual && fase === 'girando')) avisar(msg, 9000);
  if (eAtual && fase === 'resultado') { fase = 'pronto'; resultado = null; montarRoda(); atualizarPainelRoleta(); }
  fonte.carregar().catch(() => {});
}

// ------------------------------------------------------------------ entrada
function mostrarEntrada(msg) {
  ativarTela('entrada');
  $('#entrada-erro').textContent = msg || '';
  setTimeout(() => $('#codigo').focus(), 60);
}

async function entrar(ev) {
  ev.preventDefault();
  const codigo = normalizarCodigo($('#codigo').value);
  const erro = $('#entrada-erro');
  if (codigo.length < 6) { erro.textContent = 'Digite o código do evento, com 8 letras e números.'; return; }
  const botao = $('#botao-entrar');
  botao.disabled = true;
  erro.textContent = 'Conferindo o código...';
  const f = new FonteRemota({ url: SUPABASE_URL, chave: SUPABASE_CHAVE, codigo });
  f.restaurar();
  try {
    await f.carregar();
    armazem.gravar(CH_CODIGO, codigo);
    conexao = 'ok';
    usarFonte(f);
    erro.textContent = '';
    $('#codigo').value = '';
    if (location.hash === '#/hoteis') rotear(); else location.hash = '#/hoteis';
    if (f.pendentes()) f.enviarFila().then(atualizarEstadoBanco);
  } catch (e) {
    erro.textContent = e instanceof ErroCodigo
      ? 'Código não reconhecido. Confira as letras e os números e tente de novo.'
      : 'Sem conexão com o banco. Confira a internet e tente de novo.';
  } finally {
    botao.disabled = false;
  }
}

// ------------------------------------------------------------------ hotéis
function mostrarHoteis() {
  ativarTela('hoteis');
  renderHoteis();
}

function renderHoteis() {
  const e = fonte.estado();
  const cont = contagens(e);
  const frag = document.createDocumentFragment();
  let feitos = 0;
  let comLista = 0;
  for (const h of e.hoteis) {
    const c = cont.get(h.id) || { total: 0, sorteados: 0 };
    const tipo = tipoDoHotel(h.id, e);
    const tx = TEXTOS[tipo];
    const v = vencedorDe(h.id, e);
    if (c.total) comLista++;
    if (v) feitos++;
    const livres = rodaDe(h.id, e).length;
    const a = document.createElement('a');
    a.className = v ? 'cartao-hotel feito' : 'cartao-hotel';
    a.href = `#/roleta/${h.id}`;
    const pre = prefixoVisivel(h);
    const conta = v ? `Sorteado: ${descricaoVencedor(v, e)}`
      : (c.total ? `${livres} ${livres === 1 ? tx.um : tx.varios} na roleta` : 'Nenhum quarto cadastrado ainda');
    a.innerHTML = `
      <figure class="cartao-foto">${h.foto ? `<img src="img/hoteis/${encodeURIComponent(h.foto)}.jpg" alt="Fachada do ${esc(nomeCompleto(h))}" loading="lazy">` : '<span class="cartao-sem-foto"></span>'}</figure>
      <div class="cartao-linha">${pre ? `<span class="cartao-prefixo">${esc(pre)}</span>` : ''}<span class="cartao-nome">${esc(h.nome)}</span></div>
      <p class="cartao-conta">${esc(conta)}</p>
      <div class="cartao-barra" aria-hidden="true"><span></span></div>`;
    a.querySelector('.cartao-barra span').style.width = v ? '100%' : '0%';
    frag.append(a);
  }
  // rodadas com todos os quartos de todos os hotéis numa roleta só, uma vez cada: a bônus e a
  // hospedagem em outra data
  for (const r of ESPECIAIS) {
    const vr = vencedorDe(r, e);
    const cartao = document.createElement('a');
    const classe = r === BONUS ? 'cartao-bonus' : 'cartao-outra';
    cartao.className = vr ? `${classe} feito` : classe;
    cartao.href = RODADA[r].hash;
    const naRoda = rodaDe(r, e).length;
    const txr = textosDe(r, e);
    cartao.innerHTML = `
      <img class="bonus-simbolo" src="img/logo-casal.png" alt="">
      <span class="bonus-titulo">${esc(RODADA[r].titulo)}</span>
      <span class="bonus-texto">${esc(fraseDasRodadas(e))}</span>
      <span class="bonus-conta">${esc(vr ? `Sorteado: ${descricaoVencedor(vr, e)}` : plural(naRoda, `${txr.um} na roleta`, `${txr.varios} na roleta`))}</span>`;
    frag.append(cartao);
  }
  const resumo = document.createElement('a');
  resumo.className = 'cartao-resumo';
  resumo.href = '#/resultados';
  resumo.innerHTML = `
    <span class="resumo-rotulo">Até agora</span>
    <span class="resumo-numero">${feitos}</span>
    <span class="resumo-texto">de ${plural(comLista, 'hotel sorteado', 'hotéis sorteados')}</span>
    <span class="resumo-link">Ver os resultados</span>`;
  frag.append(resumo);
  $('#grade-hoteis').replaceChildren(frag);
  $('#hoteis-vazio').hidden = e.hoteis.length > 0;
  const resetarBt = $('#resetar-tudo-hoteis');
  if (resetarBt) resetarBt.disabled = !temAlgoParaResetar(e);
}

// ------------------------------------------------------------------ roleta
function mostrarRoleta(id) {
  const e = fonte.estado();
  const especial = ehEspecial(id);
  const h = especial ? null : e.hoteis.find((x) => x.id === id);
  if (!especial && !h) { location.hash = '#/hoteis'; return; }
  ativarTela('roleta');
  if (!roleta) roleta = new Roleta($('#roleta'), { logo: logoCasal });
  roleta.som = prefs.som ? tique : null;
  if (prefs.somGiro === 'musica') musica.preparar();
  if (prefs.somGiro === 'tambor') tambor.preparar?.();
  // fora do giro, entrar na roleta é sempre começar do zero (resultado antigo não volta)
  if (!(fase === 'girando' && hotelId === id)) {
    hotelId = id;
    fase = 'pronto';
    resultado = null;
    montarRoda();
  }
  const pre = h ? prefixoVisivel(h) : '';
  $('#painel-prefixo').textContent = pre;
  $('#painel-prefixo').hidden = !pre;
  $('#painel-nome').textContent = h ? h.nome : RODADA[id].titulo;
  $('#painel-frase').textContent = h ? 'Sorteio do quarto' : fraseDasRodadas(e);
  $('#resetar-hotel').textContent = h ? 'Resetar o sorteio deste hotel' : RODADA[id].botaoReset;
  atualizarPainelRoleta();
  atualizarBotaoSom();
  if (fase === 'pronto') setTimeout(() => (vencedorDe(hotelId) ? $('#proximo') : $('#botao-girar')).focus({ preventScroll: true }), 80);
}

function montarRoda() {
  const e = fonte.estado();
  const lista = rodaDe(hotelId, e);
  idsNaRoda = chaveDaRoda(e);
  roleta.definirQuartos(lista);
  roleta.hotelId = hotelId;
  const v = vencedorDe(hotelId, e);
  if (v) roleta.mostrarVencedor(lista.findIndex((q) => q.id === v.quarto_id));
}

function atualizarPainelRoleta() {
  if (hotelId == null || !fonte) return;
  const e = fonte.estado();
  const tipo = tipoDoHotel(hotelId, e);
  const tx = textosDe(hotelId, e);
  const v = vencedorDe(hotelId, e);
  const concluido = fase === 'pronto' && !!v;
  const mostrarVencedor = fase === 'resultado' || concluido;
  const telaRoleta = $('#tela-roleta');
  telaRoleta.dataset.fase = fase;
  telaRoleta.dataset.tipo = tipo;
  // antes de sortear: quantos estão na roleta e o botão
  const naRoda = fase === 'pronto' ? rodaDe(hotelId, e).length : (roleta ? roleta.quartos.length : 0);
  const conta = $('#painel-conta');
  // roleta que ficou vazia porque os que sobraram estão ausentes: o caminho é o reset, não o cadastro
  const vaziaPorAusentes = ausentesDe(hotelId, e).length > 0
    ? `Não sobrou nenhum ${tx.um} nesta roleta. Para devolver os ausentes, resete o sorteio ${emEspecial() ? RODADA[hotelId].da : 'deste hotel'}.`
    : '';
  if (!naRoda && fase === 'pronto' && !v) {
    conta.textContent = vaziaPorAusentes || (emEspecial() ? 'Nenhum quarto livre nos hotéis.' : 'Este hotel ainda não tem quartos cadastrados.');
  } else {
    conta.innerHTML = `<strong>${naRoda}</strong> ${naRoda === 1 ? tx.um : tx.varios} na roleta`;
  }
  $('#bloco-pronto').hidden = mostrarVencedor;
  $('#bloco-resultado').hidden = !mostrarVencedor;
  const semQuartos = !roleta || roleta.quartos.length === 0;
  const girarBt = $('#botao-girar');
  girarBt.disabled = fase !== 'pronto' || semQuartos || !!v;
  const demo = fonte.modo === 'demo' ? ' (demonstração)' : '';
  girarBt.textContent = fase === 'girando' ? 'Girando...' : `Girar a roleta${demo}`;
  const vazia = $('#roleta-vazia');
  vazia.hidden = !(fase === 'pronto' && semQuartos && !v);
  vazia.textContent = vaziaPorAusentes || (emEspecial() ? 'Nenhum quarto livre nos hotéis.' : 'Cadastre os quartos deste hotel em Configurar.');
  const voltar = $('.telao-voltar');
  voltar.classList.toggle('travado', fase === 'girando');
  voltar.setAttribute('aria-disabled', String(fase === 'girando'));
  $('#resetar-hotel').disabled = fase === 'girando' || !(v || (resultado && fase === 'resultado') || ausentesDe(hotelId, e).length);
  const ausenteBt = $('#ausente');
  if (ausenteBt) {
    // só com um sorteado na tela; num conflito (nada gravado) não há quem marcar
    ausenteBt.hidden = !mostrarVencedor || typeof fonte.liberarAusentes !== 'function';
    ausenteBt.disabled = fase === 'girando' || !v || (fase === 'resultado' && resultado?.envio === 'conflito');
  }
  if (mostrarVencedor) {
    // o vencedor: o recém-sorteado (com o aviso de gravação) ou o que já estava sorteado
    const s = fase === 'resultado' && resultado
      ? { numero: resultado.quarto.numero, hotel_id: resultado.quarto.hotel_id, rodada: emEspecial() ? hotelId : null }
      : v;
    // nas rodadas com todos os hotéis o sorteado pode ser um quarto ou um casal do hotel de nomes
    const tipoItem = tipo === 'bonus' ? tipoDoHotel(s.hotel_id, e) : tipo;
    $('#resultado-rotulo').textContent = TEXTOS[tipoItem].rotulo;
    const num = $('#resultado-numero');
    num.textContent = s.numero;
    num.classList.toggle('numero-longo', tipoItem !== 'nomes' && String(s.numero).length > 4);
    num.classList.toggle('numero-nome', tipoItem === 'nomes');
    const hotel = $('#resultado-hotel');
    hotel.hidden = tipo !== 'bonus';
    hotel.textContent = tipo === 'bonus' ? nomeDoHotel(s.hotel_id, e) : '';
    const envio = $('#resultado-envio');
    if (fase === 'resultado' && resultado) {
      const textos = {
        enviando: 'Gravando no banco...',
        gravado: 'Gravado no banco',
        pendente: 'Sem internet: guardado neste aparelho, envio automático',
        conflito: resultado.mensagem || 'Outro aparelho já tinha sorteado. Nada foi gravado.',
        codigo_invalido: 'O banco recusou o código do evento. Entre de novo com o código.',
        demonstracao: 'Demonstração: nada foi gravado',
      };
      envio.textContent = textos[resultado.envio] || '';
      envio.dataset.estado = resultado.envio;
    } else {
      envio.textContent = `Sorteado às ${formatarHora(v.sorteado_em)}${v.pendente ? ', guardado neste aparelho' : ''}`;
      envio.dataset.estado = v.pendente ? 'pendente' : 'gravado';
    }
    const destino = proximoDestino(e);
    const prox = $('#proximo');
    prox.textContent = destino.rotulo;
    prox.dataset.hash = destino.hash;
  }
}

async function girar() {
  if (fase !== 'pronto' || !roleta || roleta.giro) return;
  if (vencedorDe(hotelId)) { avisar('Esta roleta já tem o sorteio feito. Para sortear de novo, resete o sorteio dela.'); return; }
  if (roleta.hotelId !== hotelId) { montarRoda(); return; }
  const lista = roleta.quartos;
  if (!lista.length) return;
  const tipo = tipoDoHotel(hotelId);
  const alvo = sortearIndice(lista.length);
  const quarto = lista[alvo];
  const cliente_id = novoId();
  resultado = { quarto, cliente_id, envio: 'enviando', tipo };
  fase = 'girando';
  roleta.som = prefs.som ? tique : null;
  atualizarPainelRoleta();
  if (prefs.somGiro === 'tambor') tambor.tocar(prefs.duracao);
  else if (prefs.somGiro === 'musica') musica.tocar();
  // grava já no clique: o giro é a revelação de um sorteio que já aconteceu; nas rodadas com todos os
  // hotéis o quarto é do próprio hotel (sai da roleta dele também) e leva a marca da rodada
  fonte.registrar({ hotel_id: quarto.hotel_id, quarto_id: quarto.id, numero: quarto.numero, cliente_id, rodada: emEspecial() ? hotelId : null })
    .then((r) => {
      if (resultado?.cliente_id === cliente_id && resultado.envio !== 'conflito') {
        resultado.envio = r.envio;
        if (fase === 'resultado') atualizarPainelRoleta();
      }
      atualizarEstadoBanco();
    })
    .catch(() => { if (resultado?.cliente_id === cliente_id) { resultado.envio = 'pendente'; if (fase === 'resultado') atualizarPainelRoleta(); } });
  const parada = await roleta.girar(alvo, { duracao: prefs.duracao, desvio: sortearDesvio() });
  if (parada.indice !== alvo) console.error('A roleta parou fora do sorteado', parada, alvo);
  if (resultado?.cliente_id !== cliente_id) { tambor.parar(); musica.parar(); return; }
  if (resultado.envio === 'conflito') {
    // outro aparelho já tinha sorteado: não anuncia, avisa e mostra a roleta atualizada
    tambor.parar();
    musica.parar();
    const msg = resultado.mensagem;
    fase = 'pronto';
    resultado = null;
    montarRoda();
    atualizarPainelRoleta();
    avisar(msg || 'Outro aparelho já tinha sorteado. Nada foi gravado.', 9000);
    return;
  }
  if (prefs.somGiro === 'tambor') tambor.final();
  else if (prefs.somGiro === 'musica') { musica.parar(); tocarSino(); }
  fase = 'resultado';
  atualizarPainelRoleta();
  soltarLuzes();
  setTimeout(() => $('#proximo').focus({ preventScroll: true }), 60);
}

function irAdiante() {
  if (fase === 'girando') return;
  const hash = $('#proximo').dataset.hash || '#/hoteis';
  fase = 'pronto';
  resultado = null;
  location.hash = hash;
}

async function resetarRoleta() {
  if (fase === 'girando') return;
  cancelarGiroAutomatico();
  const id = hotelId;
  const e = fonte.estado();
  const especial = ehEspecial(id);
  const validos = e.sorteios.filter((s) => !s.anulado_em && daRoleta(s, id));
  const ausentes = ausentesDe(id, e);
  if (!validos.length && !ausentes.length) return;
  // um dados.js antigo guardado no aparelho não sabe devolver o ausente da outra data
  const semRodadaNova = id === OUTRA && !(fonte.rodadasEspeciais || []).includes(OUTRA);
  if (ausentes.length && (typeof fonte.liberarAusentes !== 'function' || semRodadaNova)) {
    avisar('Recarregue a página (versão nova) para poder devolver os ausentes desta roleta.', 9000);
    return;
  }
  const chave = (vs, as) => `${vs.map((s) => s.cliente_id).join(',')}|${as.map((s) => s.cliente_id).join(',')}`;
  const antes = chave(validos, ausentes);
  const h = especial ? null : e.hoteis.find((x) => x.id === hotelId);
  const roletaTxt = especial ? RODADA[id].aRoleta : 'a roleta deste hotel';
  const sorteado = validos.length ? maiuscula(nomeDoSorteado(validos[0], e)) : '';
  const voltam = ausentes.length === 1
    ? `${comArtigo(nomeDoSorteado(ausentes[0], e))}, que estava ausente, volta`
    : `os ${ausentes.length} ausentes voltam`;
  let texto;
  if (validos.length && ausentes.length) texto = `${sorteado} deixa de ser o sorteado e ${voltam} para ${roletaTxt}, que volta a girar.`;
  else if (validos.length) texto = `${sorteado} deixa de ser o sorteado e ${roletaTxt} volta a girar.`;
  else texto = `${maiuscula(voltam)} para ${roletaTxt}.`;
  const ok = await confirmar({
    titulo: especial ? RODADA[id].tituloReset : `Resetar o sorteio do ${nomeCompleto(h)}?`,
    texto: `${texto} Não dá para desfazer; o histórico fica guardado como reset.`,
    botao: especial ? RODADA[id].botaoReset : 'Resetar este hotel',
    exigir: 'RESETAR',
  });
  if (!ok) { focarDepoisDeCancelar(); return; }
  if (tela !== 'roleta' || hotelId !== id) return;
  if (fase === 'girando') { avisar('A roleta está girando: espere ela parar e resete de novo.', 8000); return; }
  const agora = fonte.estado();
  const validosAgora = agora.sorteios.filter((x) => !x.anulado_em && daRoleta(x, id));
  const ausentesAgora = ausentesDe(id, agora);
  if (chave(validosAgora, ausentesAgora) !== antes) {
    avisar('O sorteio desta roleta mudou enquanto a confirmação estava aberta. Confira e resete de novo.', 8000);
    return;
  }
  // a tela muda já; os envios vão pela fila sem a tela esperar a rede
  fase = 'pronto';
  resultado = null;
  for (const s of validosAgora) fonte.anular(s.cliente_id, 'reset').catch(() => {});
  if (ausentesAgora.length) fonte.liberarAusentes(especial ? null : id, especial ? id : false).catch(() => {});
  montarRoda();
  atualizarPainelRoleta();
  avisar(especial ? RODADA[id].resetado : `Sorteio do ${nomeCompleto(h)} resetado: a roleta pode girar de novo.`);
  setTimeout(() => $('#botao-girar').focus({ preventScroll: true }), 30);
}

// Ausente (pedido de 14/11 à noite): o sorteado não está no salão. Sai do sorteio (desta roleta e
// das outras) e a roleta gira de novo na hora, já sem ele.
async function marcarAusente() {
  if (fase === 'girando' || !fonte) return;
  const e = fonte.estado();
  const v = vencedorDe(hotelId, e);
  if (!v) return;
  const quem = nomeDoSorteado(v, e);
  const ok = await confirmar({
    titulo: `${maiuscula(quem)} ausente?`,
    texto: `${maiuscula(comArtigo(quem))} sai do sorteio${emEspecial() ? '' : ' (desta roleta, da rodada bônus e da hospedagem em outra data)'} e a roleta gira de novo na hora.`,
    botao: 'Ausente: sortear de novo',
  });
  if (!ok) { focarDepoisDeCancelar(); return; }
  const agora = vencedorDe(hotelId);
  if (fase === 'girando' || !agora || agora.cliente_id !== v.cliente_id) return;
  fase = 'pronto';
  resultado = null;
  fonte.anular(v.cliente_id, AUSENTE).catch(() => {}); // entra na fila na hora; a tela não espera a rede
  if (chaveDaRoda() !== idsNaRoda) montarRoda();
  atualizarPainelRoleta();
  if (!roleta.quartos.length) {
    avisar(`${maiuscula(quem)} ausente. Não sobrou nenhum ${textosDe(hotelId).um} nesta roleta.`, 8000);
    return;
  }
  avisar(`${maiuscula(quem)} ausente: fora do sorteio. Sorteando de novo.`);
  const id = hotelId;
  cancelarGiroAutomatico();
  giroAutomatico = setTimeout(() => {
    giroAutomatico = null;
    if (tela === 'roleta' && hotelId === id && fase === 'pronto' && !$('#dialogo').open && !vencedorDe(hotelId)) girar();
  }, 900);
}

function soltarLuzes() {
  if (semMovimento()) return;
  const caixa = $('#luzes');
  caixa.replaceChildren();
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('span');
    s.style.left = `${4 + Math.random() * 92}%`;
    s.style.top = `${30 + Math.random() * 60}%`;
    s.style.animationDelay = `${Math.random() * 0.9}s`;
    s.style.animationDuration = `${2.4 + Math.random() * 1.6}s`;
    const t = 4 + Math.random() * 8;
    s.style.width = `${t}px`;
    s.style.height = `${t}px`;
    caixa.append(s);
  }
  setTimeout(() => caixa.replaceChildren(), 4800);
}

function atualizarBotaoSom() {
  const b = $('#som-giro');
  b.textContent = NOME_SOM[prefs.somGiro];
  $('#pref-som-giro').value = prefs.somGiro;
}

function trocarSom() {
  prefs.somGiro = SONS[(SONS.indexOf(prefs.somGiro) + 1) % SONS.length];
  salvarPrefs();
  atualizarBotaoSom();
  if (prefs.somGiro === 'musica') musica.preparar();
  if (prefs.somGiro === 'tambor') tambor.preparar?.();
}

function telaCheia() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ------------------------------------------------------------------ resultados
function mostrarResultados() {
  ativarTela('resultados');
  renderResultados();
}

function situacaoDe(s) {
  if (s.anulado_em) {
    if (s.motivo_anulacao === AUSENTE) return 'Ausente';
    if (s.motivo_anulacao === 'ausente_resetado') return 'Ausente, depois resetado';
    return s.motivo_anulacao === 'reset' ? 'Resetado' : 'Desfeito';
  }
  return s.pendente ? 'Guardado no aparelho' : 'Sorteado';
}

// os hotéis primeiro, depois a rodada bônus e a hospedagem em outra data
const ordemDaRodada = (s) => (ehEspecial(s.rodada) ? ESPECIAIS.indexOf(s.rodada) + 1 : 0);
const rotuloRodada = (s) => (ehEspecial(s.rodada) ? RODADA[s.rodada].coluna : 'Do hotel');

function linhasResultado(e, filtro, comDesfeitos) {
  const ordemHotel = new Map(e.hoteis.map((h, i) => [h.id, i]));
  return e.sorteios
    .filter((s) => (filtro === 'todos' || (ehEspecial(filtro) ? s.rodada === filtro : (s.hotel_id === filtro && !s.rodada)))
      && (comDesfeitos || !s.anulado_em))
    .sort((a, b) => (ordemDaRodada(a) - ordemDaRodada(b))
      || ((ordemHotel.get(a.hotel_id) ?? 99) - (ordemHotel.get(b.hotel_id) ?? 99))
      || String(a.sorteado_em).localeCompare(String(b.sorteado_em)))
    .map((s) => ({ s, hotel: nomeDoHotel(s.hotel_id, e) }));
}

function renderResultados() {
  const e = fonte.estado();
  if (filtroHotel !== 'todos' && !ehEspecial(filtroHotel) && !e.hoteis.some((h) => h.id === filtroHotel)) filtroHotel = 'todos';
  const filtros = [{ id: 'todos', nome: 'Todos' }, ...e.hoteis.map((h) => ({ id: h.id, nome: h.nome })),
    ...ESPECIAIS.map((r) => ({ id: r, nome: RODADA[r].titulo }))];
  $('#filtros').replaceChildren(...filtros.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtro';
    b.textContent = f.nome;
    b.setAttribute('aria-pressed', String(filtroHotel === f.id));
    b.addEventListener('click', () => { filtroHotel = f.id; renderResultados(); });
    return b;
  }));
  $('#mostrar-desfeitos').checked = mostrarDesfeitos;
  const linhas = linhasResultado(e, filtroHotel, mostrarDesfeitos);
  $('#tabela-corpo').replaceChildren(...linhas.map(({ s, hotel }) => {
    const tr = document.createElement('tr');
    if (s.anulado_em) tr.className = 'desfeito';
    tr.innerHTML = `<td>${esc(hotel)}</td><td class="col-quarto">${esc(s.numero)}</td><td class="col-rodada">${esc(rotuloRodada(s))}</td><td class="col-hora">${esc(formatarDataHora(s.sorteado_em))}</td><td class="col-situacao">${esc(situacaoDe(s))}</td>`;
    return tr;
  }));
  const feitos = e.hoteis.filter((h) => vencedorDe(h.id, e)).length;
  const extras = ESPECIAIS.filter((r) => vencedorDe(r, e)).map((r) => RODADA[r].resumo);
  const fim = extras.length ? `, mais ${juntar(extras)}` : '';
  $('#resultados-resumo').textContent = `${feitos} de ${plural(e.hoteis.length, 'hotel sorteado', 'hotéis sorteados')}${fim}.`;
  $('#resultados-vazio').hidden = linhas.length > 0;
  $('#resetar-tudo').disabled = !temAlgoParaResetar(e);
}

// Extrair ganhadores: arquivo para o Excel só com os sorteios válidos (hotéis na ordem, depois a
// rodada bônus e a hospedagem em outra data).
function extrairGanhadores() {
  const e = fonte.estado();
  const linhas = linhasResultado(e, 'todos', false);
  if (!linhas.length) { avisar('Ainda não há ganhadores para extrair.'); return; }
  // sem internet, o que ainda está só neste aparelho sai marcado (pode não chegar ao banco)
  const soAqui = linhas.filter(({ s }) => s.pendente).length;
  const cabecalho = ['Hotel', 'Sorteado', 'Rodada', 'Data e hora'];
  if (soAqui) cabecalho.push('Situação');
  const tabela = [cabecalho, ...linhas.map(({ s, hotel }) => {
    const l = [hotel, s.numero, rotuloRodada(s), formatarDataHora(s.sorteado_em)];
    if (soAqui) l.push(s.pendente ? 'Só neste aparelho, sem internet' : 'Gravado no banco');
    return l;
  })];
  const blob = new Blob([gerarCsv(tabela)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const hoje = new Date();
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `ganhadores-sorteio-29-cpgd-${dia}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  avisar(`${plural(linhas.length, 'ganhador extraído', 'ganhadores extraídos')} para a planilha.${soAqui
    ? ` ${plural(soAqui, 'ainda está', 'ainda estão')} só neste aparelho: extraia de novo quando a internet voltar.` : ''}`, soAqui ? 9000 : 5200);
}

async function resetarTudo() {
  if (!fonte) return;
  // o reset geral precisa de internet: com sorteio guardado no aparelho, avisa antes de pedir a palavra
  if (fonte.pendentes()) await fonte.enviarFila();
  if (fonte.pendentes()) {
    avisar('O reset geral precisa de internet: ainda há sorteios guardados neste aparelho esperando envio. Tente de novo quando a conexão voltar.', 9000);
    return;
  }
  const e = fonte.estado();
  const validos = e.sorteios.filter((s) => !s.anulado_em);
  const nAus = e.sorteios.filter(ehAusente).length;
  if (!validos.length && !nAus) return;
  const nHoteis = validos.filter((s) => !ehEspecial(s.rodada)).length;
  const partes = [];
  if (nHoteis) partes.push(nHoteis === 1 ? 'o ganhador de 1 hotel' : `os ganhadores de ${nHoteis} hotéis`);
  for (const r of ESPECIAIS) if (validos.some((s) => s.rodada === r)) partes.push(RODADA[r].ganhador);
  const deixam = partes.length ? `${maiuscula(juntar(partes))} ${validos.length === 1 ? 'deixa' : 'deixam'} de valer` : '';
  const voltam = nAus === 1 ? 'o ausente volta ao sorteio' : `os ${nAus} ausentes voltam ao sorteio`;
  let texto;
  if (deixam && nAus) texto = `${deixam}, ${voltam} e todas as roletas voltam a girar.`;
  else if (deixam) texto = `${deixam} e todas as roletas voltam a girar.`;
  else texto = `${maiuscula(voltam)} e todas as roletas voltam a girar.`;
  const ok = await confirmar({
    titulo: 'Resetar todo o sorteio?',
    texto: `${texto} Não dá para desfazer; o histórico fica guardado como reset.`,
    botao: 'Resetar todo o sorteio',
    exigir: 'RESETAR',
  });
  if (!ok) { focarDepoisDeCancelar(); return; }
  for (const b of [$('#resetar-tudo'), $('#resetar-tudo-hoteis')]) if (b) b.disabled = true;
  avisar('Resetando o sorteio...', 15000);
  try {
    const r = await fonte.resetar(null);
    const a = r?.ausentes_liberados || 0;
    avisar(`Sorteio resetado: ${plural(r?.anulados || 0, 'sorteio voltou', 'sorteios voltaram')} para as roletas${a ? ` e ${plural(a, 'ausente voltou', 'ausentes voltaram')} ao sorteio` : ''}.`);
  } catch (err) {
    avisar(mensagemErro(err), 8000);
  } finally {
    if (tela === 'resultados') renderResultados(); else if (tela === 'hoteis') renderHoteis();
  }
}

// ------------------------------------------------------------------ configurar
function mostrarConfig() {
  ativarTela('configurar');
  renderConfig();
}

function renderConfig() {
  const e = fonte.estado();
  $('#config-hoteis').replaceChildren(...e.hoteis.map((h) => blocoHotel(h, e)));
  $('#pref-duracao').value = String(prefs.duracao);
  $('#pref-som').checked = prefs.som;
  $('#pref-som-giro').value = prefs.somGiro;
  $('#bloco-sair').hidden = fonte.modo !== 'remoto';
}

function previaQuartos(texto, alvo) {
  const r = interpretarListaQuartos(texto);
  alvo.replaceChildren();
  const nomes = ehListaDeNomes(r.quartos);
  const linha = document.createElement('span');
  linha.textContent = r.quartos.length
    ? `${nomes ? plural(r.quartos.length, 'nome', 'nomes') : plural(r.quartos.length, 'quarto', 'quartos')}: ${nomes ? r.quartos.join(', ') : descreverLista(r.quartos)}`
    : 'Nenhum quarto na lista.';
  alvo.append(linha);
  for (const erro of r.erros) {
    const s = document.createElement('span');
    s.className = 'previa-erro';
    s.textContent = `Confira ${erro}.`;
    alvo.append(s);
  }
  return r;
}

// Um botão só por hotel: grava nome, foto, ordem e quartos juntos, e só este bloco é redesenhado
// (o resto da tela mantém o que o operador estiver digitando em outro hotel).
function blocoHotel(h, e) {
  const art = document.createElement('article');
  art.className = 'config-hotel';
  const numeros = quartosDoHotel(e, h.id).map((q) => q.numero);
  const nomes = ehListaDeNomes(numeros);
  const opcoesFoto = ['<option value="">Sem foto</option>',
    ...FOTOS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`)].join('');
  art.innerHTML = `
    <div class="config-foto">${h.foto ? `<img src="img/hoteis/${encodeURIComponent(h.foto)}.jpg" alt="">` : ''}</div>
    <div class="config-campos">
      <div class="config-linha">
        <label class="campo campo-nome"><span>Nome</span><input name="nome" maxlength="80" value="${esc(h.nome)}"></label>
        <label class="campo campo-foto"><span>Foto</span><select name="foto">${opcoesFoto}</select></label>
        <label class="campo campo-ordem"><span>Ordem</span><input name="ordem" type="number" min="0" max="99" value="${Number(h.ordem) || 0}"></label>
        <label class="campo-marcar"><input name="prefixo" type="checkbox" ${h.prefixo ? 'checked' : ''}><span>Escrever HOTEL antes do nome</span></label>
      </div>
      <label class="campo campo-quartos"><span>${nomes ? 'Nomes deste hotel' : 'Quartos deste hotel'}</span>
        <textarea name="quartos" rows="3" spellcheck="false" placeholder="Exemplo: 101 a 120, 201 a 220, 305">${esc(nomes ? numeros.join('\n') : descreverLista(numeros))}</textarea></label>
      <p class="config-previa" aria-live="polite"></p>
      <div class="config-acoes">
        <button type="button" class="botao-claro" data-acao="salvar">Salvar este hotel</button>
        <button type="button" class="botao-discreto" data-acao="remover">Remover hotel</button>
      </div>
    </div>`;
  $('select[name="foto"]', art).value = h.foto || '';
  const area = $('textarea', art);
  const previa = $('.config-previa', art);
  const original = area.value;
  previaQuartos(area.value, previa);
  area.addEventListener('input', () => previaQuartos(area.value, previa));
  const redesenhar = () => {
    const novo = fonte.estado().hoteis.find((x) => x.id === h.id);
    if (novo) art.replaceWith(blocoHotel(novo, fonte.estado())); else art.remove();
  };
  $('[data-acao="salvar"]', art).addEventListener('click', async () => {
    const nome = $('input[name="nome"]', art).value.trim();
    if (!nome) { avisar('O hotel precisa de um nome.'); return; }
    const r = previaQuartos(area.value, previa);
    if (r.erros.length) { avisar('Corrija a lista de quartos antes de salvar.'); return; }
    const saem = area.value !== original ? numeros.filter((n) => !r.quartos.includes(n)) : [];
    if (saem.length) {
      const ok = await confirmar({
        titulo: `Tirar ${plural(saem.length, nomes ? 'nome' : 'quarto', nomes ? 'nomes' : 'quartos')} do ${nomeCompleto(h)}?`,
        texto: `${saem.length <= 12 ? `Saem da roleta: ${saem.join(', ')}.` : `Saem da roleta ${saem.length} itens da lista atual.`} Quarto já sorteado nunca sai.`,
        botao: 'Salvar e tirar',
      });
      if (!ok) { focarDepoisDeCancelar(); return; }
    }
    try {
      await fonte.salvarHotel({
        id: h.id, nome,
        prefixo: $('input[name="prefixo"]', art).checked ? 'HOTEL' : '',
        foto: $('select[name="foto"]', art).value || null,
        ordem: Number($('input[name="ordem"]', art).value) || 0,
      });
      let msg = `${nome} salvo.`;
      if (area.value !== original) {
        const out = await fonte.definirQuartos(h.id, r.quartos);
        if (out && out.ok === false) { avisar('O banco não aceitou a lista. Confira os números.'); return; }
        msg = `${nome} salvo com ${plural(r.quartos.length, 'item', 'itens')} na roleta.`;
        if (out?.mantidos?.length) msg += ` Ficaram também ${out.mantidos.join(', ')}, que já foram sorteados.`;
      }
      avisar(msg, 8000);
      redesenhar();
    } catch (err) { avisar(mensagemErro(err), 8000); }
  });
  $('[data-acao="remover"]', art).addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: `Remover o ${nomeCompleto(h)}?`,
      texto: 'O hotel e a lista dele saem do sorteio. Só dá para remover hotel sem sorteio feito; o histórico fica guardado.',
      botao: 'Remover hotel',
      exigir: 'REMOVER',
    });
    if (!ok) { focarDepoisDeCancelar(); return; }
    try {
      const out = await fonte.removerHotel(h.id);
      if (out && out.ok === false) {
        avisar(out.motivo === 'tem_sorteio_valido'
          ? 'Este hotel tem sorteio feito. Resete o sorteio dele antes de remover.'
          : 'Não deu para remover este hotel.', 8000);
        return;
      }
      avisar(`${nomeCompleto(h)} removido.`);
      art.remove();
    } catch (err) { avisar(mensagemErro(err), 8000); }
  });
  return art;
}

async function adicionarHotel() {
  const e = fonte.estado();
  const ordem = Math.max(0, ...e.hoteis.map((h) => Number(h.ordem) || 0)) + 1;
  try {
    const out = await fonte.salvarHotel({ id: null, nome: 'Novo hotel', prefixo: 'HOTEL', foto: null, ordem });
    const novo = fonte.estado().hoteis.find((h) => h.id === out?.hotel?.id);
    if (novo) {
      const bloco = blocoHotel(novo, fonte.estado());
      $('#config-hoteis').append(bloco);
      bloco.scrollIntoView({ behavior: semMovimento() ? 'auto' : 'smooth', block: 'center' });
      $('input[name="nome"]', bloco).select();
    } else {
      renderConfig();
    }
    avisar('Hotel novo criado no fim da lista. Troque o nome, cole os quartos e salve.');
  } catch (err) { avisar(mensagemErro(err), 8000); }
}

async function sair() {
  if (fonte?.pendentes()) {
    avisar('Ainda há sorteios guardados neste aparelho esperando a internet. Saia depois que forem enviados.', 9000);
    return;
  }
  const ok = await confirmar({
    titulo: 'Sair deste aparelho?',
    texto: 'O código do evento e a cópia dos sorteios guardada aqui são apagados deste aparelho. Os sorteios continuam no banco.',
    botao: 'Sair',
  });
  if (!ok) { focarDepoisDeCancelar(); return; }
  for (const k of CHAVES_LOCAIS) armazem.apagar(k);
  esquecerCodigo('');
}

// ------------------------------------------------------------------ eventos
function ligarEventos() {
  // elementos novos podem faltar num index.html antigo guardado no aparelho: liga só o que existir
  const ligar = (sel, tipo, fn) => { const el = $(sel); if (el) el.addEventListener(tipo, fn); };
  window.addEventListener('hashchange', rotear);
  $('#form-entrada').addEventListener('submit', entrar);
  $('#botao-girar').addEventListener('click', girar);
  $('#proximo').addEventListener('click', irAdiante);
  $('#resetar-hotel').addEventListener('click', resetarRoleta);
  ligar('#ausente', 'click', marcarAusente);
  $('#som-giro').addEventListener('click', trocarSom);
  $('#tela-cheia').addEventListener('click', telaCheia);
  $('.telao-voltar').addEventListener('click', (ev) => { if (fase === 'girando') { ev.preventDefault(); avisar('Espere a roleta parar.'); } });
  $('#baixar').addEventListener('click', extrairGanhadores);
  ligar('#extrair-hoteis', 'click', extrairGanhadores);
  ligar('#resetar-tudo-hoteis', 'click', resetarTudo);
  $('#imprimir').addEventListener('click', () => window.print());
  $('#resetar-tudo').addEventListener('click', resetarTudo);
  $('#mostrar-desfeitos').addEventListener('change', (ev) => { mostrarDesfeitos = ev.target.checked; renderResultados(); });
  $('#adicionar-hotel').addEventListener('click', adicionarHotel);
  $('#pref-duracao').addEventListener('change', (ev) => { prefs.duracao = Number(ev.target.value); salvarPrefs(); avisar('Duração do giro salva neste aparelho.'); });
  $('#pref-som').addEventListener('change', (ev) => { prefs.som = ev.target.checked; salvarPrefs(); });
  $('#pref-som-giro').addEventListener('change', (ev) => { prefs.somGiro = ev.target.value; salvarPrefs(); atualizarBotaoSom(); });
  $('#sair').addEventListener('click', sair);

  document.addEventListener('keydown', (ev) => {
    if (tela !== 'roleta' || $('#dialogo').open) return;
    const emCampo = ev.target.matches('input, textarea, select');
    // Espaço gira. Só Girar e Próximo ficam com o Espaço do navegador: com o foco em Tela cheia, Som,
    // Ausente ou Resetar, o Espaço não aciona esses botões
    if (ev.key === ' ' && !emCampo && !ev.target.matches('#botao-girar, #proximo')) {
      ev.preventDefault();
      if (fase === 'pronto' && !vencedorDe(hotelId)) girar();
    } else if (ev.key === 'Escape' && fase !== 'girando' && !emCampo) {
      location.hash = '#/hoteis';
    } else if ((ev.key === 'f' || ev.key === 'F') && !emCampo && !ev.ctrlKey && !ev.metaKey) {
      telaCheia();
    }
  });

  window.addEventListener('online', () => { if (fonte?.modo === 'remoto') fonte.enviarFila().then(atualizarEstadoBanco); });
  window.addEventListener('offline', atualizarEstadoBanco);

  // reenvio da fila e leitura do que outros aparelhos sortearam
  setInterval(async () => {
    if (!fonte || fonte.modo !== 'remoto' || !fonte.pendentes()) return;
    const out = await fonte.enviarFila();
    conexao = out.situacao === 'em_dia' ? 'ok' : 'sem_conexao';
    if (out.situacao === 'codigo_invalido') avisar('O banco recusou o código do evento. Entre de novo com o código.', 9000);
    atualizarEstadoBanco();
  }, 5000);
  setInterval(async () => {
    if (!fonte || fonte.modo !== 'remoto' || fase === 'girando' || document.hidden) return;
    if (tela === 'configurar' || tela === 'entrada') return;
    try { await fonte.carregar(); conexao = 'ok'; } catch (e) {
      conexao = 'sem_conexao';
      if (e instanceof ErroCodigo) esquecerCodigo('O código do evento mudou. Digite o código novo.');
    }
    atualizarEstadoBanco();
  }, 20000);
}

// leitura para o teste de ponta a ponta conferir onde a roda parou (só estado da tela)
window.__sorteio = {
  get roleta() { return roleta; },
  get fase() { return fase; },
  get resultado() { return resultado; },
  get pendentes() { return fonte ? fonte.pendentes() : 0; },
  get ausentes() { return fonte ? fonte.estado().sorteios.filter(ehAusente).map((s) => s.numero) : []; },
  get tambor() { return { tocando: tambor.tocando, carregado: !!tambor.buffers }; },
  get musica() {
    const a = musica.audio;
    return { tocando: !!(a && !a.paused), tempo: a ? a.currentTime : 0 };
  },
};

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
