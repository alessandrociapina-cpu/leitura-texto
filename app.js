/* Leitura em Voz — PWA de Text-to-Speech 100% front-end (Google Cloud TTS) */
'use strict';

/* =====================================================================
 * Configuração
 * ===================================================================== */
const CDN = {
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  epub: 'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TTS_AUDIENCE = 'https://texttospeech.googleapis.com/';
const SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const VOICES_URL = 'https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR';

const FREE_TIER_CHARS = 1_000_000;
const CHUNK_MIN = 250;   // agrupa parágrafos curtos até este tamanho
const CHUNK_MAX = 900;   // ~1 min de áudio; bem abaixo do limite de 5000 bytes da API
const SENTENCE_MAX = 400; // frases maiores que isso são quebradas (a API recusa frases longas demais)
const PREFETCH = 2;      // trechos sintetizados à frente do atual
const AUDIO_CACHE = 40;  // trechos de áudio mantidos em memória

const FAMILY_NAME = { neural2: 'Neural2', chirp3hd: 'Chirp 3 HD' };

const FALLBACK_VOICES = {
  neural2: [
    ['pt-BR-Neural2-B', 'MALE'], ['pt-BR-Neural2-A', 'FEMALE'], ['pt-BR-Neural2-C', 'FEMALE'],
  ],
  chirp3hd: [
    ['Charon', 'MALE'], ['Kore', 'FEMALE'], ['Aoede', 'FEMALE'], ['Puck', 'MALE'], ['Fenrir', 'MALE'],
    ['Leda', 'FEMALE'], ['Orus', 'MALE'], ['Zephyr', 'FEMALE'], ['Achernar', 'FEMALE'], ['Achird', 'MALE'],
    ['Algenib', 'MALE'], ['Algieba', 'MALE'], ['Alnilam', 'MALE'], ['Autonoe', 'FEMALE'], ['Callirrhoe', 'FEMALE'],
    ['Despina', 'FEMALE'], ['Enceladus', 'MALE'], ['Erinome', 'FEMALE'], ['Gacrux', 'FEMALE'], ['Iapetus', 'MALE'],
    ['Laomedeia', 'FEMALE'], ['Pulcherrima', 'FEMALE'], ['Rasalgethi', 'MALE'], ['Sadachbia', 'MALE'],
    ['Sadaltager', 'MALE'], ['Schedar', 'MALE'], ['Sulafat', 'FEMALE'], ['Umbriel', 'MALE'],
    ['Vindemiatrix', 'FEMALE'], ['Zubenelgenubi', 'MALE'],
  ].map(([n, g]) => ['pt-BR-Chirp3-HD-' + n, g]),
};

const K = {
  creds: 'lv.credentials',
  settings: 'lv.settings',
  usage: 'lv.usage',
  voices: 'lv.voices',
  draft: 'lv.draft',
  tab: 'lv.tab',
  progress: (id) => 'lv.progress.' + id,
};

/* =====================================================================
 * Utilidades
 * ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => n.toLocaleString('pt-BR');

const store = {
  get(key, def = null) {
    try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage', e); }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

class AppError extends Error {
  constructor(message, { code = 'APP', status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let toastTimer;
function toast(msg, { error = false, ms = 3500 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? Math.max(ms, 6000) : ms);
}

function handleError(e) {
  console.error(e);
  toast(e?.message || String(e), { error: true });
  if (e?.code === 'NO_CREDS') Settings.open();
}

const scriptPromises = {};
function loadScript(src) {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scriptPromises[src]; reject(new Error('Falha ao carregar a biblioteca. Verifique sua conexão.')); };
      document.head.append(s);
    });
  }
  return scriptPromises[src];
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const textToB64url = (text) => bytesToB64url(new TextEncoder().encode(text));

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** WAV silencioso gerado em memória — usado para "destravar" o áudio no iOS dentro do toque do usuário. */
function makeSilentWavUrl() {
  const rate = 8000, samples = 400;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/* =====================================================================
 * Autenticação: Service Account → JWT RS256 (Web Crypto) → Bearer token
 * ===================================================================== */
const Auth = {
  token: null,
  exp: 0,
  mode: 'oauth', // 'oauth' = troca o JWT por access token; 'jwt' = JWT autoassinado direto na API

  creds() { return store.get(K.creds); },
  has() { return !!this.creds(); },
  reset() { this.token = null; this.exp = 0; this.mode = 'oauth'; },

  /** Valida o JSON da Service Account e devolve apenas os campos necessários. */
  parse(text) {
    let obj;
    try { obj = JSON.parse(text); } catch { throw new AppError('O conteúdo não é um JSON válido.'); }
    if (obj.type !== 'service_account') throw new AppError('Este JSON não é de uma Service Account ("type" deve ser "service_account").');
    if (!obj.private_key || !obj.client_email) throw new AppError('JSON incompleto: faltam "private_key" ou "client_email".');
    return {
      type: obj.type,
      project_id: obj.project_id || '',
      private_key_id: obj.private_key_id || '',
      client_email: obj.client_email,
      // Se o JSON veio "duplamente escapado", converte \\n literais em quebras reais.
      private_key: obj.private_key.replace(/\\n/g, '\n'),
    };
  },

  /** PEM PKCS#8 ("BEGIN PRIVATE KEY") → CryptoKey RSASSA-PKCS1-v1_5/SHA-256. */
  async importKey(pem) {
    if (!crypto?.subtle) throw new AppError('Este navegador não oferece Web Crypto (use HTTPS ou localhost).');
    if (/BEGIN RSA PRIVATE KEY/.test(pem)) throw new AppError('Chave em formato PKCS#1 não suportada. Use o JSON original baixado do Google Cloud.');
    const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
    let der;
    try { der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { throw new AppError('private_key corrompida (base64 inválido).'); }
    try {
      return await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch {
      throw new AppError('Não foi possível ler a private_key do JSON.');
    }
  },

  async signJwt(creds, claims) {
    const header = { alg: 'RS256', typ: 'JWT' };
    if (creds.private_key_id) header.kid = creds.private_key_id;
    const signingInput = textToB64url(JSON.stringify(header)) + '.' + textToB64url(JSON.stringify(claims));
    const key = await this.importKey(creds.private_key);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
    return signingInput + '.' + bytesToB64url(new Uint8Array(sig));
  },

  async getToken(force = false) {
    const creds = this.creds();
    if (!creds) throw new AppError('Configure sua chave do Google Cloud primeiro.', { code: 'NO_CREDS' });
    const now = Math.floor(Date.now() / 1000);
    if (!force && this.token && now < this.exp - 300) return this.token;

    if (this.mode === 'oauth') {
      const assertion = await this.signJwt(creds, {
        iss: creds.client_email,
        scope: OAUTH_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      });
      let res;
      try {
        res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        });
      } catch (e) {
        if (!navigator.onLine) throw new AppError('Sem conexão com a internet.');
        // Endpoint de token inacessível (rede/CORS): usa JWT autoassinado, aceito pelas APIs do Google.
        console.warn('oauth2.googleapis.com indisponível, usando JWT autoassinado.', e);
        this.mode = 'jwt';
      }
      if (res) {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new AppError(describeOAuthError(data), { code: 'AUTH', status: res.status });
        this.token = data.access_token;
        this.exp = now + (data.expires_in || 3600);
        return this.token;
      }
    }

    // JWT autoassinado ("service account authorization without OAuth")
    this.token = await this.signJwt(creds, {
      iss: creds.client_email,
      sub: creds.client_email,
      aud: TTS_AUDIENCE,
      iat: now,
      exp: now + 3600,
    });
    this.exp = now + 3600;
    return this.token;
  },
};

function describeOAuthError(data) {
  const desc = `${data.error || ''} ${data.error_description || ''}`;
  if (/signature/i.test(desc)) return 'O Google recusou a assinatura: a chave foi apagada/revogada ou o JSON está incompleto. Gere uma nova chave.';
  if (/timeframe|iat|exp|short-lived/i.test(desc)) return 'O relógio deste aparelho parece estar errado. Ajuste data/hora automáticas e tente de novo.';
  if (/invalid_client|not found|account/i.test(desc)) return 'Conta de serviço não encontrada (foi excluída?). Verifique o JSON.';
  return 'Falha na autenticação com o Google: ' + (data.error_description || data.error || 'erro desconhecido');
}

function describeApiError(status, data) {
  const err = data?.error || {};
  const msg = err.message || '';
  const all = msg + ' ' + JSON.stringify(err.details || '');
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(all))
    return 'A Cloud Text-to-Speech API não está ativada neste projeto. Ative-a em "APIs e serviços → Biblioteca" (veja Ajuda).';
  if (status === 403 && /billing/i.test(all))
    return 'O faturamento não está ativo neste projeto. Vincule uma conta de faturamento (veja Ajuda).';
  if (status === 403) return 'Acesso negado pelo Google: ' + msg;
  if (status === 401) return 'Credencial recusada pelo Google. Verifique a chave em Configurações.';
  if (status === 429) return 'Limite de uso da API atingido. Aguarde um pouco e tente de novo.';
  if (status === 400) return 'O Google recusou o pedido: ' + msg;
  return `Erro ${status} do Google${msg ? ': ' + msg : ''}`;
}

/* =====================================================================
 * Google Cloud Text-to-Speech (REST)
 * ===================================================================== */
const TTS = {
  noRateVoices: new Set(), // vozes que recusaram speakingRate → velocidade aplicada no player

  async request(url, body, retry = true) {
    const token = await Auth.getToken();
    let res;
    try {
      res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new AppError('Sem conexão com o Google. Verifique a internet.', { code: 'NET' });
    }
    if (res.status === 401 && retry) {
      Auth.token = null;
      return this.request(url, body, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(describeApiError(res.status, data), { code: 'API', status: res.status });
    return data;
  },

  /** Sintetiza um trecho. Retorna { blob (MP3), clientRate }. */
  async synthesize(text) {
    const s = Settings.data;
    const voice = Settings.voice;
    const isChirp = s.family === 'chirp3hd';
    const audioConfig = { audioEncoding: 'MP3' };
    let clientRate = 1;
    if (s.rate !== 1) {
      if (this.noRateVoices.has(voice)) clientRate = s.rate;
      else audioConfig.speakingRate = s.rate;
    }
    if (!isChirp && s.pitch) audioConfig.pitch = s.pitch; // Chirp 3 HD não aceita pitch
    const body = { input: { text }, voice: { languageCode: 'pt-BR', name: voice }, audioConfig };

    let data;
    try {
      data = await this.request(SYNTH_URL, body);
    } catch (e) {
      if (e.status === 400 && (audioConfig.speakingRate || audioConfig.pitch) && /rate|pace|pitch/i.test(e.message)) {
        this.noRateVoices.add(voice);
        delete audioConfig.speakingRate;
        delete audioConfig.pitch;
        clientRate = s.rate;
        data = await this.request(SYNTH_URL, body);
      } else {
        throw e;
      }
    }
    if (!data.audioContent) throw new AppError('O Google não retornou áudio para este trecho.');
    Usage.add(s.family, text.length);
    return { blob: b64ToBlob(data.audioContent, 'audio/mpeg'), clientRate };
  },

  async listVoices() {
    const data = await this.request(VOICES_URL);
    return (data.voices || [])
      .filter((v) => (v.languageCodes || []).includes('pt-BR'))
      .map((v) => ({ name: v.name, gender: v.ssmlGender }));
  },
};

/* =====================================================================
 * Uso estimado (caracteres enviados no mês, por tipo de voz)
 * ===================================================================== */
const Usage = {
  month: () => new Date().toISOString().slice(0, 7),
  get() {
    const u = store.get(K.usage);
    return u && u.month === this.month() ? u : { month: this.month(), neural2: 0, chirp3hd: 0 };
  },
  add(family, n) {
    const u = this.get();
    u[family] = (u[family] || 0) + n;
    store.set(K.usage, u);
  },
  reset() { store.del(K.usage); },
};

/* =====================================================================
 * Divisão do texto em trechos
 * ===================================================================== */
function cleanText(t) {
  return t.replace(/­/g, '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}

function splitSentences(t) {
  return t.match(/[^.!?…]*[.!?…]+["'”’»)\]]*\s*|[^.!?…]+$/g) || [t];
}

function splitLongSentence(s) {
  if (s.length <= SENTENCE_MAX) return [s];
  const parts = [];
  let cur = '';
  const push = (piece) => {
    if (cur && cur.length + piece.length + 1 > SENTENCE_MAX) { parts.push(cur); cur = piece; }
    else cur = cur ? cur + ' ' + piece : piece;
  };
  for (const clause of s.split(/(?<=[,;:—–])\s+/)) {
    if (clause.length > SENTENCE_MAX) clause.split(' ').forEach((w) => push(w.slice(0, 1500)));
    else push(clause);
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * blocks: [{ text, ref }] (parágrafos em ordem). ref = CFI (ePub), página (PDF) ou índice.
 * Retorna [{ text, ref }] com tamanho adequado para a API, alinhados a parágrafos sempre que possível.
 */
function makeChunks(blocks) {
  const chunks = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) chunks.push({ text: cur.text.trim(), ref: cur.ref });
    cur = null;
  };
  for (const b of blocks) {
    let t = cleanText(b.text || '');
    if (!t) continue;
    if (/[\p{L}\p{N}]$/u.test(t)) t += '.'; // títulos sem pontuação ganham uma pausa
    let firstInBlock = true;
    for (const sentence of splitSentences(t)) {
      const s = sentence.trim();
      if (!s) continue;
      const pieces = splitLongSentence(s);
      if (pieces.length > 1) {
        // Partes de uma frase longa vão em requisições separadas.
        flush();
        pieces.forEach((p) => chunks.push({ text: p, ref: b.ref }));
        firstInBlock = false;
        continue;
      }
      if (cur && cur.text.length + s.length + 1 > CHUNK_MAX) flush();
      if (!cur) cur = { text: '', ref: b.ref };
      cur.text += (cur.text ? (firstInBlock ? '\n' : ' ') : '') + s;
      firstInBlock = false;
    }
    if (cur && cur.text.length >= CHUNK_MIN) flush();
  }
  flush();
  return chunks;
}

/* =====================================================================
 * Fontes de leitura (texto colado, ePub, PDF)
 *  - unitCount / unitLabel(i): capítulos ou páginas
 *  - getUnit(i): Promise<chunks[]>
 *  - onChunk(u, c, chunk): chamado quando um trecho começa a tocar
 * ===================================================================== */
class TextSource {
  constructor(text) {
    this.kind = 'text';
    this.id = null;
    const first = cleanText(text).slice(0, 48);
    this.title = first.length < cleanText(text).length ? first + '…' : first;
    this.chunks = makeChunks(text.split(/\n+/).map((t, i) => ({ text: t, ref: i })));
    this.unitCount = 1;
  }
  unitLabel() { return 'Leitura rápida'; }
  async getUnit() { return this.chunks; }
  onChunk(u, c) { Quick.highlight(c); }
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'dt', 'dd',
  'figcaption', 'caption', 'td', 'th', 'tr', 'table', 'section', 'article', 'aside', 'header', 'footer', 'main',
  'nav', 'figure', 'ul', 'ol', 'dl', 'body']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'rt', 'rp', 'sup', 'head', 'title']);
const NOTE_RE = /noteref|footnote|endnote|rearnote/;

function isNote(el) {
  if (!el.getAttribute) return false;
  return NOTE_RE.test(el.getAttribute('epub:type') || '') || NOTE_RE.test(el.getAttribute('role') || '');
}

/** Agrupa os nós de texto pelo bloco (parágrafo) mais próximo, preservando a ordem do documento. */
function extractBlocks(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const out = [];
  let cur = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if (n.localName === 'br' && cur) cur.text += ' ';
      continue;
    }
    let block = null, skip = false;
    for (let a = n.parentNode; a && a !== root.parentNode; a = a.parentNode) {
      const tag = (a.localName || '').toLowerCase();
      if (SKIP_TAGS.has(tag) || isNote(a)) { skip = true; break; }
      if (!block && BLOCK_TAGS.has(tag)) block = a;
    }
    if (skip) continue;
    block = block || root;
    if (!cur || cur.el !== block) { cur = { el: block, text: '' }; out.push(cur); }
    cur.text += n.nodeValue;
  }
  return out.filter((b) => b.text.trim());
}

function epubThemeCss() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const fg = dark ? '#e8eaf0' : '#171a22';
  const link = dark ? '#7c9cff' : '#3355dd';
  return `:root{color-scheme:${dark ? 'dark' : 'light'}}
html,body{background:transparent!important;color:${fg}!important}
body{padding:8px 16px!important;line-height:1.65!important;font-size:1.05em}
body *{color:inherit!important;background-color:transparent!important}
a{color:${link}!important}
img,svg{max-width:100%!important;height:auto!important}`;
}

function styleEpubDoc(doc) {
  let st = doc.getElementById('lv-theme');
  if (!st) {
    st = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    st.setAttribute('id', 'lv-theme');
    (doc.head || doc.querySelector('head') || doc.documentElement).appendChild(st);
  }
  st.textContent = epubThemeCss();
}

const baseName = (href) => {
  const p = (href || '').split('#')[0];
  try { return decodeURIComponent(p).split('/').pop(); } catch { return p.split('/').pop(); }
};

class EpubSource {
  static async open(buffer, fileName) {
    await loadScript(CDN.jszip);
    await loadScript(CDN.epub);
    const s = new EpubSource();
    s.kind = 'epub';
    s.book = window.ePub(buffer);
    await s.book.ready;
    const md = s.book.packaging?.metadata || s.book.package?.metadata || {};
    s.title = md.title || fileName.replace(/\.epub$/i, '');
    s.id = 'epub:' + (md.identifier || `${fileName}:${buffer.byteLength}`);
    s.sections = [];
    s.book.spine.each((sec) => s.sections.push(sec));
    s.unitCount = s.sections.length;

    const nav = await s.book.loaded.navigation.catch(() => null);
    s.toc = [];
    const walk = (items, depth) => (items || []).forEach((it) => {
      s.toc.push({ label: (it.label || '').trim() || 'Sem título', href: it.href, depth });
      walk(it.subitems, depth + 1);
    });
    walk(nav?.toc, 0);

    const byFile = new Map();
    s.toc.forEach((t) => { const b = baseName(t.href); if (!byFile.has(b)) byFile.set(b, t.label); });
    let last = null;
    s.labels = s.sections.map((sec, i) => {
      const l = byFile.get(baseName(sec.href));
      if (l) last = l;
      return l || last || (i === 0 ? 'Início' : `Seção ${i + 1}`);
    });
    s.units = new Map();
    return s;
  }

  unitLabel(i) { return this.labels[i] || `Seção ${i + 1}`; }

  getUnit(i) {
    if (!this.units.has(i)) {
      const p = (async () => {
        const sec = this.sections[i];
        if (!sec) return [];
        const root = await sec.load(this.book.load.bind(this.book));
        const body = root.querySelector('body') || root;
        const blocks = extractBlocks(body).map((b) => {
          let ref = null;
          // Aponta para o início do texto do parágrafo (CFIs de elemento geram erros no epub.js ao exibir).
          try { ref = sec.cfiFromElement(b.el).replace(/\)$/, '/1:0)'); } catch { /* sem CFI */ }
          return { text: b.text, ref };
        });
        return makeChunks(blocks);
      })();
      this.units.set(i, p);
      p.catch(() => this.units.delete(i));
    }
    return this.units.get(i);
  }

  attach(el) {
    el.innerHTML = '';
    this.rendition = this.book.renderTo(el, {
      width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false,
    });
    this.rendition.hooks.content.register((contents) => {
      styleEpubDoc(contents.document);
      // Toque duplo em um parágrafo = ler a partir dele
      contents.document.addEventListener('dblclick', (ev) => {
        const target = ev.target?.closest?.('p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,td,div');
        if (!target) return;
        Player.unlock();
        try { BookUI.readFrom(contents.sectionIndex, contents.cfiFromNode(target)); } catch (e) { handleError(e); }
      });
    });
    this.rendition.on('relocated', (loc) => BookUI.onRelocated(loc));
  }

  applyTheme() {
    this.rendition?.getContents().forEach((c) => styleEpubDoc(c.document));
  }

  display(u, cfi) {
    return this.rendition.display(cfi || this.sections[u]?.href).catch((e) => console.warn(e));
  }

  async locationNow() {
    const loc = await Promise.resolve(this.rendition.currentLocation());
    const u = loc?.start?.index ?? 0;
    const chunks = await this.getUnit(u);
    return { u, c: findChunkByCfi(chunks, loc?.start?.cfi) };
  }

  onChunk(u, c, chunk) {
    if (BookUI.follow()) this.display(u, chunk.ref);
  }

  prevView() { this.rendition?.prev(); }
  nextView() { this.rendition?.next(); }
  goTo(value) { this.rendition?.display(value).catch((e) => console.warn(e)); }

  destroy() {
    try { this.rendition?.destroy(); } catch { /* ignore */ }
    try { this.book?.destroy(); } catch { /* ignore */ }
  }
}

/** Último trecho que começa antes (ou exatamente em) `cfi`. */
function findChunkByCfi(chunks, cfi) {
  if (!cfi || !window.ePub?.CFI) return 0;
  const C = new window.ePub.CFI();
  let idx = 0;
  chunks.forEach((ch, i) => {
    if (!ch.ref) return;
    try { if (C.compare(ch.ref, cfi) <= 0) idx = i; } catch { /* CFI incomparável */ }
  });
  return idx;
}

class PdfSource {
  static async open(buffer, fileName) {
    await loadScript(CDN.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const s = new PdfSource();
    s.kind = 'pdf';
    const size = buffer.byteLength;
    s.doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    s.id = 'pdf:' + (s.doc.fingerprints?.[0] || `${fileName}:${size}`);
    let title = '';
    try { title = (await s.doc.getMetadata())?.info?.Title || ''; } catch { /* sem metadados */ }
    s.title = title.trim() || fileName.replace(/\.pdf$/i, '');
    s.unitCount = s.doc.numPages;
    s.units = new Map();
    s.shown = 0;
    return s;
  }

  unitLabel(i) { return `Página ${i + 1} de ${this.unitCount}`; }

  getUnit(i) {
    if (!this.units.has(i)) {
      const p = this.extractPage(i);
      this.units.set(i, p);
      p.catch(() => this.units.delete(i));
    }
    return this.units.get(i);
  }

  async extractPage(i) {
    const page = await this.doc.getPage(i + 1);
    const tc = await page.getTextContent();
    const lines = [];
    let line = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      if (line && Math.abs(line.y - y) > h * 0.5) { lines.push(line); line = null; }
      if (!line) line = { text: '', y, h };
      line.text += it.str;
      if (it.hasEOL) { lines.push(line); line = null; }
    }
    if (line) lines.push(line);

    const valid = lines
      .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text && !/^\d{1,4}$/.test(l.text)); // remove números de página soltos
    const longest = Math.max(1, ...valid.map((l) => l.text.length));

    const paras = [];
    let cur = null, prev = null;
    for (const l of valid) {
      const gap = prev ? prev.y - l.y : 0;
      const newPara = !cur
        || gap > prev.h * 1.8          // espaço vertical grande
        || gap < -prev.h               // voltou para cima (nova coluna)
        || (prev.text.length < longest * 0.7 && /[.!?:…"”]$/.test(prev.text)); // linha curta terminando frase
      if (newPara) { cur = { text: l.text }; paras.push(cur); }
      else if (/[-‐]$/.test(cur.text) && /^\p{Ll}/u.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text; // hifenização
      else cur.text += ' ' + l.text;
      prev = l;
    }
    page.cleanup();
    return makeChunks(paras.map((p) => ({ text: p.text, ref: i })));
  }

  attach(el) {
    this.el = el;
    el.innerHTML = '<div class="loading">Carregando…</div>';
    this.onResize = debounce(() => this.show(this.shown), 250);
    window.addEventListener('resize', this.onResize);
  }

  applyTheme() { /* o filtro do canvas é feito via CSS */ }

  display(u) { return this.show(u); }

  async show(i) {
    i = Math.max(0, Math.min(this.unitCount - 1, i));
    this.shown = i;
    BookUI.onRelocated({ page: i });
    const page = await this.doc.getPage(i + 1);
    if (this.shown !== i) return;
    try { this.renderTask?.cancel(); } catch { /* ignore */ }
    const width = Math.max(200, this.el.clientWidth - 16);
    const scale = width / page.getViewport({ scale: 1 }).width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
    this.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    try {
      await this.renderTask.promise;
    } catch (e) {
      if (e?.name === 'RenderingCancelledException') return;
      throw e;
    }
    if (this.shown !== i) return;
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.append(canvas);
    this.el.replaceChildren(wrap);
    this.el.scrollTop = 0;
  }

  async locationNow() { return { u: this.shown, c: 0 }; }

  onChunk(u) {
    if (BookUI.follow() && u !== this.shown) this.show(u);
  }

  prevView() { this.show(this.shown - 1); }
  nextView() { this.show(this.shown + 1); }
  goTo(value) { this.show(Number(value)); }

  destroy() {
    window.removeEventListener('resize', this.onResize);
    try { this.doc?.destroy(); } catch { /* ignore */ }
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =====================================================================
 * Player: fila de áudio com pré-carregamento (sem pausas entre trechos)
 * ===================================================================== */
const audio = $('#audio');

const Player = {
  source: null,
  u: 0,
  c: 0,
  chunks: [],
  state: 'idle', // idle | loading | playing | paused
  gen: 0,        // incrementa a cada mudança de posição; cancela operações antigas
  cache: new Map(),
  silentUrl: makeSilentWavUrl(),
  unlocked: false,

  /** Deve ser chamado de forma síncrona dentro de um toque do usuário (exigência do iOS/Safari). */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    audio.src = this.silentUrl;
    audio.play().catch(() => { this.unlocked = false; });
  },

  load(source, u = 0, c = 0) {
    this.gen++;
    audio.pause();
    this.clearCache();
    this.source = source;
    this.u = u;
    this.c = c;
    this.chunks = [];
    this.setState('idle');
    this.updateInfo();
    source?.getUnit(u).then((ch) => { if (this.source === source) { this.chunks = ch; this.updateInfo(); } }).catch(() => {});
  },

  clear() {
    this.load(null);
    $('#nowLabel').textContent = 'Nada tocando';
    $('#nowText').textContent = '';
  },

  async jumpTo(source, u, c) {
    if (this.source !== source) this.load(source, u, c);
    else { this.u = u; this.c = c; }
    return this.playCurrent();
  },

  async playCurrent() {
    const gen = ++this.gen;
    const src = this.source;
    if (!src) return;
    this.setState('loading');
    try {
      let chunks = await src.getUnit(this.u);
      if (this.c >= chunks.length) {
        const n = await this.nextCursor(this.u, chunks.length - 1);
        if (gen !== this.gen) return;
        if (!n) { this.finish(); return; }
        [this.u, this.c] = n;
        chunks = await src.getUnit(this.u);
      }
      this.chunks = chunks;
      const chunk = chunks[this.c];
      this.updateInfo();
      const item = await this.fetchAudio(this.u, this.c, chunk.text);
      if (gen !== this.gen) return;
      audio.src = item.url;
      audio.defaultPlaybackRate = item.clientRate;
      audio.playbackRate = item.clientRate;
      await audio.play();
      if (gen !== this.gen) return;
      this.setState('playing');
      src.onChunk?.(this.u, this.c, chunk);
      this.saveProgress(chunk);
      this.updateMediaSession();
      this.prefetch(gen);
    } catch (e) {
      if (gen !== this.gen || e?.name === 'AbortError') return;
      this.setState('idle');
      if (e?.name === 'NotAllowedError') toast('Toque em ▶ para iniciar o áudio.');
      else handleError(e);
    }
  },

  fetchAudio(u, c, text) {
    const key = `${Settings.signature()}|${u}:${c}`;
    let p = this.cache.get(key);
    if (p) {
      this.cache.delete(key); // move para o fim (LRU)
    } else {
      p = TTS.synthesize(text).then((r) => ({ url: URL.createObjectURL(r.blob), clientRate: r.clientRate }));
      p.catch(() => this.cache.delete(key));
    }
    this.cache.set(key, p);
    while (this.cache.size > AUDIO_CACHE) {
      const [oldKey, oldP] = this.cache.entries().next().value;
      this.cache.delete(oldKey);
      oldP.then((r) => { if (audio.src !== r.url) URL.revokeObjectURL(r.url); }).catch(() => {});
    }
    return p;
  },

  clearCache() {
    for (const p of this.cache.values()) p.then((r) => URL.revokeObjectURL(r.url)).catch(() => {});
    this.cache.clear();
  },

  async prefetch(gen) {
    let cur = [this.u, this.c];
    for (let i = 0; i < PREFETCH; i++) {
      try {
        cur = await this.nextCursor(cur[0], cur[1]);
        if (!cur || gen !== this.gen) return;
        const chunks = await this.source.getUnit(cur[0]);
        await this.fetchAudio(cur[0], cur[1], chunks[cur[1]].text);
      } catch {
        return; // o erro aparece quando o trecho for tocado
      }
    }
  },

  async nextCursor(u, c) {
    const src = this.source;
    const chunks = await src.getUnit(u);
    if (c + 1 < chunks.length) return [u, c + 1];
    for (let k = u + 1; k < src.unitCount; k++) {
      if ((await src.getUnit(k)).length) return [k, 0];
    }
    return null;
  },

  async prevCursor(u, c) {
    if (c > 0) return [u, c - 1];
    for (let k = u - 1; k >= 0; k--) {
      const ch = await this.source.getUnit(k);
      if (ch.length) return [k, ch.length - 1];
    }
    return null;
  },

  async onEnded() {
    if (Sleep.expired()) { Sleep.fire(); this.setState('idle'); this.advanceSilently(); return; }
    const gen = this.gen;
    const n = await this.nextCursor(this.u, this.c).catch(() => null);
    if (gen !== this.gen) return;
    if (!n) { this.finish(); return; }
    const unitChanged = n[0] !== this.u;
    [this.u, this.c] = n;
    if (unitChanged && Sleep.mode() === 'chapter') {
      Sleep.fire();
      this.setState('idle');
      this.source.getUnit(this.u).then((ch) => { this.chunks = ch; this.updateInfo(); this.saveProgress(ch[this.c]); });
      return;
    }
    this.playCurrent();
  },

  /** Após o timer de sono, deixa o cursor no próximo trecho para retomar dali. */
  async advanceSilently() {
    const n = await this.nextCursor(this.u, this.c).catch(() => null);
    if (n) { [this.u, this.c] = n; this.chunks = await this.source.getUnit(this.u); this.updateInfo(); this.saveProgress(this.chunks[this.c]); }
  },

  finish() {
    this.setState('idle');
    toast(this.source?.kind === 'text' ? 'Fim do texto.' : 'Fim do livro. 🎉');
    this.u = 0; this.c = 0;
  },

  toggle() {
    if (this.state === 'playing') return this.pause();
    if (this.state === 'loading') { this.gen++; this.setState('idle'); return; }
    if (!this.source) {
      if (BookUI.source) { this.unlock(); BookUI.readHere(); return; }
      if ($('#quickText').value.trim()) { Quick.listen(); return; }
      toast('Cole um texto ou abra um livro para ouvir.');
      return;
    }
    if (this.state === 'paused' && audio.src && audio.src !== this.silentUrl) {
      audio.play().then(() => this.setState('playing')).catch(handleError);
      return;
    }
    this.unlock();
    this.playCurrent();
  },

  pause() {
    audio.pause();
    if (this.state === 'loading') this.gen++;
    this.setState(this.state === 'playing' ? 'paused' : 'idle');
  },

  stop() {
    this.gen++;
    audio.pause();
    this.setState('idle');
    $('#chunkBar').style.width = '0';
  },

  async next() {
    if (!this.source) return;
    this.unlock();
    const gen = ++this.gen;
    const n = await this.nextCursor(this.u, this.c).catch(() => null);
    if (gen !== this.gen) return;
    if (!n) { toast('Este é o último trecho.'); return; }
    [this.u, this.c] = n;
    this.playCurrent();
  },

  async prev() {
    if (!this.source) return;
    this.unlock();
    if (this.state === 'playing' && audio.currentTime > 3) { audio.currentTime = 0; return; }
    const gen = ++this.gen;
    const p = await this.prevCursor(this.u, this.c).catch(() => null);
    if (gen !== this.gen) return;
    if (p) [this.u, this.c] = p;
    else if (this.state !== 'playing') { toast('Início da leitura.'); }
    this.playCurrent();
  },

  saveProgress(chunk) {
    const src = this.source;
    if (!src?.id) return;
    store.set(K.progress(src.id), {
      u: this.u,
      c: this.c,
      cfi: typeof chunk?.ref === 'string' ? chunk.ref : null,
      label: src.unitLabel(this.u),
      total: src.unitCount,
      t: Date.now(),
    });
  },

  setState(s) {
    this.state = s;
    const playing = s === 'playing' || s === 'loading';
    $('#icoPlay').hidden = playing;
    $('#icoPause').hidden = !playing;
    $('#spinner').hidden = s !== 'loading';
    $('#btnPlay').setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : (s === 'paused' ? 'paused' : 'none');
  },

  updateInfo() {
    const src = this.source;
    if (!src) return;
    const pos = this.chunks.length ? ` · trecho ${this.c + 1}/${this.chunks.length}` : '';
    $('#nowLabel').textContent = src.kind === 'text'
      ? `${src.title}${pos}`
      : `${src.title} · ${src.unitLabel(this.u)}${pos}`;
    $('#nowText').textContent = this.chunks[this.c]?.text.slice(0, 160) || '';
  },

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const src = this.source;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: src.kind === 'text' ? src.title : src.unitLabel(this.u),
      artist: src.kind === 'text' ? 'Leitura rápida' : src.title,
      album: 'Leitura em Voz',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  },
};

audio.addEventListener('ended', () => {
  if (audio.src === Player.silentUrl) return;
  Player.onEnded();
});
audio.addEventListener('pause', () => {
  // pausas vindas do sistema (fone desconectado, tela de bloqueio)
  if (audio.src !== Player.silentUrl && !audio.ended && Player.state === 'playing') Player.setState('paused');
});
audio.addEventListener('play', () => {
  if (audio.src !== Player.silentUrl && Player.state === 'paused') Player.setState('playing');
});
audio.addEventListener('timeupdate', () => {
  if (audio.src === Player.silentUrl || !audio.duration) return;
  $('#chunkBar').style.width = (100 * audio.currentTime / audio.duration).toFixed(1) + '%';
  if (Sleep.expired() && Player.state === 'playing') { Player.pause(); Sleep.fire(); }
});

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => { if (Player.state !== 'playing') Player.toggle(); },
    pause: () => Player.pause(),
    previoustrack: () => Player.prev(),
    nexttrack: () => Player.next(),
    seekbackward: () => { audio.currentTime = Math.max(0, audio.currentTime - 10); },
    seekforward: () => { if (audio.duration) audio.currentTime = Math.min(audio.duration - 0.2, audio.currentTime + 10); },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* ação não suportada */ }
  }
}

/* =====================================================================
 * Timer de sono
 * ===================================================================== */
const Sleep = {
  modes: [0, 15, 30, 60, 'chapter'],
  i: 0,
  until: 0,
  mode() { return this.modes[this.i]; },
  cycle() {
    this.i = (this.i + 1) % this.modes.length;
    const m = this.mode();
    this.until = typeof m === 'number' && m ? Date.now() + m * 60000 : 0;
    const badge = $('#sleepLabel');
    badge.hidden = !m;
    badge.textContent = m === 'chapter' ? 'cap' : String(m);
    toast(!m ? 'Timer de sono desligado.' : m === 'chapter' ? 'Pausar ao fim do capítulo/página.' : `Pausar em ${m} minutos.`);
  },
  expired() { return this.until && Date.now() >= this.until; },
  fire() {
    this.i = 0;
    this.until = 0;
    $('#sleepLabel').hidden = true;
    toast('Timer de sono: leitura pausada. 🌙');
  },
};

/* =====================================================================
 * Configurações
 * ===================================================================== */
const DEFAULT_SETTINGS = {
  family: 'neural2',
  voices: { neural2: 'pt-BR-Neural2-B', chirp3hd: 'pt-BR-Chirp3-HD-Charon' },
  rate: 1,
  pitch: 0,
  theme: 'dark',
};

const Settings = {
  data: null,

  load() {
    const s = store.get(K.settings, {});
    this.data = { ...DEFAULT_SETTINGS, ...s, voices: { ...DEFAULT_SETTINGS.voices, ...(s.voices || {}) } };
  },
  save() { store.set(K.settings, this.data); },
  get voice() { return this.data.voices[this.data.family]; },
  signature() {
    const d = this.data;
    return [this.voice, d.rate, d.family === 'chirp3hd' ? 0 : d.pitch].join('|');
  },

  open() {
    this.renderCred();
    this.renderUsage();
    $('#settingsDialog').showModal();
  },

  init() {
    const d = this.data;
    $(`input[name="family"][value="${d.family}"]`).checked = true;
    $(`input[name="theme"][value="${d.theme}"]`).checked = true;
    $('#rateRange').value = d.rate;
    $('#pitchRange').value = d.pitch;
    this.renderSliders();
    this.fillVoices();

    $('#btnSettings').addEventListener('click', () => this.open());
    $$('[data-open-settings]').forEach((b) => b.addEventListener('click', () => this.open()));

    $('#keyFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.saveKey(await f.text());
    });
    $('#btnSaveKey').addEventListener('click', () => {
      const t = $('#keyText').value.trim();
      if (!t) return toast('Cole o conteúdo do JSON ou envie o arquivo.');
      this.saveKey(t);
    });
    $('#btnTestKey').addEventListener('click', () => this.test());
    $('#btnDeleteKey').addEventListener('click', () => {
      if (!Auth.has()) return;
      if (!confirm('Remover a chave salva neste aparelho?')) return;
      store.del(K.creds);
      Auth.reset();
      this.renderCred();
      toast('Chave removida deste aparelho.');
    });

    $$('input[name="family"]').forEach((r) => r.addEventListener('change', () => {
      d.family = r.value;
      this.save();
      this.fillVoices();
      this.renderSliders();
    }));
    $('#voiceSelect').addEventListener('change', (e) => { d.voices[d.family] = e.target.value; this.save(); });
    $('#rateRange').addEventListener('input', (e) => { d.rate = Number(e.target.value); this.renderSliders(); });
    $('#pitchRange').addEventListener('input', (e) => { d.pitch = Number(e.target.value); this.renderSliders(); });
    $('#rateRange').addEventListener('change', () => this.save());
    $('#pitchRange').addEventListener('change', () => this.save());
    $('#btnPreview').addEventListener('click', () => this.preview());
    $('#btnResetUsage').addEventListener('click', () => { Usage.reset(); this.renderUsage(); });
    $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => {
      d.theme = r.value;
      this.save();
      applyTheme();
    }));
  },

  renderSliders() {
    const d = this.data;
    $('#rateVal').textContent = d.rate.toFixed(2) + '×';
    $('#pitchVal').textContent = (d.pitch > 0 ? '+' : '') + d.pitch;
    const chirp = d.family === 'chirp3hd';
    $('#pitchRange').disabled = chirp;
    $('#pitchNote').hidden = !chirp;
  },

  renderCred() {
    const c = Auth.creds();
    const el = $('#credStatus');
    el.className = 'cred-status' + (c ? ' ok' : '');
    el.textContent = c ? `✓ Chave salva: ${c.client_email}` : 'Nenhuma chave salva neste aparelho.';
    $('#btnDeleteKey').disabled = !c;
    $('#btnTestKey').disabled = !c;
    $('#credBanner').hidden = !!c;
  },

  renderUsage() {
    const u = Usage.get();
    $('#usageBox').innerHTML = ['neural2', 'chirp3hd'].map((f) => {
      const n = u[f] || 0;
      const pct = Math.min(100, (n / FREE_TIER_CHARS) * 100);
      return `<div>${FAMILY_NAME[f]}: <b>${fmt(n)}</b> de ${fmt(FREE_TIER_CHARS)} caracteres grátis
        <div class="meter"><div style="width:${pct.toFixed(2)}%"></div></div></div>`;
    }).join('') + `<div class="muted small">Contagem feita só neste aparelho (mês ${u.month}). O valor oficial está no console do Google Cloud.</div>`;
  },

  async saveKey(text) {
    try {
      const creds = Auth.parse(text);
      await Auth.importKey(creds.private_key); // valida a chave antes de salvar
      store.set(K.creds, creds);
      Auth.reset();
      $('#keyText').value = '';
      this.renderCred();
      toast('Chave salva. Testando conexão…');
      await this.test();
    } catch (e) {
      handleError(e);
    }
  },

  async test() {
    const btn = $('#btnTestKey');
    btn.disabled = true;
    try {
      Auth.reset();
      await Auth.getToken(true);
      const list = await TTS.listVoices();
      store.set(K.voices, { t: Date.now(), list });
      this.fillVoices();
      const n = list.filter((v) => /Neural2|Chirp3-HD/.test(v.name)).length;
      toast(`Conexão OK ✓ — ${n} vozes Neural2/Chirp 3 HD disponíveis em pt-BR.`);
    } catch (e) {
      handleError(e);
    } finally {
      btn.disabled = !Auth.has();
    }
  },

  fillVoices() {
    const fam = this.data.family;
    const re = fam === 'neural2' ? /Neural2/ : /Chirp3-HD/;
    const cached = store.get(K.voices)?.list || [];
    let items = cached.filter((v) => re.test(v.name)).map((v) => [v.name, v.gender]);
    if (!items.length) items = FALLBACK_VOICES[fam];
    items.sort((a, b) => a[0].localeCompare(b[0]));
    const sel = $('#voiceSelect');
    sel.innerHTML = '';
    for (const [name, gender] of items) {
      const short = name.replace('pt-BR-', '').replace('Chirp3-HD-', '');
      const g = gender === 'MALE' ? 'masculina' : gender === 'FEMALE' ? 'feminina' : '';
      sel.add(new Option(g ? `${short} · ${g}` : short, name));
    }
    if (!items.some(([n]) => n === this.data.voices[fam])) {
      this.data.voices[fam] = items[0][0];
      this.save();
    }
    sel.value = this.data.voices[fam];
  },

  async preview() {
    // Elemento próprio, destravado já no toque, para não interferir no player principal.
    const a = new Audio();
    a.src = Player.silentUrl;
    a.play().catch(() => {});
    const btn = $('#btnPreview');
    btn.disabled = true;
    try {
      const short = Settings.voice.replace('pt-BR-', '').replace('Chirp3-HD-', '');
      const r = await TTS.synthesize(`Olá! Esta é a voz ${short}. Boa leitura!`);
      if (Player.state === 'playing') Player.pause();
      a.src = URL.createObjectURL(r.blob);
      a.playbackRate = r.clientRate;
      await a.play();
      this.renderUsage();
    } catch (e) {
      handleError(e);
    } finally {
      btn.disabled = false;
    }
  },
};

function applyTheme() {
  const t = Settings.data.theme;
  const eff = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = eff;
  $('meta[name="theme-color"]').setAttribute('content', eff === 'light' ? '#f6f7fb' : '#111318');
  BookUI.source?.applyTheme();
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (Settings.data.theme === 'system') applyTheme();
});

/* =====================================================================
 * Aba "Texto" (leitura rápida)
 * ===================================================================== */
const Quick = {
  source: null,

  init() {
    const ta = $('#quickText');
    ta.value = store.get(K.draft, '') || '';
    const saveDraft = debounce(() => store.set(K.draft, ta.value), 400);
    const count = () => { $('#textCount').textContent = ta.value ? `${fmt(ta.value.length)} caracteres` : ''; };
    ta.addEventListener('input', () => { saveDraft(); count(); });
    count();

    $('#btnListen').addEventListener('click', () => this.listen());
    $('#btnClearText').addEventListener('click', () => {
      ta.value = '';
      store.del(K.draft);
      count();
      $('#quickPreview').hidden = true;
      if (Player.source === this.source && this.source) Player.clear();
      this.source = null;
    });
    $('#btnPaste').addEventListener('click', async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (t) { ta.value = t; store.set(K.draft, t); count(); }
      } catch {
        toast('Não foi possível ler a área de transferência. Use o colar do teclado.');
      }
    });
    $('#quickPreview').addEventListener('click', (e) => {
      const span = e.target.closest('span[data-i]');
      if (!span || !this.source) return;
      Player.unlock();
      Player.jumpTo(this.source, 0, Number(span.dataset.i));
    });
  },

  listen() {
    const text = $('#quickText').value.trim();
    if (!text) return toast('Cole um texto primeiro.');
    if (!Auth.has()) return handleError(new AppError('Configure sua chave do Google Cloud primeiro.', { code: 'NO_CREDS' }));
    Player.unlock();
    this.source = new TextSource(text);
    if (!this.source.chunks.length) return toast('Não há texto legível.');
    this.renderPreview();
    $('#quickPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    Player.jumpTo(this.source, 0, 0);
  },

  renderPreview() {
    const box = $('#quickPreview');
    box.replaceChildren(...this.source.chunks.map((ch, i) => {
      const s = document.createElement('span');
      s.dataset.i = i;
      s.textContent = ch.text + ' ';
      return s;
    }));
    box.hidden = false;
  },

  highlight(i) {
    const box = $('#quickPreview');
    $$('span.current', box).forEach((s) => s.classList.remove('current'));
    const s = $(`span[data-i="${i}"]`, box);
    if (!s) return;
    s.classList.add('current');
    box.scrollTop = Math.max(0, s.offsetTop - 16);
  },
};

/* =====================================================================
 * Biblioteca local (IndexedDB) — guarda os arquivos abertos recentemente
 * ===================================================================== */
const DB = {
  _db: null,
  open() {
    if (!this._db) {
      this._db = new Promise((resolve, reject) => {
        const req = indexedDB.open('leitura-voz', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('books', mode);
      const req = fn(tx.objectStore('books'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  put(rec) { return this.run('readwrite', (s) => s.put(rec)); },
  get(id) { return this.run('readonly', (s) => s.get(id)); },
  del(id) { return this.run('readwrite', (s) => s.delete(id)); },
  all() { return this.run('readonly', (s) => s.getAll()); },
  async save(rec, keep = 8) {
    await this.put(rec);
    const all = (await this.all()).sort((a, b) => b.opened - a.opened);
    for (const old of all.slice(keep)) await this.del(old.id);
  },
};

/* =====================================================================
 * Aba "Livro" (ePub / PDF)
 * ===================================================================== */
const BookUI = {
  source: null,

  init() {
    $('#fileInput').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.open(f, f.name);
    });
    const dz = $('#dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) this.open(f, f.name);
    });
    $('#btnCloseBook').addEventListener('click', () => this.close());
    $('#btnReadHere').addEventListener('click', () => { Player.unlock(); this.readHere(); });
    $('#btnPrevView').addEventListener('click', () => this.source?.prevView());
    $('#btnNextView').addEventListener('click', () => this.source?.nextView());
    $('#tocSelect').addEventListener('change', (e) => this.source?.goTo(e.target.value));
    $('#recentList').addEventListener('click', (e) => this.onRecentClick(e));
    this.renderRecent();
  },

  follow() { return $('#followToggle').checked; },

  kindOf(file, name) {
    if (/\.pdf$/i.test(name) || file.type === 'application/pdf') return 'pdf';
    if (/\.epub$/i.test(name) || file.type === 'application/epub+zip') return 'epub';
    return null;
  },

  async open(file, name) {
    const kind = this.kindOf(file, name);
    if (!kind) return toast('Formato não suportado. Use arquivos .epub ou .pdf.', { error: true });
    this.close();
    showTab('book');
    $('#bookEmpty').hidden = true;
    $('#bookView').hidden = false;
    $('#bookTitle').textContent = name;
    $('#tocSelect').innerHTML = '';
    $('#viewer').innerHTML = '<div class="loading">Abrindo livro…</div>';
    try {
      const buf = await file.arrayBuffer();
      const src = kind === 'epub' ? await EpubSource.open(buf, name) : await PdfSource.open(buf, name);
      this.source = src;
      $('#bookTitle').textContent = src.title;
      this.fillToc();
      src.attach($('#viewer'));

      DB.save({ id: src.id, kind, title: src.title, name, size: file.size, blob: file, opened: Date.now() })
        .then(() => this.renderRecent())
        .catch((e) => console.warn('Biblioteca local indisponível:', e));

      let u = 0, c = 0, cfi = null;
      const prog = store.get(K.progress(src.id));
      if (prog && (prog.u > 0 || prog.c > 0) && prog.u < src.unitCount) {
        const choice = await askResume(src, prog);
        if (this.source !== src) return;
        if (choice === 'continue') ({ u, c, cfi } = prog);
        else store.del(K.progress(src.id));
      }
      await src.display(u, cfi);
      Player.load(src, u, c);
      if (kind === 'pdf') this.checkPdfHasText(src);
    } catch (e) {
      console.error(e);
      toast('Não foi possível abrir o arquivo: ' + (e.message || e), { error: true });
      this.close();
    }
  },

  async checkPdfHasText(src) {
    const n = Math.min(src.unitCount, 5);
    for (let i = 0; i < n; i++) if ((await src.getUnit(i).catch(() => [])).length) return;
    toast('Este PDF parece ser escaneado (só imagens): não há texto para ler.', { error: true });
  },

  close() {
    const src = this.source;
    if (!src) {
      $('#bookEmpty').hidden = false;
      $('#bookView').hidden = true;
      return;
    }
    if (Player.source === src) Player.clear();
    src.destroy();
    this.source = null;
    $('#viewer').innerHTML = '';
    $('#bookEmpty').hidden = false;
    $('#bookView').hidden = true;
    this.renderRecent();
  },

  fillToc() {
    const sel = $('#tocSelect');
    const src = this.source;
    sel.innerHTML = '';
    if (src.kind === 'pdf') {
      for (let i = 0; i < src.unitCount; i++) sel.add(new Option(`Página ${i + 1} de ${src.unitCount}`, i));
    } else if (src.toc.length) {
      src.toc.forEach((t) => sel.add(new Option('  '.repeat(t.depth) + t.label, t.href)));
    } else {
      src.sections.forEach((s, i) => sel.add(new Option(src.unitLabel(i), s.href)));
    }
  },

  onRelocated(loc) {
    const sel = $('#tocSelect');
    const src = this.source;
    if (!src) return;
    if (src.kind === 'pdf') { sel.value = String(loc.page); return; }
    const b = baseName(loc?.start?.href);
    const opt = [...sel.options].find((o) => baseName(o.value) === b);
    if (opt) sel.value = opt.value;
  },

  async readHere() {
    const src = this.source;
    if (!src) return;
    try {
      const { u, c } = await src.locationNow();
      Player.jumpTo(src, u, c);
    } catch (e) {
      handleError(e);
    }
  },

  async readFrom(sectionIndex, cfi) {
    const src = this.source;
    if (!src || src.kind !== 'epub') return;
    const chunks = await src.getUnit(sectionIndex);
    Player.jumpTo(src, sectionIndex, findChunkByCfi(chunks, cfi));
  },

  async renderRecent() {
    let books = [];
    try { books = (await DB.all()).sort((a, b) => b.opened - a.opened); } catch { /* IndexedDB indisponível */ }
    $('#recentTitle').hidden = !books.length;
    $('#recentList').replaceChildren(...books.map((b) => {
      const li = document.createElement('li');
      const prog = store.get(K.progress(b.id));
      const sub = prog ? (b.kind === 'pdf' ? `Parou na página ${prog.u + 1}` : `Parou em: ${prog.label}`) : 'Não iniciado';
      li.innerHTML = `<span class="kind">${b.kind.toUpperCase()}</span>
        <button class="r-open" data-id=""><span class="r-title"></span><span class="r-sub"></span></button>
        <button class="icon-btn small r-del" aria-label="Remover da lista" title="Remover da lista">✕</button>`;
      li.querySelector('.r-open').dataset.id = b.id;
      li.querySelector('.r-del').dataset.id = b.id;
      li.querySelector('.r-title').textContent = b.title;
      li.querySelector('.r-sub').textContent = sub;
      return li;
    }));
  },

  async onRecentClick(e) {
    const del = e.target.closest('.r-del');
    const open = e.target.closest('.r-open');
    if (del) {
      await DB.del(del.dataset.id).catch(() => {});
      this.renderRecent();
    } else if (open) {
      const rec = await DB.get(open.dataset.id).catch(() => null);
      if (!rec?.blob) return toast('Arquivo não encontrado. Abra-o novamente.', { error: true });
      rec.opened = Date.now();
      this.open(rec.blob, rec.name);
    }
  },
};

function askResume(src, prog) {
  const where = src.kind === 'pdf'
    ? `na página ${prog.u + 1}`
    : `no capítulo “${src.unitLabel(prog.u)}”`;
  $('#resumeText').textContent = `Você parou ${where}. Deseja continuar de onde parou ou recomeçar?`;
  const dlg = $('#resumeDialog');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'restart' ? 'restart' : 'continue'), { once: true });
  });
}

/* =====================================================================
 * Abas, atalhos e inicialização
 * ===================================================================== */
function showTab(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  store.set(K.tab, name);
}

function readShareTarget() {
  const q = new URLSearchParams(location.search);
  const parts = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean);
  if (!parts.length) return false;
  const text = [...new Set(parts)].join('\n\n');
  $('#quickText').value = text;
  store.set(K.draft, text);
  $('#quickText').dispatchEvent(new Event('input'));
  history.replaceState(null, '', location.pathname);
  return true;
}

function init() {
  Settings.load();
  applyTheme();
  Settings.init();
  Settings.renderCred();
  Quick.init();
  BookUI.init();

  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $$('[data-goto-help]').forEach((b) => b.addEventListener('click', () => showTab('help')));
  showTab(readShareTarget() ? 'text' : (store.get(K.tab) || 'text'));

  $('#btnPlay').addEventListener('click', () => Player.toggle());
  $('#btnNext').addEventListener('click', () => Player.next());
  $('#btnPrev').addEventListener('click', () => Player.prev());
  $('#btnStop').addEventListener('click', () => Player.stop());
  $('#btnSleep').addEventListener('click', () => Sleep.cycle());
  $('.player-progress').addEventListener('click', (e) => {
    if (!audio.duration || audio.src === Player.silentUrl) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, textarea, select, button, dialog')) return;
    e.preventDefault();
    Player.toggle();
  });

  // Atualiza a lista de vozes em segundo plano (no máximo 1x por semana).
  const cached = store.get(K.voices);
  if (Auth.has() && (!cached || Date.now() - cached.t > 7 * 864e5)) {
    TTS.listVoices()
      .then((list) => { store.set(K.voices, { t: Date.now(), list }); Settings.fillVoices(); })
      .catch((e) => console.warn('Lista de vozes:', e.message));
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
  }
}

init();
