// Service worker do sorteio: a página abre mesmo se a internet do hotel cair.
// Receita medida (memória pwa-service-worker-versao-nova-na-hora): rede primeiro, sem passar pelo cache
// do navegador (fetch(req.url, {cache: 'no-cache', redirect})), prazo de 3 s lendo a resposta inteira;
// vencido o prazo ou sem rede, entrega a cópia guardada e a rede atualiza a cópia por trás.
const VERSAO = 'cpgd29-v6';
const CORE = [
  './', 'index.html', 'css/estilo.css',
  'js/app.js', 'js/dados.js', 'js/nucleo.js', 'js/roleta.js', 'js/musica.js', 'audio/suspense.mp3', 'audio/rufo.wav', 'audio/prato.wav',
  'img/fundo-campo.jpg', 'img/fundo-capa.jpg', 'img/logo-nome.png', 'img/logo-casal.png',
  'img/icone-64.png', 'img/icone-180.png',
  'img/hoteis/hotel-monte-real.jpg', 'img/hoteis/hotel-panorama.jpg', 'img/hoteis/hotel-gloria.jpg',
  'img/hoteis/hotel-bela-vista.jpg', 'img/hoteis/hotel-guarany.jpg', 'img/hoteis/hotel-fredy.jpg',
  'img/hoteis/hotel-majestic.jpg',
];
const PRAZO_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSAO)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // só as cópias antigas do próprio sorteio: os outros sites da conta dividem o mesmo endereço
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('cpgd29-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // banco (Supabase) vai direto
  if (req.destination === 'audio' || req.destination === 'video') return; // pedidos por faixa (Range) vão direto
  e.respondWith(responder(e, req));
});

function semCompressao(cab) {
  const h = new Headers(cab);
  h.delete('content-encoding');
  h.delete('content-length');
  return h;
}

async function guardar(cache, chave, r, buf) {
  if (!r.ok || r.type !== 'basic') return;
  const tipo = r.headers.get('content-type') || '';
  if (tipo.includes('text/html')) {
    const texto = new TextDecoder().decode(buf);
    if (!texto.trimEnd().endsWith('</html>')) return; // página cortada não vira cópia
  }
  await cache.put(chave, new Response(buf.slice(0), { status: r.status, statusText: r.statusText, headers: semCompressao(r.headers) }));
}

async function responder(e, req) {
  const cache = await caches.open(VERSAO);
  const navegacao = req.mode === 'navigate';
  const chave = navegacao ? new URL('index.html', self.registration.scope).href : req.url;

  const daRede = (async () => {
    const r = await fetch(req.url, { cache: 'no-cache', redirect: req.redirect });
    if (r.type === 'opaqueredirect') return { r, buf: null };
    const buf = await r.arrayBuffer(); // lê inteira: corpo travado também cai na cópia
    return { r, buf };
  })();
  daRede.catch(() => {});

  let pronto = null;
  try {
    pronto = await Promise.race([daRede, new Promise((res) => setTimeout(() => res(null), PRAZO_MS))]);
  } catch {
    pronto = null;
  }

  if (pronto) {
    const { r, buf } = pronto;
    if (buf === null) return r;
    if (!r.ok) {
      // erro rápido do servidor (500, 503): a cópia boa vale mais que a página de erro
      const boa = await cache.match(chave, { ignoreSearch: true });
      if (boa) return boa;
    }
    await guardar(cache, chave, r, buf);
    return new Response(buf, { status: r.status, statusText: r.statusText, headers: semCompressao(r.headers) });
  }

  // sem rede ou rede lenta: a cópia guardada agora; a rede, se vier, atualiza a cópia por trás
  e.waitUntil(daRede.then(({ r, buf }) => (buf ? guardar(cache, chave, r, buf) : null)).catch(() => {}));
  const copia = await cache.match(chave, { ignoreSearch: true });
  if (copia) return copia;
  const { r, buf } = await daRede;
  if (buf === null) return r;
  return new Response(buf, { status: r.status, statusText: r.statusText, headers: semCompressao(r.headers) });
}
