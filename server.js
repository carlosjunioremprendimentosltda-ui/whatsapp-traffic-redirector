'use strict';

const Fastify = require('fastify');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const zeroWidth = require('./lib/zero-width');

// ==========================================
// CONFIGURAÇÃO
// ==========================================
const PORT     = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const LINKS_FILE        = path.join(DATA_DIR, 'links.json');
const SETTINGS_FILE     = path.join(DATA_DIR, 'settings.json');
const METRICS_FILE      = path.join(DATA_DIR, 'metrics.json');
const SESSIONS_FILE     = path.join(DATA_DIR, 'sessions.json');
const LEADS_FILE        = path.join(DATA_DIR, 'leads.json');
const WEBHOOK_LOGS_FILE = path.join(DATA_DIR, 'webhook_logs.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==========================================
// STORE EM MEMÓRIA (RAM) — acesso < 0.01ms
// ==========================================
let linksStore       = [];
let settingsStore    = {};
let metricsStore     = { totalRedirects: 0, todayRedirects: 0, roundRobinIndex: 0, logs: [], lastResetDate: '' };
let sessionsStore    = new Map(); // eventId → { eventId, ip, utms, clickIds, userAgent, linkName, status, createdAt }
let leadsStore       = [];        // array de leads convertidos via Kommo CRM
let webhookLogsStore = [];        // histórico de TODAS as requisições de webhook recebidas do Kommo

const tokenStore     = new Map(); // token → { expiresAt }
const rateLimitStore = new Map(); // ip    → { attempts, blockedUntil }

// ==========================================
// CARGA INICIAL DOS DADOS
// ==========================================
function loadAll() {
  try { linksStore    = JSON.parse(fs.readFileSync(LINKS_FILE,    'utf-8')); } catch (_) { linksStore = []; }
  try { settingsStore = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch (_) { settingsStore = {}; }
  try { metricsStore  = JSON.parse(fs.readFileSync(METRICS_FILE,  'utf-8')); } catch (_) {}
  if (!metricsStore.logs) metricsStore.logs = [];

  try {
    const rawSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    sessionsStore = new Map(Object.entries(rawSessions));
  } catch (_) { sessionsStore = new Map(); }

  try {
    leadsStore = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
  } catch (_) { leadsStore = []; }

  try {
    webhookLogsStore = JSON.parse(fs.readFileSync(WEBHOOK_LOGS_FILE, 'utf-8'));
  } catch (_) { webhookLogsStore = []; }
}

// ==========================================
// PERSISTÊNCIA ASSÍNCRONA (não bloqueia redirects)
// ==========================================
function saveData() {
  setImmediate(() => {
    try { fs.writeFileSync(LINKS_FILE,   JSON.stringify(linksStore,   null, 2)); } catch (_) {}
    try { fs.writeFileSync(METRICS_FILE, JSON.stringify(metricsStore, null, 2)); } catch (_) {}
  });
}

function saveWebhookLogs() {
  setImmediate(() => {
    try { fs.writeFileSync(WEBHOOK_LOGS_FILE, JSON.stringify(webhookLogsStore, null, 2)); } catch (_) {}
  });
}

function saveSettings() {
  setImmediate(() => {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsStore, null, 2)); } catch (_) {}
  });
}

function saveSessions() {
  setImmediate(() => {
    try {
      const obj = Object.fromEntries(sessionsStore.entries());
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
    } catch (_) {}
  });
}

function saveLeads() {
  setImmediate(() => {
    try {
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leadsStore, null, 2));
    } catch (_) {}
  });
}

// ==========================================
// UTILITÁRIOS
// ==========================================
function buildWhatsAppUrl(phone, message) {
  if (!phone) return '';
  let n = phone.replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n;
  const qs = new URLSearchParams({
    phone: n,
    ...(message ? { text: message } : {}),
    app_absent: '0'
  });
  return `https://api.whatsapp.com/send/?${qs.toString()}`;
}

function mergeUtms(baseUrl, query) {
  if (!baseUrl || !query || !Object.keys(query).length) return baseUrl;
  try {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const qs  = new URLSearchParams(query).toString();
    return qs ? `${baseUrl}${sep}${qs}` : baseUrl;
  }
}

function detectDevice(ua = '') {
  return {
    isIOS:         /iPhone|iPad|iPod/i.test(ua),
    isAndroid:     /Android/i.test(ua),
    isTikTok:      /musical_ly|TikTok|BytedanceWebview/i.test(ua),
    isFacebook:    /FBAN|FBAV/i.test(ua),
    isInstagram:   /Instagram/i.test(ua),
  };
}

function checkDailyReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (metricsStore.lastResetDate === today) return;
  metricsStore.todayRedirects   = 0;
  metricsStore.lastResetDate    = today;
  linksStore.forEach(l => { l.todayClicks = 0; l.lastResetDate = today; });
  saveData();
}

// Seleciona próximo link da rotação (opera sobre RAM)
function pickLink() {
  checkDailyReset();

  const available = linksStore.filter(l => {
    if (!l.active) return false;
    if (l.dailyLimit > 0 && (l.todayClicks || 0) >= l.dailyLimit) return false;
    return true;
  });

  if (!available.length) return null;

  const strategy = settingsStore.rotationStrategy || 'round-robin';

  if (strategy === 'random') {
    const total = available.reduce((s, l) => s + (Number(l.weight) || 1), 0);
    let rnd = Math.random() * total;
    for (const l of available) {
      rnd -= (Number(l.weight) || 1);
      if (rnd <= 0) return l;
    }
    return available[0];
  }

  if (strategy === 'priority') return available[0];

  // round-robin (padrão)
  const idx = (metricsStore.roundRobinIndex || 0) % available.length;
  metricsStore.roundRobinIndex = idx + 1;
  return available[idx];
}

// Registra clique, gera eventId, armazena sessão em RAM e codifica mensagem com caracteres invisíveis
function processRedirect(link, query, req) {
  const ua      = req?.headers ? (req.headers['user-agent'] || '') : '';
  const rawIp   = req?.headers ? (req.headers['x-forwarded-for'] || req.ip || '') : '';
  const ip      = rawIp.split(',')[0].trim();
  const referer = req?.headers ? (req.headers['referer'] || req.headers['referrer'] || '') : '';

  // 1. Gera eventId compacto e único (estilo Tintim)
  const eventId = 'ev_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

  // 2. Salva sessão na RAM (< 0.01ms)
  const sessionData = {
    eventId,
    createdAt: new Date().toISOString(),
    ip,
    userAgent: ua,
    referer,
    device: detectDevice(ua),
    utms: {
      source:   query.utm_source   || '',
      medium:   query.utm_medium   || '',
      campaign: query.utm_campaign || '',
      content:  query.utm_content  || '',
      term:     query.utm_term     || '',
    },
    clickIds: {
      fbclid: query.fbclid || '',
      gclid:  query.gclid  || '',
      ttclid: query.ttclid || '',
      sck:    query.sck    || '',
    },
    allParams:   query || {},
    linkId:      link?.id    || null,
    linkName:    link?.name  || 'Fallback',
    targetPhone: link?.phone || '',
    status:      'pending', // 'pending' -> 'converted' quando o webhook do Kommo confirmar
  };

  sessionsStore.set(eventId, sessionData);
  if (sessionsStore.size > 5000) {
    const oldest = sessionsStore.keys().next().value;
    sessionsStore.delete(oldest);
  }
  saveSessions();

  // 3. Monta o link do WhatsApp com os caracteres invisíveis criptografados/embutidos
  let raw = '';
  if (link) {
    if (link.phone) {
      const baseMsg = link.message || settingsStore.defaultMessage || 'Olá! Gostaria de mais informações.';
      const msgWithHiddenId = zeroWidth.injectHiddenId(baseMsg, eventId);
      raw = buildWhatsAppUrl(link.phone, msgWithHiddenId);
    } else if (link.url) {
      try {
        const u = new URL(link.url);
        if (u.hostname.includes('wa.me')) {
          const phone = u.pathname.replace(/\D/g, '');
          const currentText = u.searchParams.get('text') || settingsStore.defaultMessage || 'Olá!';
          const msgWithHiddenId = zeroWidth.injectHiddenId(currentText, eventId);
          raw = buildWhatsAppUrl(phone, msgWithHiddenId);
        } else if (u.hostname.includes('whatsapp.com')) {
          const currentText = u.searchParams.get('text') || settingsStore.defaultMessage || 'Olá!';
          u.searchParams.set('text', zeroWidth.injectHiddenId(currentText, eventId));
          u.searchParams.delete('type');
          u.searchParams.set('app_absent', '0');
          raw = u.toString();
        } else {
          u.searchParams.set('event_id', eventId);
          raw = u.toString();
        }
      } catch (_) {
        raw = link.url;
      }
    } else {
      raw = settingsStore.fallbackUrl || 'https://web.whatsapp.com';
    }
  } else {
    raw = settingsStore.fallbackUrl || 'https://web.whatsapp.com';
  }

  const isWhatsApp = raw.includes('wa.me') || raw.includes('whatsapp.com');
  const finalUrl   = (!isWhatsApp && settingsStore.forwardUtms !== false) ? mergeUtms(raw, query) : raw;

  if (link) {
    link.totalClicks = (link.totalClicks || 0) + 1;
    link.todayClicks = (link.todayClicks || 0) + 1;
  }

  metricsStore.totalRedirects = (metricsStore.totalRedirects || 0) + 1;
  metricsStore.todayRedirects = (metricsStore.todayRedirects || 0) + 1;

  metricsStore.logs = [{
    id:        `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    eventId,
    timestamp: new Date().toISOString(),
    linkId:    link?.id    || null,
    linkName:  link?.name  || 'Fallback',
    targetUrl: finalUrl,
    userAgent: ua,
    device:    detectDevice(ua),
    utms:      sessionData.utms,
  }, ...(metricsStore.logs || [])].slice(0, 500);

  saveData(); // assíncrono

  return finalUrl;
}

// ==========================================
// FASTIFY
// ==========================================
const app = Fastify({ logger: false, trustProxy: true });

// Suporte a CORS, estáticos e URL-encoded (Kommo Webhooks)
app.register(require('@fastify/cors'), { origin: true });
app.register(require('@fastify/formbody'));
app.register(require('@fastify/static'), {
  root:   path.join(__dirname, 'public'),
  prefix: '/',
  index:  false,
});

// ==========================================
// AUTH MIDDLEWARE (admin)
// ==========================================
function checkAuth(req, reply) {
  if (!settingsStore.requireAuth) return true;
  const token   = req.headers['x-admin-token'];
  if (!token) { reply.code(401).send({ success: false, message: 'Autenticação necessária.', authRequired: true }); return false; }
  const session = tokenStore.get(token);
  if (!session || Date.now() > session.expiresAt) {
    tokenStore.delete(token);
    reply.code(401).send({ success: false, message: 'Sessão expirada.', authRequired: true });
    return false;
  }
  return true;
}

// ==========================================
// 🚀 ROTA PRINCIPAL — HTTP 302 SERVER-SIDE
// ==========================================
app.get('/', async (req, reply) => {
  const query = req.query || {};
  const link  = pickLink();
  const url   = processRedirect(link, query, req);
  return reply.redirect(url);
});

// ==========================================
// API — compatibilidade com redirect.js (se carregado via /preview)
// ==========================================
app.get('/api/redirect/next', async (req, reply) => {
  const query = req.query || {};
  const link  = pickLink();
  const url   = processRedirect(link, query, req);
  return {
    success:          true,
    targetUrl:        url,
    linkName:         link?.name || 'Fallback',
    delay:            Number(settingsStore.redirectDelay) || 2000,
    title:            settingsStore.title       || 'Por favor, aguarde alguns segundos.',
    subtitle:         settingsStore.subtitle    || 'Estamos direcionando você para o WhatsApp.',
    buttonText:       settingsStore.buttonText  || 'Clique aqui se não for redirecionado',
    metaPixelId:      settingsStore.metaPixelId || '',
    googleAnalyticsId:settingsStore.googleAnalyticsId || '',
    customHeadScripts:settingsStore.customHeadScripts  || '',
  };
});

// ==========================================
// 🎯 WEBHOOK KOMMO CRM (Recebe a mensagem com caracteres invisíveis)
// Suporta tanto URL-encoded quanto JSON
// ==========================================

// Função auxiliar para varrer recursivamente qualquer objeto ou payload procurando caracteres invisíveis
function scanForZeroWidth(data) {
  if (!data) return null;

  if (typeof data === 'string') {
    const decodedId = zeroWidth.decodeZeroWidth(data);
    if (decodedId) {
      return { eventId: decodedId, rawText: data };
    }
    return null;
  }

  if (typeof data === 'object') {
    for (const val of Object.values(data)) {
      const match = scanForZeroWidth(val);
      if (match) return match;
    }
  }

  return null;
}

// Função auxiliar para extrair contato (telefone e nome) de payloads variados do Kommo
function scanForContact(data) {
  let phone = '';
  let name  = '';

  function scan(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (typeof v === 'string') {
        if (!phone && (key.includes('phone') || key.includes('chat_id') || key.includes('sender') || key.includes('from'))) {
          const digits = v.replace(/\D/g, '');
          if (digits.length >= 8 && digits.length <= 15) phone = digits;
        }
        if (!name && (key === 'name' || key === 'author_name' || key === 'contact_name' || key === 'lead_name')) {
          name = v.trim();
        }
      } else if (typeof v === 'object') {
        scan(v);
      }
    }
  }
  scan(data);
  return { phone, name };
}

const qs = require('qs');

async function handleKommoWebhook(req, reply) {
  let body = req.body || {};
  const query = req.query || {};

  // Se o payload vier embrulhado por proxies ou testadores de webhook (ex: apiteste) contendo { raw: "..." }:
  if (typeof body.raw === 'string') {
    try {
      const parsed = qs.parse(body.raw);
      body = { ...parsed, ...body };
    } catch (_) {}
  } else if (typeof body === 'string') {
    try {
      body = qs.parse(body);
    } catch (_) {}
  }

  const payloadToScan = Object.keys(body).length ? body : query;

  // Extrai informações do contato para diagnóstico
  const contact = scanForContact(payloadToScan);

  // 1. Procura o eventId embutido nos caracteres invisíveis
  const found = scanForZeroWidth(payloadToScan);

  let receivedText = '';
  try {
    if (body.message?.add?.[0]?.text) receivedText = body.message.add[0].text;
  } catch (_) {}

  const clientIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

  if (!found) {
    console.log(`[Kommo Webhook] Mensagem recebida de "${contact.name || 'Desconhecido'}": "${receivedText}". Caracteres invisíveis: NÃO ENCONTRADOS.`);

    // Registra log para visualização no painel admin
    const logItem = {
      id:           'wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp:    new Date().toISOString(),
      ip:           clientIp,
      sender:       contact.name || 'Desconhecido',
      phone:        contact.phone || '',
      receivedText: receivedText || 'Mensagem sem texto',
      matched:      false,
      eventId:      null,
      campaign:     '-',
      source:       '-',
      statusText:   'Sem código invisível (texto comum digitado no WhatsApp)',
      rawBody:      body
    };
    webhookLogsStore.unshift(logItem);
    if (webhookLogsStore.length > 500) webhookLogsStore.pop();
    saveWebhookLogs();

    return reply.send({
      success: true,
      matched: false,
      sender: contact.name || 'Desconhecido',
      receivedText: receivedText || 'Mensagem sem texto',
      message: `Webhook recebido do Kommo com sucesso, mas a mensagem "${receivedText || ''}" não continha caracteres invisíveis de rastreamento (o usuário provavelmente digitou manualmente no WhatsApp em vez de enviar pelo link do anúncio).`,
    });
  }

  const { eventId, rawText } = found;
  const session = sessionsStore.get(eventId);
  const now = new Date();

  // 2. Extrai dados de contato e limpa mensagem
  const cleanMsg = zeroWidth.cleanMessage(rawText);

  let matchDelaySeconds = null;
  if (session && session.createdAt) {
    matchDelaySeconds = Math.round((now.getTime() - new Date(session.createdAt).getTime()) / 1000);
    session.status = 'converted';
    session.convertedAt = now.toISOString();
    saveSessions();
  }

  // 3. Registra o lead convertido
  const leadEntry = {
    id:                'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    eventId,
    phone:             contact.phone || session?.targetPhone || '',
    name:              contact.name  || 'Lead WhatsApp',
    cleanMessage:      cleanMsg || rawText,
    rawMessage:        rawText,
    ip:                session?.ip || clientIp,
    userAgent:         session?.userAgent || req.headers['user-agent'] || '',
    device:            session?.device || detectDevice(session?.userAgent || ''),
    utms:              session?.utms || {},
    clickIds:          session?.clickIds || {},
    allParams:         session?.allParams || {},
    linkId:            session?.linkId || null,
    linkName:          session?.linkName || 'Direto',
    clickTime:         session?.createdAt || null,
    leadTime:          now.toISOString(),
    matchDelaySeconds,
    status:            'matched',
  };

  leadsStore.unshift(leadEntry);
  if (leadsStore.length > 2000) leadsStore.pop();
  saveLeads();

  // Registra log para visualização no painel admin
  const logItem = {
    id:           'wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp:    now.toISOString(),
    ip:           clientIp,
    sender:       contact.name || 'Lead WhatsApp',
    phone:        contact.phone || session?.targetPhone || '',
    receivedText: cleanMsg || rawText,
    matched:      true,
    eventId,
    campaign:     session?.utms?.campaign || 'Direto',
    source:       session?.utms?.source || 'Geral',
    statusText:   `Match confirmado com clique! (${session?.utms?.campaign || 'Direto'})`,
    rawBody:      body
  };
  webhookLogsStore.unshift(logItem);
  if (webhookLogsStore.length > 500) webhookLogsStore.pop();
  saveWebhookLogs();

  return reply.send({
    success: true,
    matched: true,
    eventId,
    lead: leadEntry,
    message: 'Lead vinculado com sucesso ao clique de origem via esteganografia!',
  });
}

// Rotas de Webhook para o Kommo CRM (aceita /api/webhook/kommo e /webhook/kommo)
app.post('/api/webhook/kommo', handleKommoWebhook);
app.post('/webhook/kommo', handleKommoWebhook);

// Health check para testes no navegador
app.get('/api/webhook/kommo', async (req, reply) => {
  return {
    status: 'online',
    message: 'Webhook do Kommo CRM ativo e pronto para receber requisições POST.',
    timestamp: new Date().toISOString(),
    endpoint: '/api/webhook/kommo'
  };
});
app.get('/webhook/kommo', async (req, reply) => {
  return reply.redirect('/api/webhook/kommo');
});

// ==========================================
// ADMIN — Logs do Webhook Kommo
// ==========================================
app.get('/api/admin/webhook-logs', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  return {
    success: true,
    total:   webhookLogsStore.length,
    logs:    webhookLogsStore,
  };
});

app.delete('/api/admin/webhook-logs', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  webhookLogsStore = [];
  saveWebhookLogs();
  return { success: true, message: 'Histórico de webhooks limpo.' };
});

// ==========================================
// ADMIN — Leads & Rastreamento
// ==========================================
app.get('/api/admin/leads', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  return {
    success:    true,
    totalLeads: leadsStore.length,
    leads:      leadsStore,
  };
});

app.delete('/api/admin/leads/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const before = leadsStore.length;
  leadsStore = leadsStore.filter(l => l.id !== req.params.id);
  if (leadsStore.length === before) return reply.code(404).send({ success: false, message: 'Lead não encontrado.' });
  saveLeads();
  return { success: true, message: 'Lead removido com sucesso.' };
});

// Endpoint para testar/simular webhook do Kommo
app.post('/api/admin/leads/test-simulate', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { phone, message, eventId: customEventId } = req.body || {};

  // Se não passar eventId, pega o da última sessão ou cria uma nova
  let targetEventId = customEventId;
  if (!targetEventId) {
    const keys = Array.from(sessionsStore.keys());
    targetEventId = keys.length ? keys[keys.length - 1] : ('ev_' + Date.now().toString(36));
    if (!sessionsStore.has(targetEventId)) {
      sessionsStore.set(targetEventId, {
        eventId: targetEventId,
        createdAt: new Date(Date.now() - 45000).toISOString(),
        ip: '189.40.122.15',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        utms: { source: 'tiktok', medium: 'cpc', campaign: 'teste_kommo', content: 'anuncio_01' },
        clickIds: { ttclid: 'tt_test_12345' },
        linkName: 'Atendente Principal',
        status: 'pending',
      });
      saveSessions();
    }
  }

  const baseText = message || 'Olá! Vim pelo anúncio e gostaria de saber o valor.';
  const payloadMessage = zeroWidth.injectHiddenId(baseText, targetEventId);

  // Simula payload no formato Kommo
  const simulatedBody = {
    message: {
      add: [
        {
          text: payloadMessage,
          chat_id: phone || '5511988887777',
          author_name: 'Cliente Teste Kommo',
        }
      ]
    }
  };

  const fakeReq = { body: simulatedBody, ip: '127.0.0.1', headers: {} };
  let result = null;
  await handleKommoWebhook(fakeReq, { send: (data) => { result = data; } });

  return {
    success: true,
    result,
    simulatedEventId: targetEventId,
    message: 'Simulação do webhook Kommo executada com sucesso!'
  };
});

// Sessões ativas em RAM
app.get('/api/admin/sessions', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const list = Array.from(sessionsStore.values()).slice(-50).reverse();
  return {
    success: true,
    totalSessions: sessionsStore.size,
    sessions: list,
  };
});

// ==========================================
// ADMIN — Links
// ==========================================
app.get('/api/admin/links', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  checkDailyReset();
  return { success: true, links: linksStore };
});

app.post('/api/admin/links', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { name, phone, message, active, dailyLimit, weight, url, directUrl } = req.body || {};
  const targetUrl = (url || directUrl || '').trim();
  if (!name || (!phone && !targetUrl)) {
    return reply.code(400).send({ success: false, message: 'Nome e Link/WhatsApp são obrigatórios.' });
  }
  const finalUrl = targetUrl.startsWith('http')
    ? targetUrl
    : buildWhatsAppUrl(phone || targetUrl, message);

  const newLink = {
    id:            'link_' + Date.now(),
    name:          name.trim(),
    phone:         phone   ? phone.trim()   : '',
    message:       message ? message.trim() : '',
    url:           finalUrl,
    active:        active !== undefined ? Boolean(active) : true,
    dailyLimit:    Number(dailyLimit) || 0,
    weight:        Number(weight)     || 1,
    totalClicks:   0,
    todayClicks:   0,
    lastResetDate: new Date().toISOString().slice(0, 10),
    createdAt:     new Date().toISOString(),
  };
  linksStore.push(newLink);
  saveData();
  return { success: true, link: newLink, message: 'Link cadastrado com sucesso!' };
});

app.put('/api/admin/links/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { id } = req.params;
  const { name, phone, message, active, dailyLimit, weight, url, directUrl } = req.body || {};
  const idx = linksStore.findIndex(l => l.id === id);
  if (idx === -1) return reply.code(400).send({ success: false, message: 'Link não encontrado.' });

  const cur = linksStore[idx];
  const targetUrl = url !== undefined ? url : directUrl;
  let finalUrl = cur.url;
  if (targetUrl && targetUrl.startsWith('http')) {
    finalUrl = targetUrl.trim();
  } else if (phone || message !== undefined) {
    finalUrl = buildWhatsAppUrl(phone || cur.phone, message !== undefined ? message : cur.message);
  }

  linksStore[idx] = {
    ...cur,
    name:       name       ? name.trim()       : cur.name,
    phone:      phone      !== undefined ? phone.trim()    : cur.phone,
    message:    message    !== undefined ? message.trim()  : cur.message,
    url:        finalUrl,
    active:     active     !== undefined ? Boolean(active) : cur.active,
    dailyLimit: dailyLimit !== undefined ? Number(dailyLimit) : cur.dailyLimit,
    weight:     weight     !== undefined ? Number(weight)     : cur.weight,
    updatedAt:  new Date().toISOString(),
  };
  saveData();
  return { success: true, link: linksStore[idx], message: 'Link atualizado com sucesso!' };
});

app.patch('/api/admin/links/:id/toggle', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const link = linksStore.find(l => l.id === req.params.id);
  if (!link) return reply.code(404).send({ success: false, message: 'Link não encontrado.' });
  link.active = !link.active;
  saveData();
  return { success: true, active: link.active, link, message: `Link ${link.active ? 'ativado' : 'desativado'}!` };
});

app.delete('/api/admin/links/:id', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const before = linksStore.length;
  linksStore = linksStore.filter(l => l.id !== req.params.id);
  if (linksStore.length === before) return reply.code(404).send({ success: false, message: 'Link não encontrado.' });
  saveData();
  return { success: true, message: 'Link removido com sucesso!' };
});

// ==========================================
// ADMIN — Stats
// ==========================================
app.get('/api/admin/stats', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  checkDailyReset();

  const utmSources   = {};
  const utmCampaigns = {};
  (metricsStore.logs || []).forEach(log => {
    const src = log.utms?.source || 'Direto / Sem UTM';
    utmSources[src] = (utmSources[src] || 0) + 1;
    if (log.utms?.campaign) utmCampaigns[log.utms.campaign] = (utmCampaigns[log.utms.campaign] || 0) + 1;
  });

  return {
    success:        true,
    totalRedirects: metricsStore.totalRedirects || 0,
    todayRedirects: metricsStore.todayRedirects || 0,
    totalLeads:     leadsStore.length,
    totalSessions:  sessionsStore.size,
    totalLinks:     linksStore.length,
    activeLinks:    linksStore.filter(l => l.active).length,
    inactiveLinks:  linksStore.filter(l => !l.active).length,
    links:          linksStore,
    utmSources,
    utmCampaigns,
    recentLogs:     (metricsStore.logs || []).slice(0, 50),
  };
});

// ==========================================
// ADMIN — Settings
// ==========================================
app.get('/api/admin/settings', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  return { success: true, settings: settingsStore };
});

app.post('/api/admin/settings', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  settingsStore = { ...settingsStore, ...req.body };
  saveSettings();
  return { success: true, settings: settingsStore, message: 'Configurações salvas com sucesso!' };
});

// ==========================================
// ADMIN — Reset / Export / Import
// ==========================================
app.post('/api/admin/reset-stats', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  linksStore.forEach(l => { l.totalClicks = 0; l.todayClicks = 0; });
  metricsStore = { totalRedirects: 0, todayRedirects: 0, lastResetDate: new Date().toISOString().slice(0, 10), roundRobinIndex: 0, logs: [] };
  saveData();
  return { success: true, message: 'Estatísticas zeradas com sucesso!' };
});

app.get('/api/admin/export', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  reply.header('Content-Disposition', 'attachment; filename=whatsapp-rotator-backup.json');
  reply.header('Content-Type', 'application/json');
  return reply.send(JSON.stringify({ settings: settingsStore, links: linksStore, metrics: metricsStore, leads: leadsStore, exportedAt: new Date().toISOString() }, null, 2));
});

app.post('/api/admin/import', async (req, reply) => {
  if (!checkAuth(req, reply)) return;
  const { settings, links, metrics, leads } = req.body || {};
  if (settings) { settingsStore = settings; saveSettings(); }
  if (Array.isArray(links))  { linksStore   = links;   }
  if (metrics)               { metricsStore = metrics; }
  if (Array.isArray(leads))  { leadsStore   = leads;   saveLeads(); }
  saveData();
  return { success: true, message: 'Backup restaurado com sucesso!' };
});

// ==========================================
// ADMIN — Auth / Logout
// ==========================================
app.post('/api/admin/auth', async (req, reply) => {
  const { pin } = req.body || {};
  const ip      = req.ip;

  const rateEntry = rateLimitStore.get(ip) || { attempts: 0, blockedUntil: null };
  if (rateEntry.blockedUntil && Date.now() < rateEntry.blockedUntil) {
    const min = Math.ceil((rateEntry.blockedUntil - Date.now()) / 60000);
    return reply.code(429).send({ success: false, message: `IP bloqueado. Tente em ${min} min.`, remaining: 0 });
  }

  if (!settingsStore.requireAuth || pin === settingsStore.adminPin) {
    rateLimitStore.delete(ip);
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    tokenStore.set(token, { expiresAt });
    return { success: true, token, message: 'Autenticado com sucesso!' };
  }

  rateEntry.attempts = (rateEntry.attempts || 0) + 1;
  const remaining    = Math.max(0, 5 - rateEntry.attempts);
  if (rateEntry.attempts >= 5) rateEntry.blockedUntil = Date.now() + 15 * 60 * 1000;
  rateLimitStore.set(ip, rateEntry);

  return reply.code(401).send({
    success:   false,
    message:   remaining > 0 ? `PIN incorreto. ${remaining} tentativa(s) restante(s).` : 'IP bloqueado por 15 minutos.',
    remaining,
  });
});

app.post('/api/admin/logout', async (req, reply) => {
  const token = req.headers['x-admin-token'];
  if (token) tokenStore.delete(token);
  return { success: true, message: 'Logout realizado!' };
});

// ==========================================
// ROTAS ESTÁTICAS (Admin + Fallback / Preview)
// ==========================================
app.get('/admin', async (req, reply) => reply.sendFile('admin/index.html'));
app.get('/admin/', async (req, reply) => reply.sendFile('admin/index.html'));
app.get('/preview', async (req, reply) => reply.sendFile('index.html'));
app.get('/loading', async (req, reply) => reply.sendFile('index.html'));

// Fallback para rotas não encontradas
app.setNotFoundHandler(async (req, reply) => {
  return reply.code(404).type('text/plain').send('Página não encontrada.');
});

// ==========================================
// START
// ==========================================
loadAll();

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('====================================================');
  console.log('🚀 Servidor Ultra-Rápido WhatsApp Redirect Ativo!');
  console.log(`⚡ Engine:  Fastify + RAM Store`);
  console.log(`🔗 Redirect: http://localhost:${PORT}  (HTTP 302 direto)`);
  console.log(`🎯 Kommo Webhook: http://localhost:${PORT}/api/webhook/kommo`);
  console.log(`⚙️  Admin:   http://localhost:${PORT}/admin`);
  console.log('====================================================');
});
