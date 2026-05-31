'use strict';
/* ============================================================
   SERVICE WORKER — Caixa 5X PWA
   v3 — network-first para JS/HTML/CSS, garante sempre código atualizado.
   NÃO cacheia Supabase, Auth, APIs ou dados financeiros.
============================================================ */

const CACHE_VERSION = 'caixa5x-v3';

/* Arquivos de shell (ícones, manifesto) — raramente mudam */
const SHELL_FILES = [
  '/assets/favicon.png',
  '/assets/favicon.svg',
  '/assets/logo-gestao5x-transparente.png',
  '/assets/icons/icon.svg',
  '/manifest.json',
];

/* --- INSTALL: pré-cacheia apenas o shell estático --- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(SHELL_FILES.map((url) => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

/* --- ACTIVATE: remove TODOS os caches antigos --- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* --- FETCH: network-first para tudo da mesma origem ---
   JS, HTML, CSS sempre vêm da rede para garantir código atualizado.
   Fallback para cache apenas quando offline. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* Ignora cross-origin (Supabase, CDN, Auth) */
  if (url.origin !== self.location.origin) return;

  /* Ignora POST/PUT/DELETE */
  if (request.method !== 'GET') return;

  /* Ignora o próprio SW */
  if (url.pathname === '/service-worker.js') return;

  /* Network-first: tenta rede, usa cache apenas se offline */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          /* Atualiza cache com versão mais recente */
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
