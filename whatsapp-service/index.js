/**
 * WhatsApp Web sidecar service — multi-user edition.
 *
 * Each Supabase user gets their own isolated WhatsApp session identified by
 * session_id (= Supabase user UUID).  Sessions are created lazily when
 * GET /qr?session_id=xxx is first called and are cleaned up automatically
 * when WhatsApp disconnects.
 *
 * HTTP API:
 *   GET  /status?session_id=xxx  → { connected, phone, name, has_qr }
 *   GET  /qr?session_id=xxx      → { qr, connected } — creates session if new
 *   POST /send                   → { session_id, to, body }
 *   POST /logout?session_id=xxx  → log out that session
 *   GET  /health                 → { ok: true, sessions: N }
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// ── Config ────────────────────────────────────────────────────────────────────

const FASTAPI_URL  = process.env.FASTAPI_URL  || 'http://localhost:8000';
const PORT         = parseInt(process.env.WA_SERVICE_PORT || process.env.PORT || '3001', 10);
const LISTEN_MODE  = process.env.WA_LISTEN_MODE || 'self';
const MAX_SESSIONS = parseInt(process.env.WA_MAX_SESSIONS || '20', 10);

// ── Session registry ──────────────────────────────────────────────────────────
//
// sessions: Map<sessionId, SessionState>
//
// SessionState: {
//   sessionId, client,
//   qrDataUrl, isReady, connectedPhone, connectedName,
//   selfLidId, processingChats, sentByBot,
//   cleanupTimer   (setTimeout handle — clears slot after prolonged disconnect)
// }

const sessions = new Map();

// ── Shared helpers ────────────────────────────────────────────────────────────

const _mathToAscii = (() => {
  const map = new Map();
  const LETTER_BLOCKS = [
    [0x1D400, 65, 26], [0x1D41A, 97, 26],
    [0x1D468, 65, 26], [0x1D482, 97, 26],
    [0x1D4D0, 65, 26], [0x1D4EA, 97, 26],
    [0x1D56C, 65, 26], [0x1D586, 97, 26],
    [0x1D5A0, 65, 26], [0x1D5BA, 97, 26],
    [0x1D5D4, 65, 26], [0x1D5EE, 97, 26],
    [0x1D608, 65, 26], [0x1D622, 97, 26],
    [0x1D63C, 65, 26], [0x1D656, 97, 26],
    [0x1D670, 65, 26], [0x1D68A, 97, 26],
  ];
  const DIGIT_BLOCKS = [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6];
  for (const [start, base, count] of LETTER_BLOCKS)
    for (let i = 0; i < count; i++) map.set(start + i, base + i);
  for (const start of DIGIT_BLOCKS)
    for (let i = 0; i < 10; i++) map.set(start + i, 48 + i);
  return map;
})();

function normalizeUnicode(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (_mathToAscii.has(cp))            out += String.fromCharCode(_mathToAscii.get(cp));
    else if (cp >= 0xFF01 && cp <= 0xFF5E) out += String.fromCharCode(cp - 0xFF01 + 0x21);
    else                                   out += ch;
  }
  return out;
}

const EMAIL_RE = /[\w.+'%-]+@[\w.-]+\.[a-zA-Z]{2,}/g;

const JOB_BOARD_DOMAINS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com',
  'ziprecruiter.com', 'workable.com', 'greenhouse.io', 'lever.co',
  'ashbyhq.com', 'bamboohr.com', 'smartrecruiters.com', 'icims.com',
  'jobvite.com', 'workday.com', 'taleo.net', 'successfactors.com',
  'noreply.com', 'notifications.linkedin.com', 'no-reply.com',
]);

const HR_PREFIXES = ['hr', 'recruit', 'talent', 'hiring', 'careers', 'career', 'jobs', 'apply', 'people', 'join'];

function extractHrEmail(body) {
  const all = normalizeUnicode(body).match(EMAIL_RE) || [];
  if (!all.length) return null;
  const candidates = all.filter(email => {
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (JOB_BOARD_DOMAINS.has(domain)) return false;
    if ([...JOB_BOARD_DOMAINS].some(jb => domain.endsWith('.' + jb))) return false;
    return true;
  });
  const pool = candidates.length ? candidates : all;
  const hrMatch = pool.find(email => {
    const local = (email.split('@')[0] || '').toLowerCase();
    return HR_PREFIXES.some(p => local.startsWith(p) || local.includes(p));
  });
  return hrMatch || pool[0];
}

const BOT_PREFIXES = [
  '*Draft ready', '⚠️', '✅', '⏳', '🔍',
  'Draft cancelled', 'Form submission cancelled',
  'No profile found', 'No resume found', 'Processing error',
  '*📋 Form detected', '*Form submitted', '*Dry-run complete',
  'DRY_RUN', '────',
];

// ── Per-session dispatch helpers ──────────────────────────────────────────────

function rememberBotMsg(state, msg) {
  if (!msg?.id?._serialized) return;
  state.sentByBot.set(msg.id._serialized, Date.now() + 60_000);
  if (state.sentByBot.size > 200) {
    const now = Date.now();
    for (const [k, exp] of state.sentByBot) if (exp < now) state.sentByBot.delete(k);
  }
}

async function dispatchToFastAPI(state, chatId, body, hrEmail, isSelf) {
  if (state.processingChats.has(chatId)) {
    try {
      const ping = await state.client.sendMessage(chatId, '⏳ Still processing your previous message, please wait…');
      rememberBotMsg(state, ping);
    } catch (_) {}
    return;
  }
  state.processingChats.add(chatId);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${FASTAPI_URL}/webhooks/whatsapp-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: chatId,
        body,
        hr_email: hrEmail,
        is_self: isSelf,
        session_id: state.sessionId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) { console.error(`[${state.sessionId}] FastAPI error:`, res.status, await res.text()); return; }
    const data = await res.json();
    if (data.reply) { const sent = await state.client.sendMessage(chatId, data.reply); rememberBotMsg(state, sent); }
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.error(`[${state.sessionId}] dispatch failed:`, isTimeout ? 'timeout (90 s)' : err.message);
    try {
      const errMsg = await state.client.sendMessage(chatId, `⚠️ Processing error: ${isTimeout ? 'Request timed out.' : err.message}`);
      rememberBotMsg(state, errMsg);
    } catch (_) {}
  } finally {
    state.processingChats.delete(chatId);
  }
}

async function dispatchVoiceToFastAPI(state, chatId, msg) {
  if (state.processingChats.has(chatId)) {
    try {
      const ping = await state.client.sendMessage(chatId, '⏳ Still processing your previous message, please wait…');
      rememberBotMsg(state, ping);
    } catch (_) {}
    return;
  }
  state.processingChats.add(chatId);
  let media;
  try { media = await msg.downloadMedia(); } catch (e) {
    console.error(`[${state.sessionId}] voice download failed:`, e.message);
    state.processingChats.delete(chatId);
    return;
  }
  if (!media?.data) { state.processingChats.delete(chatId); return; }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${FASTAPI_URL}/webhooks/whatsapp-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: chatId,
        audio_data: media.data,
        mimetype: media.mimetype || 'audio/ogg; codecs=opus',
        is_self: true,
        session_id: state.sessionId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) { console.error(`[${state.sessionId}] voice FastAPI error:`, res.status); return; }
    const data = await res.json();
    if (data.reply) { const sent = await state.client.sendMessage(chatId, data.reply); rememberBotMsg(state, sent); }
  } catch (err) {
    clearTimeout(timeoutId);
    try {
      const errMsg = await state.client.sendMessage(chatId, '⚠️ Voice note processing failed. Please type your message instead.');
      rememberBotMsg(state, errMsg);
    } catch (_) {}
  } finally {
    state.processingChats.delete(chatId);
  }
}

// ── Session factory ───────────────────────────────────────────────────────────

function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[session] MAX_SESSIONS (${MAX_SESSIONS}) reached, rejecting new session ${sessionId}`);
    return null;
  }

  console.log(`[session] Creating new session for ${sessionId}`);

  const state = {
    sessionId,
    client: null,
    qrDataUrl: null,
    isReady: false,
    connectedPhone: null,
    connectedName: null,
    selfLidId: null,
    processingChats: new Set(),
    sentByBot: new Map(),
    cleanupTimer: null,
  };

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.0.html',
    },
  });

  state.client = client;
  sessions.set(sessionId, state);

  // ── Events ──────────────────────────────────────────────────────────────────

  client.on('loading_screen', (pct, msg) => {
    process.stdout.write(`\r[${sessionId}] Loading... ${pct}% – ${msg}  `);
  });

  client.on('qr', async (qr) => {
    state.qrDataUrl = await qrcode.toDataURL(qr);
    state.isReady = false;
    console.log(`\n[${sessionId}] QR code generated`);
  });

  client.on('authenticated', () => {
    console.log(`[${sessionId}] Authenticated`);
  });

  client.on('ready', async () => {
    state.isReady = true;
    state.qrDataUrl = null;
    state.connectedPhone = client.info.wid.user;
    state.connectedName = client.info.pushname || state.connectedPhone;
    if (state.cleanupTimer) { clearTimeout(state.cleanupTimer); state.cleanupTimer = null; }
    console.log(`[${sessionId}] Connected: ${state.connectedName} (+${state.connectedPhone})`);

    const selfId = client.info.wid._serialized;
    try {
      const chats = await client.getChats();
      const selfChat = chats.find(c =>
        !c.isGroup && (
          c.id._serialized === selfId ||
          c.id.user === selfId.split('@')[0] ||
          c.name === state.connectedName
        )
      );
      if (selfChat) { state.selfLidId = selfChat.id._serialized; }
    } catch (e) {}

    try {
      const pingMsg = await client.sendMessage(selfId, '✅ Job agent online — send me an HR email to draft your application!');
      rememberBotMsg(state, pingMsg);
      console.log(`[${sessionId}] startup ping sent to ${selfId}`);
    } catch (e) {
      console.error(`[${sessionId}] startup ping failed:`, e.message);
    }
  });

  client.on('disconnected', (reason) => {
    state.isReady = false;
    state.connectedPhone = null;
    state.qrDataUrl = null;
    console.log(`[${sessionId}] Disconnected: ${reason}`);
    // Clean up after 5 minutes so LocalAuth data can persist for quick reconnect
    state.cleanupTimer = setTimeout(() => {
      sessions.delete(sessionId);
      console.log(`[session] Removed session ${sessionId} after disconnect`);
    }, 5 * 60 * 1000);
  });

  client.on('auth_failure', (msg) => {
    state.isReady = false;
    console.error(`[${sessionId}] Auth failure:`, msg);
  });

  // ── message_create — self-trigger ──────────────────────────────────────────

  client.on('message_create', async (msg) => {
    if (!state.isReady || !msg.fromMe) return;

    const selfId = client.info.wid._serialized;
    const toId   = (msg.to   || '').toString();
    const fromId = (msg.from || '').toString();

    // Discover @lid self-chat ID
    if (!state.selfLidId && toId.endsWith('@lid') && toId === fromId) {
      state.selfLidId = toId;
      console.log(`[${sessionId}] @lid self-chat discovered: ${state.selfLidId}`);
    }

    const isSelfChat =
      toId === selfId ||
      (state.selfLidId && toId === state.selfLidId) ||
      (toId.endsWith('@lid') && toId === fromId);

    console.log(`[${sessionId}] message_create: to=${toId} selfId=${selfId} selfLid=${state.selfLidId} isSelf=${isSelfChat} body="${(msg.body||'').slice(0,60)}"`);

    if (!isSelfChat) return;

    const msgId = msg.id?._serialized;
    if (msgId && state.sentByBot.has(msgId)) {
      console.log(`[${sessionId}] skipping bot message ${msgId}`);
      state.sentByBot.delete(msgId);
      return;
    }

    if (msg.type === 'ptt' || msg.type === 'audio') {
      await dispatchVoiceToFastAPI(state, selfId, msg);
      return;
    }

    const body = (msg.body || '').trim();
    if (!body) return;
    if (BOT_PREFIXES.some(p => body.startsWith(p))) return;

    console.log(`[${sessionId}] dispatching to FastAPI: hr_email=${extractHrEmail(body)} body="${body.slice(0,80)}"`);
    await dispatchToFastAPI(state, selfId, body, extractHrEmail(body), true);
  });

  // ── message — inbound ──────────────────────────────────────────────────────

  client.on('message', async (msg) => {
    if (!state.isReady) return;
    const selfId = client.info.wid._serialized;
    const fromId = msg.from;
    const body = (msg.body || '').trim();
    if (!body) return;

    const shouldProcess = (() => {
      if (LISTEN_MODE === 'all') return true;
      if (LISTEN_MODE === 'self') return fromId === selfId || msg.fromMe;
      return LISTEN_MODE.split(',').map(s => s.trim()).includes(fromId);
    })();

    if (!shouldProcess) return;
    if (msg.fromMe && BOT_PREFIXES.some(p => body.startsWith(p))) return;

    await dispatchToFastAPI(state, fromId, body, extractHrEmail(body), msg.fromMe || fromId === selfId);
  });

  client.initialize();
  return state;
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, max_sessions: MAX_SESSIONS });
});

app.get('/status', (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const s = sessions.get(sessionId);
  if (!s) return res.json({ connected: false, has_qr: false, session_id: sessionId });

  res.json({
    connected:    s.isReady,
    phone:        s.connectedPhone,
    name:         s.connectedName,
    has_qr:       !!s.qrDataUrl,
    listen_mode:  LISTEN_MODE,
    session_id:   sessionId,
  });
});

app.get('/qr', (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  // Lazily create session on first QR request
  const s = createSession(sessionId);
  if (!s) return res.status(503).json({ error: 'max_sessions_reached' });

  if (s.isReady)    return res.json({ qr: null, connected: true, phone: s.connectedPhone });
  if (s.qrDataUrl)  return res.json({ qr: s.qrDataUrl, connected: false });
  res.json({ qr: null, connected: false, loading: true });
});

app.post('/send', async (req, res) => {
  const { session_id, to, body } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const s = sessions.get(session_id);
  if (!s?.isReady) return res.status(503).json({ error: 'WhatsApp not connected for this session' });
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });

  try {
    await s.client.sendMessage(to, body);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${session_id}] send error:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', async (req, res) => {
  const sessionId = req.query.session_id || req.body?.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'session not found' });

  try {
    await s.client.logout();
    sessions.delete(sessionId);
    res.json({ ok: true, message: 'Logged out' });
  } catch (err) {
    // Force-remove even if logout call fails
    sessions.delete(sessionId);
    res.json({ ok: true, message: 'Session removed (logout may have partially failed)' });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp service HTTP API on :${PORT}`);
  console.log(`Max concurrent sessions: ${MAX_SESSIONS}`);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await Promise.allSettled([...sessions.values()].map(s => s.client.destroy()));
  process.exit(0);
});
