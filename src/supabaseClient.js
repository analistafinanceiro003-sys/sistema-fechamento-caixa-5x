'use strict';
/* ============================================================
   CLIENTE SUPABASE — Caixa 5X
   Produção: usar somente Project URL + publishable/anon key.
   Nunca usar service_role no frontend.
============================================================ */

const SUPABASE_URL = 'https://feopuubmozroxavuxcly.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8hItthnClPkhfSKMmN74SQ_qyT9T_7k';

/* Cria o cliente apenas se a lib estiver disponível */
const sb = (window.supabase?.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const STORAGE_KEY = 'caixa5x_v2';

Object.assign(window, { sb, SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_KEY });