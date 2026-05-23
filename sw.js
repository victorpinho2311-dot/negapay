// ============================================================
//  NegaPay — Service Worker
//  Cache básico para funcionamento offline da interface
// ============================================================

const CACHE_NAME = 'negapay-v2';

const ARQUIVOS_CACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/auth.js',
  '/js/pdf-parser.js',
  '/js/admin.js',
  '/js/primo.js',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/bradesco-logo.png',
  '/assets/bradesco-card.png'
];

// ── Instala e cacheia arquivos estáticos ─────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ARQUIVOS_CACHE.filter(url => {
        // Não falha se assets ainda não existem
        return !url.includes('/assets/bradesco');
      }));
    })
  );
  self.skipWaiting();
});

// ── Ativa e remove caches antigos ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Estratégia: Network First para API, Cache First para estáticos ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requisições para o Apps Script: sempre rede (sem cache)
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CDN (PDF.js): cache first
  if (url.hostname.includes('cloudflare') || url.hostname.includes('cdnjs')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Arquivos locais: network first, fallback cache
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});