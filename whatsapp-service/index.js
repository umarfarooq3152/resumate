/**
 * WhatsApp Web sidecar service.
 *
 * Connects to YOUR personal WhatsApp via QR code (like WhatsApp Web).
 *
 * Two ways to trigger the agent:
 *   A) Message YOURSELF (Saved Messages / "You" chat) with:
 *        HIRE hr@company.com  <optional: job title, company, description, URL>
 *      Any message to yourself containing an email address is also accepted.
 *
 *   B) Forward any message containing an HR email to a chat the sidecar watches
 *      (controlled by WA_LISTEN_MODE).
 *
 * After the agent drafts the email it replies with a preview + action menu:
 *   APPROVE → send the email via Gmail
 *   EDIT: <instruction> → revise draft
 *   REJECT → discard
 *
 * HTTP API (for FastAPI proxy + integrations page):
 *   GET  /status          → { connected, phone, has_qr }
 *   GET  /qr              → { qr: "data:image/png;base64,..." }
 *   POST /send            → { to, body } — send a WhatsApp message
 *   POST /logout          → log out and reset session
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// ── Config ────────────────────────────────────────────────────────────────────

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';
const PORT = parseInt(process.env.WA_SERVICE_PORT || '3001', 10);

// Which chats to process for the 'message' event (non-self messages).
// 'all' = every chat; 'self' = only your own messages; or comma-separated phone IDs.
const LISTEN_MODE = process.env.WA_LISTEN_MODE || 'self';

// ── State ─────────────────────────────────────────────────────────────────────

let qrDataUrl = null;
let isReady = false;
let connectedPhone = null;
let connectedName = null;

// @lid identifier for the Saved Messages / self-chat.
// Newer WhatsApp assigns users a random @lid ID that doesn't match their phone.
// We discover it lazily the first time the bot sends a reply to the self-chat,
// or from the first inbound message_create where from === to.
let selfLidId = null;

// Prevent concurrent processing of two messages from the same chat.
const processingChats = new Set();

// Track IDs of messages sent by the bot so message_create never re-processes them.
// Emoji prefix matching (BOT_PREFIXES) can silently fail if WhatsApp normalises
// surrogate pairs or variation selectors on delivery.  ID tracking is bulletproof.
const _sentByBot = new Map(); // serialized msgId → expiry timestamp (ms)

function _rememberBotMsg(msg) {
  if (!msg?.id?._serialized) return;
  _sentByBot.set(msg.id._serialized, Date.now() + 60_000);
  // Prune expired entries to prevent unbounded growth.
  if (_sentByBot.size > 200) {
    const now = Date.now();
    for (const [k, exp] of _sentByBot) if (exp < now) _sentByBot.delete(k);
  }
}

// ── WhatsApp client ───────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
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

client.on('loading_screen', (pct, msg) => {
  process.stdout.write(`\rLoading WhatsApp... ${pct}% – ${msg}  `);
});

client.on('qr', async (qr) => {
  qrDataUrl = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('\n\nQR code generated — scan via the dashboard at /integrations\n');
  qrcode.toString(qr, { type: 'terminal', small: true }, (err, str) => {
    if (!err) console.log(str);
  });
});

client.on('authenticated', () => {
  console.log('\nAuthenticated — loading chats...');
});

client.on('ready', async () => {
  isReady = true;
  qrDataUrl = null;
  connectedPhone = client.info.wid.user;
  connectedName = client.info.pushname || connectedPhone;
  console.log(`\nWhatsApp connected: ${connectedName} (+${connectedPhone})`);
  console.log(`Listening mode: ${LISTEN_MODE}`);
  console.log('Self-trigger active: message yourself with an HR email to draft an application');

  // Discover the self-chat ID (Saved Messages). Newer WhatsApp uses @lid format
  // so client.info.wid._serialized (@c.us) doesn't match the chat ID.
  const selfId = client.info.wid._serialized;
  try {
    const chats = await client.getChats();
    // Self-chat is the only non-group chat where the chat ID equals our own ID
    // OR whose name matches ours (WhatsApp shows your own name for Saved Messages).
    const selfChat = chats.find(c =>
      !c.isGroup && (
        c.id._serialized === selfId ||
        c.id.user === selfId.split('@')[0] ||
        c.name === connectedName
      )
    );
    if (selfChat) {
      selfLidId = selfChat.id._serialized;
      console.log(`[self-chat] Discovered self-chat ID from chat list: ${selfLidId}`);
    }
  } catch (e) {
    console.log('[self-chat] Chat list lookup failed:', e.message);
  }

  // Send a startup ping to selfId so message_create fires with from===to===@lid,
  // revealing the @lid self-chat ID before the user sends their first message.
  try {
    const pingMsg = await client.sendMessage(selfId, '✅ Job agent online — send me an HR email to draft your application!');
    _rememberBotMsg(pingMsg);
    console.log('[self-chat] Startup ping sent to self — @lid will be captured from message_create');
  } catch (e) {
    console.log('[self-chat] Startup ping failed:', e.message);
  }
});

client.on('disconnected', (reason) => {
  isReady = false;
  connectedPhone = null;
  qrDataUrl = null;
  console.log('WhatsApp disconnected:', reason);
});

client.on('auth_failure', (msg) => {
  isReady = false;
  console.error('Auth failure:', msg);
});

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Map Unicode Mathematical Alphanumeric Symbols (bold/italic/sans-serif/etc.)
 * back to plain ASCII so email regexes work on stylised text.
 * e.g. 𝗵𝗶𝗿𝗶𝗻𝗴@𝘇𝗮𝗮𝗿𝗶𝗰-𝗮𝗶.𝗰𝗼𝗺 → hiring@zaaric-ai.com
 */
const _mathToAscii = (() => {
  const map = new Map();
  // Complete (hole-free) letter blocks: [unicodeRangeStart, asciiBase, count]
  const LETTER_BLOCKS = [
    [0x1D400, 65, 26], [0x1D41A, 97, 26],  // Bold
    [0x1D468, 65, 26], [0x1D482, 97, 26],  // Bold Italic
    [0x1D4D0, 65, 26], [0x1D4EA, 97, 26],  // Bold Script
    [0x1D56C, 65, 26], [0x1D586, 97, 26],  // Bold Fraktur
    [0x1D5A0, 65, 26], [0x1D5BA, 97, 26],  // Sans-Serif
    [0x1D5D4, 65, 26], [0x1D5EE, 97, 26],  // Sans-Serif Bold  ← most common in posts
    [0x1D608, 65, 26], [0x1D622, 97, 26],  // Sans-Serif Italic
    [0x1D63C, 65, 26], [0x1D656, 97, 26],  // Sans-Serif Bold Italic
    [0x1D670, 65, 26], [0x1D68A, 97, 26],  // Monospace
  ];
  const DIGIT_BLOCKS = [
    0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6,  // Bold, DS, SS, SS-Bold, Mono
  ];
  for (const [start, base, count] of LETTER_BLOCKS) {
    for (let i = 0; i < count; i++) map.set(start + i, base + i);
  }
  for (const start of DIGIT_BLOCKS) {
    for (let i = 0; i < 10; i++) map.set(start + i, 48 + i);
  }
  return map;
})();

function normalizeUnicode(text) {
  let out = '';
  for (const ch of text) {  // for…of iterates full Unicode code points (not surrogates)
    const cp = ch.codePointAt(0);
    if (_mathToAscii.has(cp)) {
      out += String.fromCharCode(_mathToAscii.get(cp));
    } else if (cp >= 0xFF01 && cp <= 0xFF5E) {
      out += String.fromCharCode(cp - 0xFF01 + 0x21);  // Fullwidth ASCII
    } else {
      out += ch;
    }
  }
  return out;
}

const EMAIL_RE = /[\w.+'%-]+@[\w.-]+\.[a-zA-Z]{2,}/g;

// Domains that belong to job boards / ATSes — never treat their addresses as HR emails.
const JOB_BOARD_DOMAINS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com',
  'ziprecruiter.com', 'workable.com', 'greenhouse.io', 'lever.co',
  'ashbyhq.com', 'bamboohr.com', 'smartrecruiters.com', 'icims.com',
  'jobvite.com', 'workday.com', 'taleo.net', 'successfactors.com',
  'noreply.com', 'notifications.linkedin.com', 'no-reply.com',
]);

// Local-part prefixes that strongly suggest this is an HR/recruiter email.
const HR_PREFIXES = ['hr', 'recruit', 'talent', 'hiring', 'careers', 'career', 'jobs', 'apply', 'people', 'join'];

/**
 * Given a message body, return the best-guess HR/recruiter email.
 * Filters out job-board addresses and prefers HR-like local-parts.
 */
function extractHrEmail(body) {
  const all = normalizeUnicode(body).match(EMAIL_RE) || [];
  if (!all.length) return null;

  // Remove job-board addresses.
  const candidates = all.filter(email => {
    const domain = (email.split('@')[1] || '').toLowerCase();
    if (JOB_BOARD_DOMAINS.has(domain)) return false;
    if ([...JOB_BOARD_DOMAINS].some(jb => domain.endsWith('.' + jb))) return false;
    return true;
  });

  const pool = candidates.length ? candidates : all; // fallback: use any email

  // Prefer addresses whose local-part looks HR-related.
  const hrMatch = pool.find(email => {
    const local = (email.split('@')[0] || '').toLowerCase();
    return HR_PREFIXES.some(p => local.startsWith(p) || local.includes(p));
  });

  return hrMatch || pool[0];
}

// Prefixes used by bot-generated replies — never re-process these.
const BOT_PREFIXES = [
  '*Draft ready', '⚠️', '✅', '⏳', '🔍',
  'Draft cancelled', 'Form submission cancelled',
  'No profile found', 'No resume found', 'Processing error',
  '*📋 Form detected', '*Form submitted', '*Dry-run complete',
  'DRY_RUN', '────',
];

/**
 * Download a voice note, send the base64 audio to FastAPI for transcription,
 * and deliver the reply back to chatId.
 */
async function dispatchVoiceToFastAPI(chatId, msg) {
  if (processingChats.has(chatId)) {
    try {
      const ping = await client.sendMessage(chatId, '⏳ Still processing your previous message, please wait…');
      _rememberBotMsg(ping);
    } catch (_) {}
    return;
  }

  processingChats.add(chatId);

  let media;
  try {
    media = await msg.downloadMedia();
  } catch (e) {
    console.error('[voice] Failed to download media:', e.message);
    processingChats.delete(chatId);
    return;
  }

  if (!media?.data) {
    console.error('[voice] Empty media data');
    processingChats.delete(chatId);
    return;
  }

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
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('[voice] FastAPI error:', res.status, await res.text());
      return;
    }

    const data = await res.json();
    if (data.reply) {
      const sent = await client.sendMessage(chatId, data.reply);
      _rememberBotMsg(sent);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.error('[voice] Dispatch failed:', isTimeout ? 'timeout (90 s)' : err.message);
    try {
      const errMsg = await client.sendMessage(chatId, '⚠️ Voice note processing failed. Please type your message instead.');
      _rememberBotMsg(errMsg);
    } catch (_) {}
  } finally {
    processingChats.delete(chatId);
  }
}

/**
 * Send the message body to FastAPI and deliver the reply back to chatId.
 */
async function dispatchToFastAPI(chatId, body, hrEmail, isSelf) {
  if (processingChats.has(chatId)) {
    try {
      const ping = await client.sendMessage(chatId, '⏳ Still processing your previous message, please wait…');
      _rememberBotMsg(ping);
    } catch (_) { /* ignore */ }
    return;
  }

  processingChats.add(chatId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(`${FASTAPI_URL}/webhooks/whatsapp-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: chatId, body, hr_email: hrEmail, is_self: isSelf }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('FastAPI error:', res.status, await res.text());
      return;
    }

    const data = await res.json();
    if (data.reply) {
      const sent = await client.sendMessage(chatId, data.reply);
      _rememberBotMsg(sent);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    const displayMsg = isTimeout ? 'Request timed out (90 s). Try again.' : err.message;
    console.error('Failed to call FastAPI:', displayMsg);
    try {
      const errMsg = await client.sendMessage(chatId, `⚠️ Processing error: ${displayMsg}`);
      _rememberBotMsg(errMsg);
    } catch (_) { /* ignore */ }
  } finally {
    processingChats.delete(chatId);
  }
}

// ── message_create — fires for every message YOU send (including to yourself) ─
//
// This is the self-trigger: send to your own "Saved Messages / You" chat with
// text like:
//   HIRE hr@company.com Software Engineer at Acme Corp
//   APPLY sarah@startup.io
//   hr@company.com  (any message containing an email also works)
//
// The agent will detect the HR email, tailor your resume, draft the email, and
// reply with a preview for you to APPROVE / EDIT / REJECT.
//
client.on('message_create', async (msg) => {
  if (!isReady || !msg.fromMe) return;

  const selfId = client.info.wid._serialized; // 923277729002@c.us
  const toId   = (msg.to   || '').toString();
  const fromId = (msg.from || '').toString();

  // ── Discover @lid self-chat ID lazily ───────────────────────────────────
  // Bot replies going TO the self-chat have from === to (both @lid of self).
  // Capture it so the next incoming user message is recognised.
  if (!selfLidId && toId.endsWith('@lid') && toId === fromId) {
    selfLidId = toId;
    console.log(`[self-chat] Discovered @lid self-chat ID from bot reply: ${selfLidId}`);
  }

  // ── Is this message going to the self-chat? ─────────────────────────────
  const isSelfChat =
    toId === selfId ||                       // older @c.us format
    (selfLidId && toId === selfLidId) ||     // newer @lid format (discovered)
    (toId.endsWith('@lid') && toId === fromId); // @lid self-send (from===to)

  // Debug every fromMe event so you can see what's firing
  console.log(`[message_create] to=${toId} from=${fromId} selfId=${selfId} selfLid=${selfLidId} isSelf=${isSelfChat} body="${(msg.body||'').slice(0,60)}"`);

  if (!isSelfChat) return;

  // Skip messages we sent — check by ID first (reliable), then fall back to
  // prefix matching (emoji encoding can differ after WhatsApp round-trips).
  const msgId = msg.id?._serialized;
  if (msgId && _sentByBot.has(msgId)) {
    _sentByBot.delete(msgId);
    return;
  }

  // Voice note (push-to-talk) — transcribe remotely and process as text
  if (msg.type === 'ptt' || msg.type === 'audio') {
    console.log(`[self-trigger] 🎤 voice note detected (type=${msg.type})`);
    await dispatchVoiceToFastAPI(selfId, msg);
    return;
  }

  const body = (msg.body || '').trim();
  if (!body) return;

  if (BOT_PREFIXES.some(p => body.startsWith(p))) return;

  const hrEmail = extractHrEmail(body);

  console.log(`[self-trigger] ✓ body="${body.slice(0, 80)}" | hr_email=${hrEmail}`);

  await dispatchToFastAPI(selfId, body, hrEmail, true);
});

// ── message — fires for messages you RECEIVE in any chat ─────────────────────

client.on('message', async (msg) => {
  if (!isReady) return;

  const selfId = client.info.wid._serialized;
  const fromId = msg.from;
  const body = (msg.body || '').trim();

  if (!body) return;

  // Decide whether to process based on LISTEN_MODE.
  const shouldProcess = (() => {
    if (LISTEN_MODE === 'all') return true;
    if (LISTEN_MODE === 'self') {
      // fromMe=true on the 'message' event means a message you sent in a group
      // that was echoed back, or a message from a linked device.
      return fromId === selfId || msg.fromMe;
    }
    return LISTEN_MODE.split(',').map(s => s.trim()).includes(fromId);
  })();

  if (!shouldProcess) return;

  // Skip bot-generated replies.
  if (msg.fromMe && BOT_PREFIXES.some(p => body.startsWith(p))) return;

  const hrEmail = extractHrEmail(body);

  await dispatchToFastAPI(fromId, body, hrEmail, msg.fromMe || fromId === selfId);
});

// ── HTTP API ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

app.get('/status', (_req, res) => {
  res.json({
    connected: isReady,
    phone: connectedPhone,
    name: connectedName,
    has_qr: !!qrDataUrl,
    listen_mode: LISTEN_MODE,
  });
});

app.get('/qr', (_req, res) => {
  if (isReady) {
    return res.json({ qr: null, connected: true, phone: connectedPhone });
  }
  if (qrDataUrl) {
    return res.json({ qr: qrDataUrl, connected: false });
  }
  res.json({ qr: null, connected: false, loading: true });
});

app.post('/send', async (req, res) => {
  const { to, body } = req.body;
  if (!isReady) return res.status(503).json({ error: 'WhatsApp not connected' });
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  try {
    await client.sendMessage(to, body);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', async (_req, res) => {
  try {
    await client.logout();
    isReady = false;
    connectedPhone = null;
    res.json({ ok: true, message: 'Logged out — restart service to reconnect' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`WhatsApp service HTTP API on :${PORT}`);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

console.log('Starting WhatsApp Web client...');
client.initialize();

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await client.destroy();
  process.exit(0);
});
