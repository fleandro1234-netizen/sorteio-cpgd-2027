// Telas do sorteio dos quartos do 29º CPGD.
import {
  FonteRemota, FonteDemo, ArmazemLocal, ErroCodigo, ErroRede, CHAVES_LOCAIS,
  livresDoHotel, quartosDoHotel, sorteiosDoHotel, contagens,
} from './dados.js';
import {
  normalizarCodigo, interpretarListaQuartos, descreverLista, sortearIndice, sortearDesvio,
  gerarCsv, formatarHora, formatarDataHora, novoId, ehListaDeNomes,
} from './nucleo.js';
import { Roleta, criarTique } from './roleta.js';
import { Musica, tocarSino } from './musica.js';

const SUPABASE_URL = 'https://hfwrzhugtochmoukmbpr.supabase.co';
const SUPABASE_CHAVE = 'sb_publishable_tPlmP6NE4PTDFNzTDBKQ9g_9QZA6v2I';
const CH_CODIGO = 'cpgd29:codigo';
const CH_PREFS = 'cpgd29:prefs';
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

const armazem = new ArmazemLocal();
const tique = criarTique();
const musica = new Musica('audio/suspense.mp3');
const logoCasal = new Image();
logoCasal.src = 'img/logo-casal.png';

let fonte = null;
let prefs = { duracao: 9, som: false, musica: true };
let tela = null;
let roleta = null;
let hotelId = null;
let fase = 'pronto';            // pronto | girando | resultado
let resultado = null;           // { quarto, casal, cliente_id, envio, nomes }
let idsNaRoda = '';
let conexao = 'ok';             // ok | sem_conexao
let filtroHotel = 'todos';
let mostrarDesfeitos = false;
let outraAba = false;

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
    [8, 'Sorteio bônus', '', null, 'Monte Real, Panorama, Grande Hotel Glória, Recanto Bela Vista, Guarany, Fredy, Majestic'],
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

// ------------------------------------------------------------------ utilidades de tela
function prefixoVisivel(h) {
  if (!h || !h.prefixo) return '';
  return h.nome.trim().toLowerCase().startsWith(h.prefixo.trim().toLowerCase()) ? '' : h.prefixo;
}

function nomeCompleto(h) {
  if (!h) return '';
  const p = prefixoVisivel(h);
  return p ? `${p.charAt(0)}${p.slice(1).toLowerCase()} ${h.nome}` : h.nome;
}

function hotelAtual() {
  return fonte?.estado().hoteis.find((h) => h.id === hotelId) || null;
}

// Três tipos de roleta: quartos (número), nomes de casais (hotel que só mandou nomes) e hotéis
// (sorteio bônus: os itens são os nomes dos outros hotéis).
const TEXTOS = {
  quartos: { rotulo: 'Quarto', um: 'quarto', varios: 'quartos', todos: 'Todos os quartos deste hotel já foram sorteados.' },
  nomes: { rotulo: 'Casal sorteado', um: 'casal', varios: 'casais', todos: 'Todos os casais deste hotel já foram sorteados.' },
  hoteis: { rotulo: 'Hotel sorteado', um: 'hotel', varios: 'hotéis', todos: 'Todos os hotéis já saíram neste sorteio bônus.' },
};

function tipoRoleta(id, e = fonte.estado()) {
  const itens = quartosDoHotel(e, id).map((q) => String(q.numero).trim().toLowerCase());
  if (!itens.length) return 'quartos';
  const outros = new Set(e.hoteis.filter((h) => h.id !== id).map((h) => h.nome.trim().toLowerCase()));
  if (itens.every((t) => outros.has(t))) return 'hoteis';
  return ehListaDeNomes(itens) ? 'nomes' : 'quartos';
}

function modoNomes(id, e = fonte.estado()) {
  return tipoRoleta(id, e) !== 'quartos';
}

function hotelPeloNome(nome, e = fonte.estado()) {
  const alvo = String(nome).trim().toLowerCase();
  return e.hoteis.find((h) => h.nome.trim().toLowerCase() === alvo) || null;
}

// "o quarto 214" ou "Alemar e Claudia"
function rotuloItem(numero, nomes) {
  return nomes ? numero : `o quarto ${numero}`;
}

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
    prefs.musica = p.musica !== false;
  } catch { /* fica o padrão */ }
}
function salvarPrefs() { armazem.gravar(CH_PREFS, JSON.stringify(prefs)); }

// diálogo de confirmação (também serve para pedir um texto)
function confirmar({ titulo, texto, botao = 'Confirmar', exigir = null, campo = null, valor = '' }) {
  const d = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-texto').textContent = texto || '';
  $('#dialogo-texto').hidden = !texto;
  const ok = $('#dialogo-ok');
  ok.textContent = botao;
  const rotulo = $('#dialogo-rotulo');
  const input = $('#dialogo-campo');
  rotulo.hidden = !(exigir || campo);
  $('#dialogo-campo-texto').textContent = exigir ? `Digite ${exigir}` : (campo || '');
  input.value = exigir ? '' : valor;
  const conferir = () => { ok.disabled = !!exigir && input.value.trim().toUpperCase() !== exigir; };
  input.oninput = conferir;
  conferir();
  return new Promise((resolve) => {
    d.onclose = () => {
      const sim = d.returnValue === 'ok';
      resolve(campo ? (sim ? input.value : null) : sim);
    };
    d.returnValue = '';
    d.showModal();
    setTimeout(() => ((exigir || campo) ? input : ok).focus(), 30);
  });
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
  if (!fonte) { mostrarEntrada(); return; }
  // durante o giro a tela fica na roleta: trocar de hotel no meio misturava a roda de um com o nome de outro
  if (fase === 'girando' && tela === 'roleta' && hotelId != null) {
    const aqui = `#/roleta/${hotelId}`;
    if (location.hash !== aqui) {
      history.replaceState(null, '', aqui);
      avisar('Espere a roleta parar.');
    }
    return;
  }
  const h = location.hash || '#/hoteis';
  const m = h.match(/^#\/roleta\/(\d+)$/);
  if (m) mostrarRoleta(Number(m[1]));
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

function aoMudarDados() {
  atualizarEstadoBanco();
  if (tela === 'hoteis') renderHoteis();
  else if (tela === 'resultados') renderResultados();
  else if (tela === 'roleta') {
    if (fase === 'pronto') {
      const ids = livresDoHotel(fonte.estado(), hotelId).map((q) => q.id).join(',');
      if (ids !== idsNaRoda) montarRoda();
    }
    if (fase === 'resultado' && resultado) {
      // o sorteio que estava guardado no aparelho chegou ao banco: o aviso acompanha
      const s = fonte.estado().sorteios.find((x) => x.cliente_id === resultado.cliente_id);
      if (s && !s.pendente && !s.anulado_em && resultado.envio === 'pendente') { resultado.envio = 'gravado'; mostrarEnvio(); }
    }
    atualizarPainelRoleta();
  }
}

function aoConflito(c) {
  const quem = c.existente?.casal ? ` para ${c.existente.casal}` : '';
  const msg = c.motivo === 'quarto_ja_sorteado'
    ? `O quarto ${c.numero} já tinha sido sorteado em outro aparelho${quem}. A roleta foi atualizada; gire de novo.`
    : `O quarto ${c.numero} saiu da lista deste hotel e o sorteio dele não foi gravado. Gire de novo.`;
  const eAtual = resultado && resultado.cliente_id === c.cliente_id;
  if (eAtual) {
    resultado.envio = 'conflito';
    resultado.mensagem = msg;
    if (fase === 'resultado') mostrarEnvio();
  }
  // enquanto a roda gira o aviso espera, para não entregar nada antes da hora
  if (!(eAtual && fase === 'girando')) avisar(msg, 9000);
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
  let total = 0;
  let feitos = 0;
  for (const h of e.hoteis) {
    const c = cont.get(h.id) || { total: 0, sorteados: 0 };
    const tipo = tipoRoleta(h.id, e);
    const tx = TEXTOS[tipo];
    if (tipo !== 'hoteis') { total += c.total; feitos += c.sorteados; }
    const a = document.createElement('a');
    a.className = tipo === 'hoteis' ? 'cartao-hotel cartao-bonus' : 'cartao-hotel';
    a.href = `#/roleta/${h.id}`;
    const pre = prefixoVisivel(h);
    const foto = h.foto
      ? `<img src="img/hoteis/${encodeURIComponent(h.foto)}.jpg" alt="Fachada do ${esc(nomeCompleto(h))}" loading="lazy">`
      : (tipo === 'hoteis' ? '<span class="cartao-sem-foto bonus-fundo"><img src="img/logo-casal.png" alt=""></span>' : '<span class="cartao-sem-foto"></span>');
    const conta = !c.total ? 'Nenhum quarto cadastrado ainda'
      : (tipo === 'hoteis' ? `Entre ${plural(c.total, 'hotel', 'hotéis')}, ${c.sorteados ? plural(c.sorteados, 'já sorteado', 'já sorteados') : 'nenhum sorteado ainda'}`
        : `${c.sorteados} de ${c.total} ${c.total === 1 ? `${tx.um} sorteado` : `${tx.varios} sorteados`}`);
    a.innerHTML = `
      <figure class="cartao-foto">${foto}</figure>
      <div class="cartao-linha">${pre ? `<span class="cartao-prefixo">${esc(pre)}</span>` : ''}<span class="cartao-nome">${esc(h.nome)}</span></div>
      <p class="cartao-conta">${conta}</p>
      <div class="cartao-barra" aria-hidden="true"><span></span></div>`;
    a.querySelector('.cartao-barra span').style.width = c.total ? `${(100 * c.sorteados) / c.total}%` : '0%';
    frag.append(a);
  }
  const resumo = document.createElement('a');
  resumo.className = 'cartao-resumo';
  resumo.href = '#/resultados';
  resumo.innerHTML = `
    <span class="resumo-rotulo">Até agora</span>
    <span class="resumo-numero">${feitos}</span>
    <span class="resumo-texto">de ${total} sorteados</span>
    <span class="resumo-link">Ver os resultados</span>`;
  frag.append(resumo);
  $('#grade-hoteis').replaceChildren(frag);
  $('#hoteis-vazio').hidden = e.hoteis.length > 0;
}

// ------------------------------------------------------------------ roleta
function mostrarRoleta(id) {
  const h = fonte.estado().hoteis.find((x) => x.id === id);
  if (!h) { location.hash = '#/hoteis'; return; }
  ativarTela('roleta');
  if (!roleta) roleta = new Roleta($('#roleta'), { logo: logoCasal });
  roleta.som = prefs.som ? tique : null;
  if (prefs.musica) musica.preparar();
  // fora do giro, entrar na roleta é sempre começar do zero (resultado antigo não volta)
  if (!(fase === 'girando' && hotelId === id)) {
    hotelId = id;
    fase = 'pronto';
    resultado = null;
    $('#casal').value = '';
    montarRoda();
  }
  const pre = prefixoVisivel(h);
  $('#painel-prefixo').textContent = pre;
  $('#painel-prefixo').hidden = !pre;
  $('#painel-nome').textContent = h.nome;
  atualizarPainelRoleta();
  atualizarBotoesAudio();
  if (fase === 'pronto') setTimeout(() => $('#botao-girar').focus({ preventScroll: true }), 80);
}

function montarRoda() {
  const livres = livresDoHotel(fonte.estado(), hotelId);
  idsNaRoda = livres.map((q) => q.id).join(',');
  roleta.definirQuartos(livres);
  roleta.hotelId = hotelId;
}

function atualizarPainelRoleta() {
  if (hotelId == null || !fonte) return;
  const e = fonte.estado();
  const tipo = tipoRoleta(hotelId, e);
  const tx = TEXTOS[tipo];
  const nomes = tipo !== 'quartos';
  const todos = quartosDoHotel(e, hotelId);
  let feitos = sorteiosDoHotel(e, hotelId);
  // enquanto gira, o sorteado ainda não aparece em lugar nenhum (nada de spoiler)
  const escondido = fase === 'girando' && resultado ? resultado.cliente_id : null;
  if (escondido) feitos = feitos.filter((s) => s.cliente_id !== escondido);
  const naRoda = fase === 'pronto' ? livresDoHotel(e, hotelId).length : (roleta ? roleta.quartos.length : 0);
  const telaRoleta = $('#tela-roleta');
  telaRoleta.dataset.fase = fase;
  telaRoleta.dataset.nomes = String(nomes);
  const conta = $('#painel-conta');
  if (!todos.length) {
    conta.textContent = 'Este hotel ainda não tem quartos cadastrados.';
  } else {
    const unidade = `${naRoda === 1 ? tx.um : tx.varios} na roleta`;
    conta.innerHTML = `<strong>${naRoda}</strong> ${unidade}<span class="conta-sep"></span>${plural(feitos.length, 'já sorteado', 'já sorteados')}`;
  }
  $('#bloco-pronto').hidden = fase === 'resultado';
  $('#bloco-resultado').hidden = fase !== 'resultado';
  const semQuartos = !roleta || roleta.quartos.length === 0;
  const girarBt = $('#botao-girar');
  girarBt.disabled = fase !== 'pronto' || semQuartos;
  const demo = fonte.modo === 'demo' ? ' (demonstração)' : '';
  girarBt.textContent = fase === 'girando' ? 'Girando...' : `Girar a roleta${demo}`;
  $('#casal').disabled = fase !== 'pronto' || semQuartos;
  const vazia = $('#roleta-vazia');
  vazia.hidden = !(fase === 'pronto' && semQuartos);
  vazia.textContent = todos.length ? tx.todos : 'Cadastre os quartos deste hotel em Configurar.';
  const voltar = $('.telao-voltar');
  voltar.classList.toggle('travado', fase === 'girando');
  voltar.setAttribute('aria-disabled', String(fase === 'girando'));
  const lista = $('#ultimos');
  lista.replaceChildren(...feitos.slice(0, 5).map((s) => {
    const li = document.createElement('li');
    const hora = `${esc(formatarHora(s.sorteado_em))}${s.pendente ? ', no aparelho' : ''}`;
    if (nomes) {
      li.className = 'li-nome';
      li.innerHTML = `<span class="ultimo-nome">${esc(s.numero)}</span><span class="ultimo-hora">${hora}</span>`;
    } else {
      li.innerHTML = `<span class="ultimo-numero">${esc(s.numero)}</span><span class="ultimo-casal">${esc(s.casal || '')}</span><span class="ultimo-hora">${hora}</span>`;
    }
    return li;
  }));
  $('#ultimos-titulo').hidden = feitos.length === 0;
  $('#desfazer').disabled = fase === 'girando' || feitos.length === 0;
  $('#resetar-hotel').disabled = fase === 'girando' || feitos.length === 0;
}

async function girar() {
  if (fase !== 'pronto' || !roleta || roleta.giro) return;
  if (roleta.hotelId !== hotelId) { montarRoda(); return; }
  const lista = roleta.quartos;
  if (!lista.length) return;
  const tipo = tipoRoleta(hotelId);
  const nomes = tipo !== 'quartos';
  const alvo = sortearIndice(lista.length);
  const quarto = lista[alvo];
  const casal = nomes ? '' : $('#casal').value.trim();
  const cliente_id = novoId();
  resultado = { quarto, casal, cliente_id, envio: 'enviando', nomes, tipo };
  fase = 'girando';
  roleta.som = prefs.som ? tique : null;
  atualizarPainelRoleta();
  if (prefs.musica) musica.tocar();
  // grava já no clique: o giro é a revelação de um sorteio que já aconteceu
  fonte.registrar({ hotel_id: hotelId, quarto_id: quarto.id, numero: quarto.numero, casal, cliente_id })
    .then((r) => {
      if (resultado?.cliente_id === cliente_id && resultado.envio !== 'conflito') { resultado.envio = r.envio; if (fase === 'resultado') mostrarEnvio(); }
      atualizarEstadoBanco();
    })
    .catch(() => { if (resultado?.cliente_id === cliente_id) { resultado.envio = 'pendente'; if (fase === 'resultado') mostrarEnvio(); } });
  const parada = await roleta.girar(alvo, { duracao: prefs.duracao, desvio: sortearDesvio() });
  musica.parar();
  if (parada.indice !== alvo) console.error('A roleta parou fora do sorteado', parada, alvo);
  if (resultado?.cliente_id !== cliente_id) return;
  if (resultado.envio === 'conflito') {
    // outro aparelho já tinha levado este quarto: não anuncia, avisa e volta a roleta atualizada
    const msg = resultado.mensagem || 'Este quarto já tinha sido sorteado em outro aparelho. Gire de novo.';
    fase = 'pronto';
    resultado = null;
    montarRoda();
    atualizarPainelRoleta();
    avisar(msg, 9000);
    return;
  }
  if (prefs.musica) tocarSino();
  fase = 'resultado';
  mostrarResultado();
}

function mostrarResultado() {
  const nomes = resultado.nomes;
  $('#resultado-rotulo').textContent = TEXTOS[resultado.tipo || 'quartos'].rotulo;
  // bônus: o hotel sorteado ganha um atalho para sortear o quarto dele
  const destino = resultado.tipo === 'hoteis' ? hotelPeloNome(resultado.quarto.numero) : null;
  const abrir = $('#abrir-hotel');
  abrir.hidden = !destino;
  if (destino) { abrir.textContent = `Sortear o quarto no ${nomeCompleto(destino)}`; abrir.dataset.hotel = String(destino.id); }
  const num = $('#resultado-numero');
  num.textContent = resultado.quarto.numero;
  num.classList.toggle('numero-longo', !nomes && String(resultado.quarto.numero).length > 4);
  num.classList.toggle('numero-nome', nomes);
  $('#resultado-casal').textContent = resultado.casal || '';
  $('#resultado-casal').hidden = nomes || !resultado.casal;
  const corrigir = $('#corrigir-casal');
  corrigir.hidden = nomes;
  corrigir.textContent = resultado.casal ? 'Corrigir o nome do casal' : 'Escrever o nome do casal';
  // acabou a roleta deste hotel: o botão leva de volta aos hotéis
  const acabou = livresDoHotel(fonte.estado(), hotelId).length === 0;
  $('#proximo').textContent = acabou ? 'Voltar aos hotéis' : 'Próximo sorteio';
  $('#proximo').dataset.acao = acabou ? 'hoteis' : 'proximo';
  mostrarEnvio();
  atualizarPainelRoleta();
  soltarLuzes();
  setTimeout(() => $('#proximo').focus({ preventScroll: true }), 60);
}

function mostrarEnvio() {
  if (!resultado) return;
  const textos = {
    enviando: 'Gravando no banco...',
    gravado: 'Gravado no banco',
    pendente: 'Sem internet: guardado neste aparelho, envio automático',
    conflito: 'Este quarto já tinha sido sorteado em outro aparelho. Gire de novo.',
    codigo_invalido: 'O banco recusou o código do evento. Entre de novo com o código.',
    demonstracao: 'Demonstração: nada foi gravado',
  };
  const el = $('#resultado-envio');
  el.textContent = textos[resultado.envio] || '';
  el.dataset.estado = resultado.envio;
}

function proximo() {
  if (fase !== 'resultado') return;
  const irHoteis = $('#proximo').dataset.acao === 'hoteis';
  fase = 'pronto';
  resultado = null;
  $('#casal').value = '';
  if (irHoteis) { location.hash = '#/hoteis'; return; }
  montarRoda();
  atualizarPainelRoleta();
  setTimeout(() => $('#botao-girar').focus({ preventScroll: true }), 30);
}

async function corrigirCasal() {
  if (!resultado || resultado.nomes) return;
  const novo = await confirmar({
    titulo: `Casal do quarto ${resultado.quarto.numero}`,
    texto: '', campo: 'Nome do casal', valor: resultado.casal, botao: 'Salvar o nome',
  });
  if (novo == null) return;
  resultado.casal = novo.trim();
  $('#resultado-casal').textContent = resultado.casal;
  $('#resultado-casal').hidden = !resultado.casal;
  $('#corrigir-casal').textContent = resultado.casal ? 'Corrigir o nome do casal' : 'Escrever o nome do casal';
  const r = await fonte.atualizarCasal(resultado.cliente_id, resultado.casal);
  if (r.envio === 'pendente') avisar('Nome guardado neste aparelho; vai para o banco quando a internet voltar.');
  atualizarPainelRoleta();
}

async function desfazer() {
  const ultimo = sorteiosDoHotel(fonte.estado(), hotelId)[0];
  if (!ultimo || fase === 'girando') return;
  const nomes = modoNomes(hotelId);
  const item = rotuloItem(ultimo.numero, nomes);
  const ok = await confirmar({
    titulo: 'Desfazer o último sorteio?',
    texto: `${item.charAt(0).toUpperCase()}${item.slice(1)}${ultimo.casal ? ` (${ultimo.casal})` : ''} volta para a roleta. O registro fica guardado como desfeito.`,
    botao: 'Desfazer',
  });
  if (!ok) return;
  await fonte.anular(ultimo.cliente_id, 'desfeito');
  avisar(`${item.charAt(0).toUpperCase()}${item.slice(1)} voltou para a roleta.`);
  fase = 'pronto';
  resultado = null;
  montarRoda();
  atualizarPainelRoleta();
}

async function resetarHotel() {
  const h = hotelAtual();
  const n = sorteiosDoHotel(fonte.estado(), hotelId).length;
  if (!h || !n || fase === 'girando') return;
  const nomes = modoNomes(hotelId);
  const coisa = nomes ? ['O casal sorteado volta', `Os ${n} casais sorteados voltam`] : ['O quarto sorteado volta', `Os ${n} quartos sorteados voltam`];
  const ok = await confirmar({
    titulo: `Resetar o sorteio do ${nomeCompleto(h)}?`,
    texto: `${n === 1 ? coisa[0] : coisa[1]} para a roleta deste hotel. O histórico fica guardado. Os outros hotéis não mudam.`,
    botao: 'Resetar este hotel',
  });
  if (!ok) return;
  try {
    const r = await fonte.resetar(hotelId);
    avisar(`Sorteio do ${nomeCompleto(h)} resetado: ${plural(r.anulados, 'sorteio voltou', 'sorteios voltaram')} para a roleta.`);
    fase = 'pronto';
    resultado = null;
    montarRoda();
    atualizarPainelRoleta();
  } catch (e) {
    avisar(mensagemErro(e), 8000);
  }
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

function atualizarBotoesAudio() {
  const b = $('#musica');
  b.textContent = prefs.musica ? 'Música: ligada' : 'Música: desligada';
  b.setAttribute('aria-pressed', String(prefs.musica));
}

function alternarMusica() {
  prefs.musica = !prefs.musica;
  salvarPrefs();
  atualizarBotoesAudio();
  if (prefs.musica) musica.preparar(); else musica.parar(200);
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
  if (s.anulado_em) return s.motivo_anulacao === 'reset' ? 'Resetado' : 'Desfeito';
  return s.pendente ? 'Guardado no aparelho' : 'Sorteado';
}

function linhasResultado(e, filtro, comDesfeitos) {
  const ordemHotel = new Map(e.hoteis.map((h, i) => [h.id, i]));
  const nomes = new Map(e.hoteis.map((h) => [h.id, nomeCompleto(h)]));
  return e.sorteios
    .filter((s) => (filtro === 'todos' || s.hotel_id === filtro) && (comDesfeitos || !s.anulado_em))
    .sort((a, b) => ((ordemHotel.get(a.hotel_id) ?? 99) - (ordemHotel.get(b.hotel_id) ?? 99))
      || String(a.sorteado_em).localeCompare(String(b.sorteado_em)))
    .map((s) => ({ s, hotel: nomes.get(s.hotel_id) || 'Hotel removido' }));
}

function renderResultados() {
  const e = fonte.estado();
  if (filtroHotel !== 'todos' && !e.hoteis.some((h) => h.id === filtroHotel)) filtroHotel = 'todos';
  const filtros = [{ id: 'todos', nome: 'Todos os hotéis' }, ...e.hoteis.map((h) => ({ id: h.id, nome: h.nome }))];
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
  const corpo = $('#tabela-corpo');
  corpo.replaceChildren(...linhas.map(({ s, hotel }) => {
    const tr = document.createElement('tr');
    if (s.anulado_em) tr.className = 'desfeito';
    tr.innerHTML = `<td>${esc(hotel)}</td><td class="col-quarto">${esc(s.numero)}</td><td>${esc(s.casal || '')}</td><td class="col-hora">${esc(formatarDataHora(s.sorteado_em))}</td><td class="col-situacao">${esc(situacaoDe(s))}</td>`;
    return tr;
  }));
  const validos = e.sorteios.filter((s) => !s.anulado_em).length;
  const total = e.quartos.length;
  $('#resultados-resumo').textContent = `${validos} de ${total} sorteados em ${plural(e.hoteis.length, 'hotel', 'hotéis')}.`;
  $('#resultados-vazio').hidden = linhas.length > 0;
  $('#resetar-tudo').disabled = validos === 0;
}

function baixarPlanilha() {
  const e = fonte.estado();
  const linhas = linhasResultado(e, filtroHotel, mostrarDesfeitos);
  const tabela = [['Hotel', 'Sorteado', 'Casal', 'Data e hora', 'Situação'],
    ...linhas.map(({ s, hotel }) => [hotel, s.numero, s.casal || '', formatarDataHora(s.sorteado_em), situacaoDe(s)])];
  const blob = new Blob([gerarCsv(tabela)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const hoje = new Date();
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `sorteio-quartos-29-cpgd-${dia}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function resetarTudo() {
  const validos = fonte.estado().sorteios.filter((s) => !s.anulado_em).length;
  if (!validos) return;
  const ok = await confirmar({
    titulo: 'Resetar todo o sorteio?',
    texto: `${validos === 1 ? 'O sorteio feito volta' : `Os ${validos} sorteios feitos em todos os hotéis voltam`} para as roletas. O histórico fica guardado como reset.`,
    botao: 'Resetar todo o sorteio',
    exigir: 'RESETAR',
  });
  if (!ok) return;
  try {
    const r = await fonte.resetar(null);
    avisar(`Sorteio resetado: ${plural(r.anulados, 'sorteio voltou', 'sorteios voltaram')} para as roletas.`);
    renderResultados();
  } catch (e) {
    avisar(mensagemErro(e), 8000);
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
  $('#pref-musica').checked = prefs.musica;
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
    });
    if (!ok) return;
    try {
      const out = await fonte.removerHotel(h.id);
      if (out && out.ok === false) {
        avisar(out.motivo === 'tem_sorteio_valido'
          ? 'Este hotel tem sorteios feitos. Resete o sorteio dele antes de remover.'
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
  if (!ok) return;
  for (const k of CHAVES_LOCAIS) armazem.apagar(k);
  esquecerCodigo('');
}

// ------------------------------------------------------------------ eventos
function ligarEventos() {
  window.addEventListener('hashchange', rotear);
  $('#form-entrada').addEventListener('submit', entrar);
  $('#form-casal').addEventListener('submit', (ev) => { ev.preventDefault(); girar(); });
  $('#casal').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.target.blur(); $('#botao-girar').focus(); } });
  $('#proximo').addEventListener('click', proximo);
  $('#abrir-hotel').addEventListener('click', (ev) => {
    if (fase !== 'resultado') return;
    const id = ev.currentTarget.dataset.hotel;
    fase = 'pronto';
    resultado = null;
    location.hash = `#/roleta/${id}`;
  });
  $('#corrigir-casal').addEventListener('click', corrigirCasal);
  $('#desfazer').addEventListener('click', desfazer);
  $('#resetar-hotel').addEventListener('click', resetarHotel);
  $('#musica').addEventListener('click', alternarMusica);
  $('#tela-cheia').addEventListener('click', telaCheia);
  $('.telao-voltar').addEventListener('click', (ev) => { if (fase === 'girando') { ev.preventDefault(); avisar('Espere a roleta parar.'); } });
  $('#baixar').addEventListener('click', baixarPlanilha);
  $('#imprimir').addEventListener('click', () => window.print());
  $('#resetar-tudo').addEventListener('click', resetarTudo);
  $('#mostrar-desfeitos').addEventListener('change', (ev) => { mostrarDesfeitos = ev.target.checked; renderResultados(); });
  $('#adicionar-hotel').addEventListener('click', adicionarHotel);
  $('#pref-duracao').addEventListener('change', (ev) => { prefs.duracao = Number(ev.target.value); salvarPrefs(); avisar('Duração do giro salva neste aparelho.'); });
  $('#pref-som').addEventListener('change', (ev) => { prefs.som = ev.target.checked; salvarPrefs(); });
  $('#pref-musica').addEventListener('change', (ev) => { prefs.musica = ev.target.checked; salvarPrefs(); atualizarBotoesAudio(); });
  $('#sair').addEventListener('click', sair);

  document.addEventListener('keydown', (ev) => {
    if (tela !== 'roleta' || $('#dialogo').open) return;
    const emCampo = ev.target.matches('input, textarea, select');
    if (ev.key === ' ' && !emCampo && !ev.target.matches('button')) {
      ev.preventDefault();
      if (fase === 'pronto') girar(); else if (fase === 'resultado') proximo();
    } else if (ev.key === 'Enter' && !emCampo && !ev.target.matches('button, a') && fase === 'resultado') {
      ev.preventDefault();
      proximo();
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
  get musica() {
    const a = musica.audio;
    return { tocando: !!(a && !a.paused), tempo: a ? a.currentTime : 0, volume: a ? a.volume : 0, memoria: !!musica.blobUrl };
  },
};

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
