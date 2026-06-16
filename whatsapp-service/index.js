'use strict';
/**
 * WhatsApp Web sidecar — multi-user edition (Baileys backend).
 *
 * Uses @whiskeysockets/baileys (pure WebSocket, no Chromium) for reliable
 * cloud deployment. Each Supabase user gets an isolated session identified
 * by session_id (= Supabase user UUID). Sessions are lazily created on the
 * first GET /qr?session_id=xxx call.
 *
 * HTTP API:
 *   GET  /status?session_id=xxx  → { connected, phone, name, has_qr }
 *   GET  /qr?session_id=xxx      → { qr, connected } — creates session if new
 *   POST /send                   → { session_id, to, body }
 *   POST /logout?session_id=xxx  → log out that session
 *   GET  /health                 → { ok: true, sessions: N }
 */

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  isJidUser,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const QRCode  = require('qrcode');
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const pino    = require('pino');
const path    = require('path');
const fs      = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────

const FASTAPI_URL  = process.env.FASTAPI_URL  || 'http://localhost:8000';
const PORT         = parseInt(process.env.WA_SERVICE_PORT || process.env.PORT || '8080', 10);
const MAX_SESSIONS = parseInt(process.env.WA_MAX_SESSIONS || '20', 10);
const AUTH_DIR     = process.env.WA_AUTH_DIR || './.wwebjs_auth';

const silentLogger = pino({ level: 'silent' });

// ── Session registry ──────────────────────────────────────────────────────────

const sessions = new Map();

// ── Unicode normalizer (WhatsApp bold/italic math chars → ASCII) ──────────────

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
    if (_mathToAscii.has(cp))              out += String.fromCharCode(_mathToAscii.get(cp));
    else if (cp >= 0xFF01 && cp <= 0xFF5E) out += String.fromCharCode(cp - 0xFF01 + 0x21);
    else                                    out += ch;
  }
  return out;
}

// ── HR email extraction ───────────────────────────────────────────────────────

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

// ── Bot-message deduplication ─────────────────────────────────────────────────

function rememberBotMsg(state, msgId) {
  if (!msgId) return;
  state.sentByBot.set(msgId, Date.now() + 60_000);
  if (state.sentByBot.size > 200) {
    const now = Date.now();
    for (const [k, exp] of state.sentByBot) if (exp < now) state.sentByBot.delete(k);
  }
}

// ── FastAPI dispatch ──────────────────────────────────────────────────────────

async function dispatchToFastAPI(state, chatJid, body, hrEmail, isSelf) {
  const { sessionId, sock } = state;

  if (state.processingChats.has(chatJid)) {
    try {
      const r = await sock.sendMessage(chatJid, { text: '⏳ Still processing your previous message, please wait…' });
      rememberBotMsg(state, r?.key?.id);
    } catch (_) {}
    return;
  }
  state.processingChats.add(chatJid);

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${FASTAPI_URL}/webhooks/whatsapp-local`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: chatJid, body, hr_email: hrEmail, is_self: isSelf, session_id: sessionId }),
      signal:  controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) { console.error(`[${sessionId}] FastAPI error:`, res.status, await res.text()); return; }
    const data = await res.json();
    if (data.reply) {
      const r = await sock.sendMessage(chatJid, { text: data.reply });
      rememberBotMsg(state, r?.key?.id);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.error(`[${sessionId}] dispatch failed:`, isTimeout ? 'timeout (90s)' : err.message);
    try {
      const r = await sock.sendMessage(chatJid, { text: `⚠️ Processing error: ${isTimeout ? 'Request timed out.' : err.message}` });
      rememberBotMsg(state, r?.key?.id);
    } catch (_) {}
  } finally {
    state.processingChats.delete(chatJid);
  }
}

async function dispatchVoiceToFastAPI(state, chatJid, msg) {
  const { sessionId, sock } = state;

  if (state.processingChats.has(chatJid)) {
    try {
      const r = await sock.sendMessage(chatJid, { text: '⏳ Still processing your previous message, please wait…' });
      rememberBotMsg(state, r?.key?.id);
    } catch (_) {}
    return;
  }
  state.processingChats.add(chatJid);

  let buffer;
  try {
    buffer = await downloadMediaMessage(msg, 'buffer', {});
  } catch (e) {
    console.error(`[${sessionId}] voice download failed:`, e.message);
    state.processingChats.delete(chatJid);
    return;
  }
  if (!buffer?.length) { state.processingChats.delete(chatJid); return; }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 90_000);
  try {
    const audioMsg  = msg.message?.audioMessage || msg.message?.pttMessage || {};
    const mimetype  = audioMsg.mimetype || 'audio/ogg; codecs=opus';
    const res = await fetch(`${FASTAPI_URL}/webhooks/whatsapp-voice`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: chatJid, audio_data: buffer.toString('base64'), mimetype, is_self: true, session_id: sessionId }),
      signal:  controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) { console.error(`[${sessionId}] voice FastAPI error:`, res.status); return; }
    const data = await res.json();
    if (data.reply) {
      const r = await sock.sendMessage(chatJid, { text: data.reply });
      rememberBotMsg(state, r?.key?.id);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    try {
      const r = await sock.sendMessage(chatJid, { text: '⚠️ Voice note processing failed. Please type your message instead.' });
      rememberBotMsg(state, r?.key?.id);
    } catch (_) {}
  } finally {
    state.processingChats.delete(chatJid);
  }
}

// ── Session factory ───────────────────────────────────────────────────────────

async function startSocket(sessionId, state, retryCount = 0) {
  const authPath = path.join(AUTH_DIR, sessionId);
  fs.mkdirSync(authPath, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[${sessionId}] using WA version ${version.join('.')} (attempt ${retryCount + 1})`);

  const sock = makeWASocket({
    version,
    auth:               authState,
    printQRInTerminal:  false,
    logger:             silentLogger,
    browser:            ['Resumate', 'Chrome', '120.0.0'],
    syncFullHistory:    false,
    markOnlineOnConnect: false,
    connectTimeoutMs:   60_000,
    defaultQueryTimeoutMs: 60_000,
  });

  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ──────────────────────────────────────────────────

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr);
        console.log(`[${sessionId}] QR code generated`);
      } catch (e) {
        console.error(`[${sessionId}] QR generation failed:`, e.message);
      }
    }

    if (connection === 'close') {
      state.isReady  = false;
      state.qrDataUrl = null;
      state.sock     = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`[${sessionId}] Disconnected (code=${code}) loggedOut=${loggedOut}`);

      if (loggedOut) {
        sessions.delete(sessionId);
        fs.rmSync(authPath, { recursive: true, force: true });
      } else if (code === 405 || code === 403) {
        // Protocol rejection — clear stale auth and restart fresh to get new QR
        console.log(`[${sessionId}] Protocol rejection (${code}), clearing auth for fresh QR`);
        fs.rmSync(authPath, { recursive: true, force: true });
        const delay = Math.min(5_000 * (retryCount + 1), 30_000);
        state.cleanupTimer = setTimeout(() => {
          state.cleanupTimer = null;
          startSocket(sessionId, state, retryCount + 1).catch(e => console.error(`[${sessionId}] reconnect failed:`, e.message));
        }, delay);
      } else {
        // Wipe stale auth once a session — whether it ever connected or has
        // since degraded (e.g. repeated Bad MAC / 408 loops from a desynced
        // local session store) — has failed too many times in a row since
        // its last good connection. Without this, a previously-connected
        // session that goes bad never recovers because state.connectedPhone
        // stays set forever, masking the failure streak.
        state.failuresSinceConnect = (state.failuresSinceConnect || 0) + 1;
        if (state.failuresSinceConnect >= 10) {
          console.log(`[${sessionId}] ${state.failuresSinceConnect} consecutive failures — clearing auth for fresh QR`);
          fs.rmSync(authPath, { recursive: true, force: true });
          state.connectedPhone = null;
          state.failuresSinceConnect = 0;
        }
        // Reconnect with exponential backoff (cap 60s)
        const delay = Math.min(3_000 * Math.pow(2, retryCount), 60_000);
        console.log(`[${sessionId}] Reconnecting in ${delay}ms…`);
        state.cleanupTimer = setTimeout(() => {
          state.cleanupTimer = null;
          startSocket(sessionId, state, retryCount + 1).catch(e => console.error(`[${sessionId}] reconnect failed:`, e.message));
        }, delay);
      }
    }

    if (connection === 'open') {
      if (state.cleanupTimer) { clearTimeout(state.cleanupTimer); state.cleanupTimer = null; }
      state.isReady  = true;
      state.qrDataUrl = null;
      state.failuresSinceConnect = 0;  // session is healthy again
      retryCount = 0;  // reset so a brief drop reconnects fast

      // sock.user.id is like "923277729002:0@s.whatsapp.net"
      const rawId = sock.user?.id || '';
      state.connectedPhone = rawId.split(':')[0].split('@')[0];
      state.connectedName  = sock.user?.name || state.connectedPhone;
      state.selfJid        = `${state.connectedPhone}@s.whatsapp.net`;

      console.log(`[${sessionId}] Connected: ${state.connectedName} (+${state.connectedPhone})`);

      try {
        const r = await sock.sendMessage(state.selfJid, { text: '✅ Job agent online — send me an HR email to draft your application!' });
        rememberBotMsg(state, r?.key?.id);
        console.log(`[${sessionId}] startup ping sent to ${state.selfJid}`);
      } catch (e) {
        console.error(`[${sessionId}] startup ping failed:`, e.message);
      }
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!state.isReady) return;
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.key?.fromMe) continue;

      const remoteJid = msg.key.remoteJid || '';
      const jidPhone  = remoteJid.split('@')[0].split(':')[0];
      const isSelf    = jidPhone === state.connectedPhone;

      const msgId = msg.key.id;
      console.log(`[${sessionId}] message: jid=${remoteJid} isSelf=${isSelf} id=${msgId}`);

      if (!isSelf) continue;

      // Skip messages this bot sent
      if (msgId && state.sentByBot.has(msgId)) {
        state.sentByBot.delete(msgId);
        continue;
      }

      // Debug: show message subtype
      const msgTypes = Object.keys(msg.message || {}).join(',');
      console.log(`[${sessionId}] msg types: ${msgTypes}`);

      // Audio / PTT
      if (msg.message?.audioMessage || msg.message?.pttMessage) {
        await dispatchVoiceToFastAPI(state, remoteJid, msg);
        continue;
      }

      // Extract text from all known message shapes
      const m = msg.message || {};
      const body = (
        m.conversation                                             ||
        m.extendedTextMessage?.text                                ||
        m.ephemeralMessage?.message?.conversation                  ||
        m.ephemeralMessage?.message?.extendedTextMessage?.text     ||
        m.viewOnceMessage?.message?.conversation                   ||
        m.viewOnceMessage?.message?.extendedTextMessage?.text      ||
        m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        m.imageMessage?.caption                                    ||
        m.videoMessage?.caption                                    ||
        m.documentMessage?.caption                                 ||
        m.buttonsResponseMessage?.selectedDisplayText              ||
        m.listResponseMessage?.title                               ||
        m.templateButtonReplyMessage?.selectedDisplayText         ||
        ''
      ).trim();

      console.log(`[${sessionId}] body="${body.slice(0, 80)}" empty=${!body}`);

      if (!body) continue;
      if (BOT_PREFIXES.some(p => body.startsWith(p))) {
        console.log(`[${sessionId}] skipping bot-prefix message`);
        continue;
      }

      console.log(`[${sessionId}] dispatching: hr_email=${extractHrEmail(body)} body="${body.slice(0, 80)}"`);
      await dispatchToFastAPI(state, remoteJid, body, extractHrEmail(body), true);
    }
  });

  return sock;
}

function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[session] MAX_SESSIONS (${MAX_SESSIONS}) reached, rejecting ${sessionId}`);
    return null;
  }

  console.log(`[session] Creating new session for ${sessionId}`);

  const state = {
    sessionId,
    sock:          null,
    qrDataUrl:     null,
    isReady:       false,
    connectedPhone: null,
    connectedName:  null,
    selfJid:       null,
    processingChats: new Set(),
    sentByBot:     new Map(),
    cleanupTimer:  null,
    failuresSinceConnect: 0,
  };

  sessions.set(sessionId, state);
  startSocket(sessionId, state, 0).catch(e => {
    console.error(`[${sessionId}] startSocket failed:`, e.message);
    sessions.delete(sessionId);
  });

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
  res.json({ connected: s.isReady, phone: s.connectedPhone, name: s.connectedName, has_qr: !!s.qrDataUrl, session_id: sessionId });
});

app.get('/qr', (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const s = createSession(sessionId);
  if (!s) return res.status(503).json({ error: 'max_sessions_reached' });

  if (s.isReady)   return res.json({ qr: null, connected: true, phone: s.connectedPhone });
  if (s.qrDataUrl) return res.json({ qr: s.qrDataUrl, connected: false });
  res.json({ qr: null, connected: false, loading: true });
});

app.post('/send', async (req, res) => {
  const { session_id, to, body } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  const s = sessions.get(session_id);
  if (!s?.isReady) return res.status(503).json({ error: 'WhatsApp not connected for this session' });
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  try {
    await s.sock.sendMessage(to, { text: body });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${session_id}] send error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', async (req, res) => {
  const sessionId = req.query.session_id || req.body?.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'session not found' });
  try {
    await s.sock.logout();
    sessions.delete(sessionId);
    res.json({ ok: true });
  } catch {
    sessions.delete(sessionId);
    res.json({ ok: true, message: 'Session removed (logout may have partially failed)' });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp service HTTP API on :${PORT}`);
  console.log(`Max concurrent sessions: ${MAX_SESSIONS}`);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down…');
  await Promise.allSettled([...sessions.values()].map(s => s.sock?.logout?.()));
  process.exit(0);
});
