'use strict';
/* ============================================================
   SERVICE WORKER — Caixa 5X PWA
   Estratégia: cache-first para arquivos estáticos.
   NUNCA cacheia: Supabase, Auth, Edge Functions, API ou dados financeiros.
   Apenas arquivos estáticos da mesma origem são cacheados.
============================================================ */

const CACHE_NAME = 'caixa5x-static-v1';

/* Lista de arquivos estáticos a pré-cachear na instalação */
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/style.css',
  '/src/utils.js',
  '/src/supabaseClient.js',
  '/src/auth.js',
  '/src/permissions.js',
  '/src/db.js',
  '/src/closing.js',
  '/src/reports.js',
  '/src/render.js',
  '/src/app.js',
  '/assets/favicon.png',
  '/assets/favicon.svg',
  '/assets/logo-gestao5x-transparente.png',
  '/assets/icons/icon.svg',
];

/* --- INSTALL: pré-cacheia arquivos estáticos --- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      /* allSettled: não falha se algum arquivo estiver indisponível */
      await Promise.allSettled(
        STATIC_FILES.map((url) => cache.add(url).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

/* --- ACTIVATE: remove caches de versões anteriores --- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/* --- FETCH: cache-first para estáticos, rede para todo o resto --- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* ✗ Nunca intercepta requisições cross-origin
     (Supabase API, CDN do Supabase JS, Edge Functions, Auth) */
  if (url.origin !== self.location.origin) return;

  /* ✗ Nunca intercepta métodos que alteram dados (POST, PUT, DELETE, PATCH) */
  if (request.method !== 'GET') return;

  /* ✗ Nunca cacheia o próprio service worker */
  if (url.pathname === '/service-worker.js') return;

  /* ✓ Cache-first para arquivos estáticos da mesma origem */
  event.respondWith(
    caches.match(request).then((cached) => {
      /* Cache hit: retorna imediatamente */
      if (cached) return cached;

      /* Cache miss: busca da rede e armazena para próxima vez */
      return fetch(request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === 'basic'
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          /* Offline e sem cache: retorna fallback para navegação */
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
