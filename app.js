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
const CHUNK_MIN = 250;   // agrupa parágrafos curtos até este tamanho (só no texto colado)
const CHUNK_MAX = 900;   // ~1 min de áudio; bem abaixo do limite de 5000 bytes da API
const SENTENCE_MAX = 400; // frases maiores que isso são quebradas (a API recusa frases longas demais)
const PREFETCH = 3;      // trechos sintetizados à frente do atual (livros: 1 trecho por parágrafo)
const AUDIO_CACHE = 40;  // trechos de áudio mantidos em memória

const FAMILY_NAME = { neural2: 'Neural2', chirp3hd: 'Chirp 3 HD', openai: 'OpenAI' };

// OpenAI TTS
const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
// gpt-4o-mini-tts aceita "instructions" (sotaque, ritmo, pronúncia); tts-1-hd não aceita.
const OPENAI_MODELS = {
  'gpt-4o-mini-tts': 'gpt-4o-mini-tts · recomendado',
  'tts-1-hd': 'tts-1-hd · antigo, sem instruções',
};
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini-tts';
const OPENAI_PRICE_PER_M = 30; // tts-1-hd: US$ por 1 milhão de caracteres
const OPENAI_MINI_PER_MIN = 0.015; // gpt-4o-mini-tts: estimativa de US$ por minuto de áudio (cobrado por tokens)
const CHARS_PER_MIN = 900; // ritmo médio de narração em português
const OPENAI_VOICES_MINI = [
  ['marin', 'feminina · melhor qualidade'],
  ['cedar', 'masculina · melhor qualidade'],
  ['onyx', 'masculina, grave'],
  ['nova', 'feminina'],
  ['alloy', 'neutra'],
  ['echo', 'masculina'],
  ['fable', 'expressiva'],
  ['shimmer', 'feminina, suave'],
  ['coral', 'feminina'],
  ['ash', 'masculina'],
  ['sage', 'feminina, calma'],
  ['ballad', 'masculina, suave'],
  ['verse', 'masculina, expressiva'],
];
const OPENAI_VOICES_HD = OPENAI_VOICES_MINI.filter(([n]) => ['onyx', 'nova', 'alloy', 'echo', 'fable', 'shimmer', 'coral', 'ash', 'sage'].includes(n));
const OPENAI_DEFAULT_INSTRUCTIONS = `Leia em português do Brasil (pt-BR), com sotaque brasileiro neutro, como um narrador profissional de audiolivro de São Paulo.
Nunca use sotaque ou pronúncia de Portugal, nem de qualquer outro país, e nunca troque de idioma: mesmo palavras estrangeiras, nomes próprios e títulos curtos devem ser lidos com pronúncia brasileira.
Pronúncia do "r": entre vogais e em encontros (como em "caro", "prato") é suave, com um toque leve da língua; no início das palavras e no "rr" (como em "rato", "carro") é aspirado e leve, como um "h" suave; no fim das sílabas (como em "porta", "falar") é suave. Nunca vibre nem arraste o "r".
"S" e "z" no fim das sílabas soam como "s" (e não "x" ou "ch"). "T" e "d" antes de "i" soam como "tchi" e "dji", como no Brasil.
Ritmo calmo, natural e fluente, com pausas leves nas vírgulas e pausas maiores nos pontos. Sem engasgos, sem hesitações e sem repetir, pular ou inventar palavras. Leia exatamente o texto fornecido.`;

/** Hash curto (para a chave dos áudios guardados mudar quando as instruções mudarem). */
function shortHash(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Gemini (resumos). O modelo fica configurável porque o Google aposenta versões com frequência;
// se o escolhido não existir mais (404), tenta o apelido que sempre aponta para o Flash mais recente.
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_FALLBACK = 'gemini-flash-latest';
const geminiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const SUMMARY_MAX_CHARS = 400_000; // capítulos muito longos são cortados antes do envio

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
  gemini: 'lv.gemini',
  openai: 'lv.openai',
  summary: (id, u) => `lv.summary.${id}.${u}`,
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
  if (e?.code === 'NO_OPENAI') { Settings.open(); $('#openaiKey').focus(); }
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

  /** Sintetiza um trecho com o motor escolhido. Retorna { blob (MP3), clientRate }. */
  synthesize(text) {
    return Settings.data.engine === 'openai' ? OpenAITTS.synthesize(text) : this.synthesizeGoogle(text);
  },

  async synthesizeGoogle(text) {
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
 * OpenAI Text-to-Speech (REST) — POST /v1/audio/speech devolve o MP3 direto
 * ===================================================================== */
function describeOpenAIError(status, data) {
  const err = data?.error || {};
  const msg = err.message || '';
  if (status === 401) return 'A OpenAI API Key é inválida ou foi revogada. Confira em Configurações.';
  if (status === 429 && /insufficient_quota|quota|billing/i.test(`${err.code} ${err.type} ${msg}`))
    return 'Sua conta da OpenAI está sem créditos. Adicione créditos em platform.openai.com → Billing.';
  if (status === 429) return 'Limite de pedidos da OpenAI atingido. Aguarde um pouco e tente de novo.';
  if (status === 403) return 'A OpenAI negou acesso: a chave pode não ter permissão de áudio (chave restrita) ou o país não é suportado. ' + msg;
  if (status >= 500) return 'A OpenAI está indisponível agora. Tente de novo em instantes.';
  return `Erro ${status} da OpenAI${msg ? ': ' + msg : ''}`;
}

const OpenAITTS = {
  key() { return store.get(K.openai)?.key || ''; },
  has() { return !!this.key(); },

  async synthesize(text) {
    const key = this.key();
    if (!key) throw new AppError('Configure sua OpenAI API Key em Configurações para usar o motor OpenAI.', { code: 'NO_OPENAI' });
    const s = Settings.data;
    // Sem "speed": a velocidade é aplicada no player, então o mesmo áudio guardado serve para qualquer velocidade.
    const model = s.openaiModel || OPENAI_DEFAULT_MODEL;
    const body = { model, input: text, voice: s.openaiVoice, response_format: 'mp3' };
    if (model !== 'tts-1-hd') body.instructions = (s.openaiInstructions || '').trim() || OPENAI_DEFAULT_INSTRUCTIONS;
    let res;
    try {
      res = await fetch(OPENAI_SPEECH_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      if (!navigator.onLine) throw new AppError('Sem conexão com a internet.', { code: 'NET' });
      // A OpenAI responde "chave inválida" sem cabeçalho CORS; o navegador só vê uma falha de rede.
      throw new AppError('A OpenAI recusou o pedido. Isso costuma acontecer quando a OpenAI API Key é inválida ou foi revogada. Confira a chave em Configurações.', { code: 'OPENAI' });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new AppError(describeOpenAIError(res.status, data), { code: 'OPENAI', status: res.status });
    }
    const blob = await res.blob();
    if (!blob.size) throw new AppError('A OpenAI não retornou áudio para este trecho.');
    Usage.add(model === 'tts-1-hd' ? 'openai' : 'openaiMini', text.length);
    // clientRate null = usar a velocidade atual das configurações na hora de tocar.
    return { blob: blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mpeg' }), clientRate: null };
  },

  /** Valida a chave listando modelos (não gera áudio, não gasta créditos). */
  async check() {
    let res;
    try {
      res = await fetch(OPENAI_MODELS_URL, { headers: { Authorization: 'Bearer ' + this.key() } });
    } catch {
      throw new AppError('Sem conexão com a OpenAI. Verifique a internet.', { code: 'NET' });
    }
    // 403 = chave restrita sem permissão de listar modelos: ainda pode servir para áudio.
    if (!res.ok && res.status !== 403) {
      const data = await res.json().catch(() => ({}));
      throw new AppError(describeOpenAIError(res.status, data), { code: 'OPENAI', status: res.status });
    }
  },
};

/** Erro de credencial ausente para o motor escolhido, ou null se está tudo configurado. */
function missingTtsCreds() {
  if (Settings.data.engine === 'openai') {
    return OpenAITTS.has() ? null : new AppError('O motor OpenAI está selecionado, mas a OpenAI API Key não foi preenchida em Configurações.', { code: 'NO_OPENAI' });
  }
  return Auth.has() ? null : new AppError('O motor Google Cloud está selecionado, mas a chave JSON do Google não foi enviada em Configurações.', { code: 'NO_CREDS' });
}

/* =====================================================================
 * Uso estimado (caracteres enviados no mês, por tipo de voz)
 * ===================================================================== */
const Usage = {
  month: () => new Date().toISOString().slice(0, 7),
  get() {
    const u = store.get(K.usage);
    return u && u.month === this.month() ? u : { month: this.month(), neural2: 0, chirp3hd: 0, openai: 0 };
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
 * blocks: [{ text, ref, heading }] (parágrafos em ordem). ref = CFI (ePub), página (PDF) ou índice.
 * Retorna [{ text, ref, para, n }] com tamanho adequado para a API; para = índice do parágrafo em
 * `blocks`; n = número do parágrafo como um leitor contaria (sem títulos nem separadores; 0 = título).
 * group: junta parágrafos curtos no mesmo trecho. Sem ele (livros), todo trecho começa e termina
 * dentro de um único parágrafo, o que permite começar e parar exatamente em um parágrafo.
 */
function makeChunks(blocks, { group = true } = {}) {
  const chunks = [];
  let cur = null;
  let count = 0;
  const flush = () => {
    if (cur && cur.text.trim()) chunks.push({ text: cur.text.trim(), ref: cur.ref, para: cur.para, n: cur.n });
    cur = null;
  };
  for (const [para, b] of blocks.entries()) {
    let t = cleanText(b.text || '');
    if (!/[\p{L}\p{N}]/u.test(t)) continue; // vazio ou só símbolos ("* * *")
    const n = b.heading ? 0 : ++count;
    if (/[\p{L}\p{N}]$/u.test(t)) t += '.'; // títulos sem pontuação ganham uma pausa
    let firstInBlock = true;
    for (const sentence of splitSentences(t)) {
      const s = sentence.trim();
      if (!s) continue;
      const pieces = splitLongSentence(s);
      if (pieces.length > 1) {
        // Partes de uma frase longa vão em requisições separadas.
        flush();
        pieces.forEach((p) => chunks.push({ text: p, ref: b.ref, para, n }));
        firstInBlock = false;
        continue;
      }
      if (cur && cur.text.length + s.length + 1 > CHUNK_MAX) flush();
      if (!cur) cur = { text: '', ref: b.ref, para, n };
      cur.text += (cur.text ? (firstInBlock ? '\n' : ' ') : '') + s;
      firstInBlock = false;
    }
    if (cur && (!group || cur.text.length >= CHUNK_MIN)) flush();
  }
  flush();
  return chunks;
}

const paraLabel = (n) => (n ? `parágrafo ${n}` : 'título');

/** Começo normalizado de um parágrafo: identifica o mesmo parágrafo no livro exibido e nos trechos. */
const textKey = (t) => cleanText(t).replace(/\s+/g, '').slice(0, 32);

/** Frase de `text` que estava sendo lida quando a fração `p` (0–1) do áudio já tinha tocado. */
function sentenceAt(text, p) {
  const sentences = splitSentences(text).map((s) => s.trim()).filter(Boolean);
  const target = p * text.length;
  let acc = 0;
  for (const s of sentences) {
    acc += s.length + 1;
    if (acc > target) return s;
  }
  return sentences.at(-1) || text;
}

/* =====================================================================
 * Fontes de leitura (texto colado, ePub, PDF)
 *  - unitCount / unitLabel(i): capítulos ou páginas
 *  - getUnit(i): Promise<chunks[]>
 *  - onChunk(u, c, chunk): chamado quando um trecho começa a tocar
 * ===================================================================== */
/** Livro de verdade (ePub/PDF), em oposição a texto colado ou resumo. */
const isBook = (src) => !!src && (src.kind === 'epub' || src.kind === 'pdf');

/** Resumo de um capítulo, lido pelo mesmo player do livro. Um trecho por parágrafo/tópico do resumo. */
class SummarySource {
  constructor(book, u, text) {
    this.kind = 'summary';
    this.book = book;
    this.bookU = u;
    this.text = text;
    this.title = `Resumo · ${book.unitLabel(u)}`;
    // Áudio guardado do resumo: chave própria; "Gerar de novo" (texto novo) gera áudio novo.
    this.id = book.id ? `summary:${book.id}:${u}:${shortHash(text)}` : null;
    this.storeBook = book.id; // remover o livro da lista também apaga estes áudios
    const blocks = parseMarkdown(text);
    this.chunks = makeChunks(blocks.map((b, i) => ({ text: plainMarkdown(b.md), ref: i, heading: b.tag === 'h3' })), { group: false });
    this.unitCount = 1;
  }
  unitLabel() { return this.title; }
  async getUnit() { return this.chunks; }
  onChunk(u, c, chunk) { Summary.highlight(this, chunk.para); }
  onFinish() { Summary.afterListen(this); }
}

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
  const cur = dark ? 'rgba(124,156,255,.2)' : 'rgba(51,85,221,.13)';
  return `:root{color-scheme:${dark ? 'dark' : 'light'}}
html,body{background:transparent!important;color:${fg}!important}
body{padding:8px 16px!important;line-height:1.65!important;font-size:1.05em}
body *{color:inherit!important;background-color:transparent!important}
a{color:${link}!important}
img,svg{max-width:100%!important;height:auto!important}
body .lv-cur{background-color:${cur}!important;border-radius:4px;box-shadow:0 0 0 4px ${cur}}
body .lv-sel{outline:2px dashed ${link};outline-offset:4px;border-radius:2px}`;
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

const MARKS = ['lv-cur', 'lv-sel']; // parágrafo em leitura / escolhido como ponto de início

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
          return { text: b.text, ref, heading: /^h[1-6]$/i.test(b.el.localName || '') };
        });
        const chunks = makeChunks(blocks, { group: false });
        chunks.forEach((ch) => { ch.key = textKey(blocks[ch.para].text); });
        return chunks;
      })();
      this.units.set(i, p);
      p.catch(() => this.units.delete(i));
    }
    return this.units.get(i);
  }

  attach(el) {
    el.innerHTML = '';
    this.marks = {};
    this.viewBlockCache = new WeakMap();
    this.rendition = this.book.renderTo(el, {
      width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false,
    });
    this.rendition.hooks.content.register((contents) => {
      const doc = contents.document;
      styleEpubDoc(doc);
      MARKS.forEach((cls) => this.applyMark(contents, cls));
      // Toque em um parágrafo = escolher o ponto de início; toque duplo = ler a partir dele
      doc.addEventListener('click', (ev) => {
        if (ev.target?.closest?.('a') || doc.getSelection?.()?.isCollapsed === false) return;
        this.pickAt(contents, ev.target).then((pick) => { if (pick) BookUI.select(pick); }).catch(handleError);
      });
      doc.addEventListener('dblclick', (ev) => {
        if (ev.target?.closest?.('a')) return;
        Player.unlock();
        doc.getSelection?.()?.removeAllRanges();
        this.pickAt(contents, ev.target).then((pick) => { if (pick) BookUI.readFrom(pick); }).catch(handleError);
      });
    });
    this.rendition.on('relocated', (loc) => BookUI.onRelocated(loc));
  }

  /** Parágrafos do capítulo exibido, extraídos do mesmo jeito que os trechos de leitura. */
  viewBlocks(doc) {
    let blocks = this.viewBlockCache.get(doc);
    if (!blocks) {
      blocks = extractBlocks(doc.body || doc.documentElement);
      this.viewBlockCache.set(doc, blocks);
    }
    return blocks;
  }

  /** Trecho que começa no parágrafo tocado: { u, c, para, key, text } ou null. */
  async pickAt(contents, node) {
    const doc = contents.document;
    const blocks = this.viewBlocks(doc);
    let i = -1;
    for (let el = node; el && i < 0 && el !== doc.documentElement; el = el.parentNode) {
      i = blocks.findIndex((b) => b.el === el);
    }
    if (i < 0) return null;
    const u = contents.sectionIndex;
    const chunks = await this.getUnit(u);
    // Confere pelo texto (o navegador pode montar o HTML exibido de forma um pouco diferente).
    const key = textKey(blocks[i].text);
    let c = -1;
    chunks.forEach((ch, k) => {
      if (ch.key !== key || (k > 0 && chunks[k - 1].para === ch.para)) return;
      if (c < 0 || Math.abs(ch.para - i) < Math.abs(chunks[c].para - i)) c = k;
    });
    if (c < 0) c = chunks.findIndex((ch) => ch.para >= i); // parágrafo sem texto legível: o seguinte
    const ch = chunks[c];
    return ch ? { u, c, para: ch.para, n: ch.n, key: ch.key, text: ch.text } : null;
  }

  /** Destaca um parágrafo ({ u, para, key }) ou remove o destaque (null). cls: 'lv-cur' | 'lv-sel'. */
  mark(cls, pos) {
    this.marks[cls] = pos ? { u: pos.u, para: pos.para, key: pos.key } : null;
    this.rendition?.getContents().forEach((contents) => this.applyMark(contents, cls));
  }

  applyMark(contents, cls) {
    const doc = contents.document;
    doc.querySelectorAll('.' + cls).forEach((e) => e.classList.remove(cls));
    const pos = this.marks[cls];
    if (!pos || pos.u !== contents.sectionIndex) return;
    const blocks = this.viewBlocks(doc);
    let i = pos.para;
    if (textKey(blocks[i]?.text || '') !== pos.key) {
      const near = blocks.map((b, k) => k).filter((k) => textKey(blocks[k].text) === pos.key);
      if (near.length) i = near.reduce((a, k) => (Math.abs(k - pos.para) < Math.abs(a - pos.para) ? k : a));
    }
    blocks[i]?.el.classList.add(cls);
  }

  /** Mostra e destaca o parágrafo de um trecho. */
  reveal(u, chunk) {
    this.mark('lv-cur', { u, ...chunk });
    return this.display(u, chunk.ref);
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
    this.mark('lv-cur', { u, ...chunk });
    if (BookUI.follow() && !document.hidden) this.display(u, chunk.ref);
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
    return makeChunks(paras.map((p) => ({ text: p.text, ref: i })), { group: false });
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
    if (BookUI.follow() && !document.hidden && u !== this.shown) this.show(u);
  }

  reveal(u) { return this.show(u); }

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
  ready: new Map(), // áudios já sintetizados, acessíveis de forma síncrona (troca instantânea entre trechos)
  silentUrl: makeSilentWavUrl(),
  unlocked: false,
  stopP: 0,      // fração do trecho atual já ouvida quando a leitura foi parada

  /** Deve ser chamado de forma síncrona dentro de um toque do usuário (exigência do iOS/Safari). */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    audio.loop = false;
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
    this.stopP = 0;
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
      await this.startItem(gen, item, chunk);
    } catch (e) {
      if (gen !== this.gen || e?.name === 'AbortError') return;
      this.stopBridge();
      this.setState('idle');
      if (e?.name === 'NotAllowedError') toast('Toque em ▶ para iniciar o áudio.');
      else handleError(e);
    }
  },

  /** Troca para o áudio do trecho e toca. Não espera nada antes do play(), então pode ser
   *  chamado direto do evento 'ended' — exigência dos celulares para tocar com a tela bloqueada. */
  async startItem(gen, item, chunk) {
    const rate = item.clientRate ?? Settings.data.rate;
    audio.loop = false;
    audio.src = item.url;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    await audio.play();
    if (gen !== this.gen) return;
    this.stopP = 0;
    this.setState('playing');
    this.updateInfo();
    this.source.onChunk?.(this.u, this.c, chunk);
    this.saveProgress(chunk);
    this.updateMediaSession();
    this.prefetch(gen);
  },

  /** Toca silêncio em loop enquanto o próximo trecho é preparado. Sem isso, com a tela bloqueada,
   *  o celular encerra a sessão de áudio no intervalo e bloqueia o play() seguinte. */
  bridge() {
    audio.loop = true;
    audio.src = this.silentUrl;
    audio.play().catch(() => {});
  },

  stopBridge() {
    if (audio.src !== this.silentUrl) return;
    audio.pause();
    audio.loop = false;
  },

  audioKey(u, c) { return `${Settings.signature()}|${u}:${c}`; },

  fetchAudio(u, c, text) {
    const key = this.audioKey(u, c);
    let p = this.cache.get(key);
    if (p) {
      this.cache.delete(key); // move para o fim (LRU)
    } else {
      p = this.loadOrSynthesize(u, c, text);
      p.then((r) => { if (this.cache.get(key) === p) this.ready.set(key, r); }, () => this.cache.delete(key));
    }
    this.cache.set(key, p);
    while (this.cache.size > AUDIO_CACHE) {
      const [oldKey, oldP] = this.cache.entries().next().value;
      this.cache.delete(oldKey);
      this.ready.delete(oldKey);
      oldP.then((r) => { if (audio.src !== r.url) URL.revokeObjectURL(r.url); }).catch(() => {});
    }
    return p;
  },

  /** Usa o áudio guardado no aparelho, se houver; senão sintetiza e guarda (só livros). */
  async loadOrSynthesize(u, c, text) {
    const id = this.source?.id;
    const k = id ? AudioStore.key(id, Settings.signature(), u, c) : null;
    const saved = k && await AudioStore.get(k);
    if (saved?.blob) return { url: URL.createObjectURL(saved.blob), clientRate: saved.clientRate };
    const r = await TTS.synthesize(text);
    if (k) AudioStore.put({ k, book: this.source.storeBook || id, u, c, blob: r.blob, clientRate: r.clientRate, t: Date.now() });
    return { url: URL.createObjectURL(r.blob), clientRate: r.clientRate };
  },

  clearCache() {
    for (const p of this.cache.values()) p.then((r) => URL.revokeObjectURL(r.url)).catch(() => {});
    this.cache.clear();
    this.ready.clear();
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

  onEnded() {
    if (Sleep.expired()) { Sleep.fire(); this.setState('idle'); this.advanceSilently(); return; }
    // Caminho rápido: o próximo trecho do mesmo capítulo já foi sintetizado → toca na hora, sem intervalo.
    const nc = this.c + 1;
    const item = nc < this.chunks.length ? this.ready.get(this.audioKey(this.u, nc)) : null;
    if (item) {
      const gen = ++this.gen;
      this.c = nc;
      this.startItem(gen, item, this.chunks[nc]).catch((e) => {
        if (gen !== this.gen || e?.name === 'AbortError') return;
        this.bridge();
        this.playCurrent();
      });
      return;
    }
    // Caminho lento (trecho ainda sendo sintetizado ou troca de capítulo): silêncio até ficar pronto.
    this.bridge();
    this.advance();
  },

  async advance() {
    const gen = this.gen;
    const n = await this.nextCursor(this.u, this.c).catch(() => null);
    if (gen !== this.gen) return;
    if (!n) { this.finish(); return; }
    const unitChanged = n[0] !== this.u;
    [this.u, this.c] = n;
    if (unitChanged && Sleep.mode() === 'chapter') {
      this.stopBridge();
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
    this.stopBridge();
    this.setState('idle');
    if (this.source?.onFinish) { this.source.onFinish(); return; }
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
    const pos = this.position(); // captura a posição antes de parar o áudio
    this.gen++;
    audio.pause();
    this.setState('idle');
    $('#chunkBar').style.width = '0';
    pos.then((p) => {
      if (!p) return;
      this.stopP = p.p;
      Where.show(p);
    }).catch(() => {});
  },

  /** Onde a leitura está: { src, u, chunk, chunks, p }, p = fração já ouvida do trecho (0–1). */
  async position() {
    const src = this.source;
    if (!src) return null;
    const live = (this.state === 'playing' || this.state === 'paused')
      && audio.src && audio.src !== this.silentUrl && audio.duration;
    const p = live ? Math.min(1, audio.currentTime / audio.duration) : this.stopP;
    const { u, c } = this;
    const chunks = await src.getUnit(u);
    return chunks[c] ? { src, u, chunk: chunks[c], chunks, p } : null;
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
    if (!src?.id || !isBook(src)) return;
    store.set(K.progress(src.id), {
      u: this.u,
      c: this.c,
      cfi: typeof chunk?.ref === 'string' ? chunk.ref : null,
      n: chunk?.n ?? null,
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
    try { Summary.syncButton(); } catch { /* ainda inicializando */ }
    // 'loading' conta como tocando: se a sessão de mídia virar 'none' entre trechos, o celular some com os controles.
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : (s === 'paused' ? 'paused' : 'none');
  },

  updateInfo() {
    const src = this.source;
    if (!src) return;
    const chunk = this.chunks[this.c];
    if (!isBook(src)) {
      const pos = this.chunks.length ? ` · trecho ${this.c + 1}/${this.chunks.length}` : '';
      $('#nowLabel').textContent = `${src.title}${pos}`;
    } else {
      const pos = chunk ? ` · ${paraLabel(chunk.n)}` : '';
      $('#nowLabel').textContent = `${src.title} · ${src.unitLabel(this.u)}${pos}`;
    }
    $('#nowText').textContent = this.chunks[this.c]?.text.slice(0, 160) || '';
  },

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const src = this.source;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: isBook(src) ? src.unitLabel(this.u) : src.title,
      artist: src.kind === 'summary' ? src.book.title : src.kind === 'text' ? 'Leitura rápida' : src.title,
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
  engine: 'google', // 'google' | 'openai'
  family: 'neural2',
  openaiVoice: 'marin',
  openaiModel: OPENAI_DEFAULT_MODEL,
  openaiInstructions: '', // vazio = instruções padrão (OPENAI_DEFAULT_INSTRUCTIONS)
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
  save() { store.set(K.settings, this.data); this.renderEngineBar(); },

  setEngine(engine) {
    if (engine !== 'google' && engine !== 'openai') return;
    this.data.engine = engine;
    this.save();
    this.fillVoices();
    this.renderSliders();
    this.renderCred();
    const missing = missingTtsCreds();
    if (missing) toast(missing.message, { error: true });
    else toast(`Leitura com ${engine === 'openai' ? 'OpenAI' : 'Google Cloud'} · voz ${this.voiceShort()}`);
  },

  voiceShort() { return this.voice.replace('pt-BR-', '').replace('Chirp3-HD-', 'Chirp '); },

  /** Barra rápida abaixo das abas: motor escolhido e nome da voz. */
  renderEngineBar() {
    const d = this.data;
    $$('input[name="engine"], input[name="quickEngine"]').forEach((r) => { r.checked = r.value === d.engine; });
    const v = $('#engineVoice');
    if (v) v.textContent = this.voiceShort() + (d.rate !== 1 ?` · ${d.rate.toFixed(2).replace(/\.?0+$/, '')}×` : '');
  },
  get voice() { return this.data.engine === 'openai' ? this.data.openaiVoice : this.data.voices[this.data.family]; },
  /** Muda quando qualquer coisa que altera o áudio muda (motor, voz, velocidade, tom). */
  signature() {
    const d = this.data;
    if (d.engine === 'openai') {
      // A velocidade fica no player; o modelo, a voz e as instruções mudam o áudio gerado.
      const model = d.openaiModel || OPENAI_DEFAULT_MODEL;
      const instr = model === 'tts-1-hd' ? '' : shortHash((d.openaiInstructions || '').trim() || OPENAI_DEFAULT_INSTRUCTIONS);
      return ['openai', model, this.voice, instr].join('|');
    }
    const pitch = d.family !== 'chirp3hd' ? d.pitch : 0;
    return ['google', this.voice, d.rate, pitch].join('|');
  },

  open() {
    $(`input[name="engine"][value="${this.data.engine}"]`).checked = true;
    $(`input[name="family"][value="${this.data.family}"]`).checked = true;
    this.fillVoices();
    this.renderSliders();
    this.renderCred();
    this.renderOpenAI();
    this.renderStorage();
    this.renderGemini();
    this.renderUsage();
    $('#settingsDialog').showModal();
  },

  init() {
    const d = this.data;
    this.renderEngineBar();
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

    // Motor de voz: nas Configurações e na barra rápida da tela principal (as duas ficam sincronizadas).
    $$('input[name="engine"], input[name="quickEngine"]').forEach((r) => r.addEventListener('change', () => this.setEngine(r.value)));
    $$('input[name="family"]').forEach((r) => r.addEventListener('change', () => {
      d.family = r.value;
      this.save();
      this.fillVoices();
      this.renderSliders();
    }));
    $('#voiceSelect').addEventListener('change', (e) => {
      if (d.engine === 'openai') d.openaiVoice = e.target.value;
      else d.voices[d.family] = e.target.value;
      this.save();
    });
    $('#btnSaveOpenAI').addEventListener('click', () => this.saveOpenAI());
    const modelSel = $('#openaiModel');
    Object.entries(OPENAI_MODELS).forEach(([id, label]) => modelSel.add(new Option(label, id)));
    modelSel.value = d.openaiModel || OPENAI_DEFAULT_MODEL;
    modelSel.addEventListener('change', () => {
      d.openaiModel = modelSel.value;
      this.save();
      this.fillVoices();
      this.renderSliders();
    });
    const instr = $('#openaiInstructions');
    instr.value = (d.openaiInstructions || '').trim() || OPENAI_DEFAULT_INSTRUCTIONS;
    instr.addEventListener('change', () => {
      const v = instr.value.trim();
      d.openaiInstructions = v === OPENAI_DEFAULT_INSTRUCTIONS ? '' : v;
      this.save();
      toast('Instruções salvas. Os próximos trechos usarão as novas instruções.');
    });
    $('#btnResetInstructions').addEventListener('click', () => {
      instr.value = OPENAI_DEFAULT_INSTRUCTIONS;
      d.openaiInstructions = '';
      this.save();
      toast('Instruções padrão restauradas.');
    });
    $('#btnDeleteOpenAI').addEventListener('click', () => {
      if (!OpenAITTS.has() || !confirm('Remover a OpenAI API Key deste aparelho?')) return;
      store.del(K.openai);
      this.renderOpenAI();
      this.renderCred();
      toast('Chave da OpenAI removida deste aparelho.');
    });
    $('#openaiKey').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveOpenAI(); } // não deixa o Enter fechar o modal
    });
    $('#rateRange').addEventListener('input', (e) => {
      d.rate = Number(e.target.value);
      this.renderSliders();
      // OpenAI: a velocidade é do player, então já vale para o trecho que está tocando.
      if (d.engine === 'openai' && audio.src !== Player.silentUrl) { audio.defaultPlaybackRate = d.rate; audio.playbackRate = d.rate; }
    });
    $('#pitchRange').addEventListener('input', (e) => { d.pitch = Number(e.target.value); this.renderSliders(); });
    $('#rateRange').addEventListener('change', () => this.save());
    $('#pitchRange').addEventListener('change', () => this.save());
    $('#btnPreview').addEventListener('click', () => this.preview());
    $('#btnResetUsage').addEventListener('click', () => { Usage.reset(); this.renderUsage(); });
    $('#btnClearAudio').addEventListener('click', async () => {
      if (!confirm('Apagar todos os áudios guardados? Reouvir esses trechos vai gastar créditos/cota de novo.')) return;
      await AudioStore.clear();
      this.renderStorage();
      ChapterDownload.refresh();
      toast('Áudios guardados apagados.');
    });
    $('#btnSaveGemini').addEventListener('click', () => this.saveGemini());
    $('#btnDeleteGemini').addEventListener('click', () => {
      if (!Gemini.has() || !confirm('Remover a Gemini API Key deste aparelho?')) return;
      store.del(K.gemini);
      this.renderGemini();
      toast('Chave do Gemini removida deste aparelho.');
    });
    ['#geminiKey', '#geminiModel'].forEach((sel) => $(sel).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveGemini(); } // não deixa o Enter fechar o modal
    }));
    $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => {
      d.theme = r.value;
      this.save();
      applyTheme();
    }));
  },

  renderSliders() {
    const d = this.data;
    const openai = d.engine === 'openai';
    $('#rateVal').textContent = d.rate.toFixed(2) + '×';
    $('#pitchVal').textContent = (d.pitch > 0 ? '+' : '') + d.pitch;
    $('#googleFamily').hidden = openai;
    $('#openaiNote').hidden = !openai;
    $('#openaiOpts').hidden = !openai;
    const mini = (d.openaiModel || OPENAI_DEFAULT_MODEL) !== 'tts-1-hd';
    $('#openaiInstrBox').hidden = !mini;
    $('#openaiNote').textContent = mini
      ? 'Vozes geradas por IA. As instruções abaixo pedem leitura em português do Brasil; use "Testar voz" para conferir.'
      : 'O tts-1-hd não aceita instruções: em português pode soar com sotaque estrangeiro ou de Portugal. Prefira o gpt-4o-mini-tts.';
    $('#voiceLabel').textContent = openai ? 'Voz da OpenAI' : 'Voz (Português – Brasil)';
    const noPitch = openai || d.family === 'chirp3hd';
    $('#pitchRange').disabled = noPitch;
    $('#pitchNote').hidden = !noPitch;
    $('#pitchNote').textContent = openai
      ? 'A OpenAI não aceita ajuste de tom; o controle é ignorado.'
      : 'As vozes Chirp 3 HD não aceitam ajuste de tom; o controle é ignorado.';
  },

  async saveOpenAI() {
    const key = $('#openaiKey').value.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
    if (!key) return toast('Cole a OpenAI API Key primeiro.');
    if (key.length < 20) return toast('Essa chave parece incompleta. Confira se copiou ela inteira.', { error: true });
    store.set(K.openai, { key });
    $('#openaiKey').value = '';
    this.renderOpenAI();
    this.renderCred();
    toast('Chave salva. Testando com a OpenAI…');
    try {
      await OpenAITTS.check();
      toast('Chave da OpenAI OK ✓');
    } catch (e) {
      handleError(e);
    }
  },

  async renderStorage() {
    const { count, bytes } = await AudioStore.stats();
    const mb = (bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    $('#storageInfo').textContent = count
      ? `${fmt(count)} trechos de áudio guardados neste aparelho (${mb} MB).`
      : 'Nenhum áudio guardado ainda.';
    $('#btnClearAudio').disabled = !count;
  },

  renderOpenAI() {
    const k = OpenAITTS.key();
    const el = $('#openaiStatus');
    el.className = 'cred-status' + (k ? ' ok' : '');
    el.textContent = k ? `✓ Chave salva (termina em …${k.slice(-4)})` : 'Nenhuma chave da OpenAI salva.';
    $('#btnDeleteOpenAI').disabled = !k;
  },

  async saveGemini() {
    // Remove aspas e espaços/quebras de linha que às vezes vêm junto ao copiar.
    // O formato da chave não é validado aqui: quem decide se ela vale é o Google (teste abaixo).
    const key = $('#geminiKey').value.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
    const model = $('#geminiModel').value.trim();
    const cur = store.get(K.gemini) || {};
    if (!key && !cur.key) return toast('Cole a Gemini API Key primeiro.');
    if (key && key.length < 20) return toast('Essa chave parece incompleta. Confira se copiou ela inteira.', { error: true });
    store.set(K.gemini, { key: key || cur.key, model });
    $('#geminiKey').value = '';
    this.renderGemini();
    toast('Chave salva. Testando com o Google…');
    try {
      await Gemini.check();
      toast('Chave do Gemini OK ✓');
    } catch (e) {
      handleError(e);
    }
  },

  renderGemini() {
    const g = store.get(K.gemini);
    const el = $('#geminiStatus');
    el.className = 'cred-status' + (g?.key ? ' ok' : '');
    el.textContent = g?.key ? `✓ Chave salva (termina em …${g.key.slice(-4)})` : 'Nenhuma chave do Gemini salva.';
    $('#geminiModel').value = g?.model || '';
    $('#btnDeleteGemini').disabled = !g?.key;
  },

  renderCred() {
    const c = Auth.creds();
    const el = $('#credStatus');
    el.className = 'cred-status' + (c ? ' ok' : '');
    el.textContent = c ? `✓ Chave salva: ${c.client_email}` : 'Nenhuma chave salva neste aparelho.';
    $('#btnDeleteKey').disabled = !c;
    $('#btnTestKey').disabled = !c;
    const missing = missingTtsCreds();
    $('#credBanner').hidden = !missing;
    fitViewer();
    $('#credBannerText').textContent = missing?.code === 'NO_OPENAI'
      ? 'Motor OpenAI sem chave configurada.'
      : 'Nenhuma credencial do Google configurada.';
  },

  renderUsage() {
    const u = Usage.get();
    const hdChars = u.openai || 0;
    const miniChars = u.openaiMini || 0;
    const openaiChars = hdChars + miniChars;
    const openaiCost = (hdChars / 1e6) * OPENAI_PRICE_PER_M + (miniChars / CHARS_PER_MIN) * OPENAI_MINI_PER_MIN;
    $('#usageBox').innerHTML = ['neural2', 'chirp3hd'].map((f) => {
      const n = u[f] || 0;
      const pct = Math.min(100, (n / FREE_TIER_CHARS) * 100);
      return `<div>Google ${FAMILY_NAME[f]}: <b>${fmt(n)}</b> de ${fmt(FREE_TIER_CHARS)} caracteres grátis
        <div class="meter"><div style="width:${pct.toFixed(2)}%"></div></div></div>`;
    }).join('')
      + `<div>OpenAI (sem cota grátis): <b>${fmt(openaiChars)}</b> caracteres ≈ US$ ${openaiCost.toFixed(2)} (estimativa)</div>`
      + `<div class="muted small">Contagem feita só neste aparelho (mês ${u.month}). Os valores oficiais estão nos painéis do Google Cloud e da OpenAI.</div>`;
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
    const sel = $('#voiceSelect');
    if (this.data.engine === 'openai') {
      const voices = (this.data.openaiModel || OPENAI_DEFAULT_MODEL) === 'tts-1-hd' ? OPENAI_VOICES_HD : OPENAI_VOICES_MINI;
      sel.innerHTML = '';
      for (const [name, desc] of voices) sel.add(new Option(`${name} · ${desc}`, name));
      if (!voices.some(([n]) => n === this.data.openaiVoice)) {
        this.data.openaiVoice = voices[0][0];
        this.save();
      }
      sel.value = this.data.openaiVoice;
      return;
    }
    const fam = this.data.family;
    const re = fam === 'neural2' ? /Neural2/ : /Chirp3-HD/;
    const cached = store.get(K.voices)?.list || [];
    let items = cached.filter((v) => re.test(v.name)).map((v) => [v.name, v.gender]);
    if (!items.length) items = FALLBACK_VOICES[fam];
    items.sort((a, b) => a[0].localeCompare(b[0]));
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
      a.playbackRate = r.clientRate ?? Settings.data.rate;
      await a.play();
      this.renderUsage();
    } catch (e) {
      handleError(e);
    } finally {
      btn.disabled = false;
    }
  },
};

/** Ajusta a altura do leitor ao espaço livre entre o topo dele e o player fixo
 *  (o espaço muda com a faixa de aviso, o tamanho da tela e o teclado). */
function fitViewer() {
  const v = $('#viewer');
  if ($('#bookView').hidden || !v.offsetParent) return;
  const top = v.getBoundingClientRect().top + window.scrollY;
  const below = $('.book-nav').offsetHeight + 8 + $('#player').offsetHeight + 8;
  const h = Math.max(260, Math.floor(window.innerHeight - top - below));
  if (Math.abs(v.offsetHeight - h) < 2) return;
  v.style.height = h + 'px';
  try { BookUI.source?.rendition?.resize(); } catch { /* epub.js ainda montando */ }
}
window.addEventListener('resize', debounce(fitViewer, 150));

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
    const missing = missingTtsCreds();
    if (missing) return handleError(missing);
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
        const req = indexedDB.open('leitura-voz', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'k' }).createIndex('book', 'book');
        };
        req.onsuccess = () => {
          const db = req.result;
          // Outra aba abriu uma versão nova do banco: fecha esta conexão para não travar a atualização.
          db.onversionchange = () => { db.close(); this._db = null; };
          resolve(db);
        };
        req.onerror = () => { this._db = null; reject(req.error); };
      });
    }
    return this._db;
  },
  async run(mode, fn, store = 'books') {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
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
    for (const old of all.slice(keep)) { await this.del(old.id); await AudioStore.deleteBook(old.id); }
  },
};

/* =====================================================================
 * Áudios guardados (IndexedDB): cada trecho sintetizado de um livro fica no aparelho,
 * então reouvir não chama a API de novo (nem gasta créditos).
 * Chave: livro | motor+voz | capítulo:trecho
 * ===================================================================== */
const AudioStore = {
  warnedFull: false,
  key: (book, sig, u, c) => `${book}|${sig}|${u}:${c}`,

  /** Nunca segura a leitura: se o banco não responder em 1,5 s, segue sem o áudio guardado. */
  async get(k) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
    try { return await Promise.race([DB.run('readonly', (s) => s.get(k), 'audio'), timeout]); } catch { return null; }
  },

  async put(rec) {
    try {
      await DB.run('readwrite', (s) => s.put(rec), 'audio');
      ChapterDownload.refresh();
      if (!this.askedPersist) { this.askedPersist = true; navigator.storage?.persist?.().catch(() => {}); }
    } catch (e) {
      console.warn('Áudio não guardado:', e);
      if (!this.warnedFull && e?.name === 'QuotaExceededError') {
        this.warnedFull = true;
        toast('Sem espaço no aparelho para guardar mais áudios. Apague alguns em Configurações.', { error: true });
      }
    }
  },

  /** Quantos trechos do capítulo u já estão guardados para a voz atual. */
  async countUnit(book, sig, u) {
    const prefix = this.key(book, sig, u, '');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    try { return await DB.run('readonly', (s) => s.count(range), 'audio'); } catch { return 0; }
  },

  async deleteBook(book) {
    try {
      await DB.run('readwrite', (s) => {
        const req = s.index('book').openKeyCursor(IDBKeyRange.only(book));
        req.onsuccess = () => { const cur = req.result; if (cur) { s.delete(cur.primaryKey); cur.continue(); } };
        return null;
      }, 'audio');
    } catch (e) { console.warn(e); }
  },

  async clear() {
    try { await DB.run('readwrite', (s) => s.clear(), 'audio'); } catch (e) { console.warn(e); }
  },

  /** { count, bytes } de todos os áudios guardados. */
  async stats() {
    let count = 0, bytes = 0;
    try {
      await DB.run('readonly', (s) => {
        const req = s.openCursor();
        req.onsuccess = () => { const cur = req.result; if (cur) { count++; bytes += cur.value.blob?.size || 0; cur.continue(); } };
        return null;
      }, 'audio');
    } catch { /* IndexedDB indisponível */ }
    return { count, bytes };
  },
};

/* =====================================================================
 * "Baixar capítulo": gera e guarda o áudio do capítulo inteiro de uma vez
 * ===================================================================== */
/* =====================================================================
 * MP3: juntar os trechos guardados em um único arquivo
 * Cada trecho é um MP3 completo. Antes de concatenar, remove as etiquetas ID3 e o quadro
 * "Xing/Info/VBRI" de cada um — esse quadro guarda a duração só daquele trecho e faria
 * os tocadores mostrarem a duração errada do arquivo inteiro.
 * ===================================================================== */
const Mp3 = {
  BITRATES: {
    v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 Layer III
    v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 Layer III
  },
  RATES: { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] },

  /** Tamanho do quadro MPEG Layer III que começa em i, ou 0 se não houver um ali. */
  frameLength(b, i) {
    if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
    const ver = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    const brIdx = b[i + 2] >> 4;
    const srIdx = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return 0;
    const bitrate = (ver === 3 ? this.BITRATES.v1 : this.BITRATES.v2)[brIdx] * 1000;
    const rate = this.RATES[ver][srIdx];
    return Math.floor(((ver === 3 ? 144 : 72) * bitrate) / rate) + ((b[i + 2] >> 1) & 1);
  },

  hasTag(b, from, to, tags) {
    for (let i = from; i + 4 <= to; i++) {
      for (const t of tags) {
        if (b[i] === t.charCodeAt(0) && b[i + 1] === t.charCodeAt(1) && b[i + 2] === t.charCodeAt(2) && b[i + 3] === t.charCodeAt(3)) return true;
      }
    }
    return false;
  },

  /** Só os quadros de áudio de um MP3 (sem ID3v2, ID3v1 nem quadro Xing/Info/VBRI). */
  frames(b) {
    let start = 0;
    let end = b.length;
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // "ID3"
      const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
      start = 10 + size + (b[5] & 0x10 ? 10 : 0);
    }
    if (end - start > 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) end -= 128; // "TAG"
    let i = start;
    const limit = Math.min(end, start + 8192);
    while (i < limit && !this.frameLength(b, i)) i++;
    const len = this.frameLength(b, i);
    if (!len) return b.subarray(start, end);
    if (this.hasTag(b, i + 4, Math.min(i + len, end), ['Xing', 'Info', 'VBRI'])) i += len;
    return b.subarray(i, end);
  },

  /** Junta vários blobs MP3 em um só. */
  async join(blobs) {
    const parts = await Promise.all(blobs.map(async (bl) => this.frames(new Uint8Array(await bl.arrayBuffer()))));
    return new Blob(parts, { type: 'audio/mpeg' });
  },
};

/** Entrega um arquivo ao usuário: no iPhone/iPad abre o menu Compartilhar; nos demais, baixa direto. */
async function saveFile(file) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // usuário fechou o menu
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const safeFileName = (t) => t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'audio';

const ChapterDownload = {
  job: null,
  complete: false, // o capítulo exibido já está todo guardado → o botão vira "Exportar MP3"
  CONCURRENCY: 3,

  init() {
    $('#btnDownload').addEventListener('click', () => {
      if (this.job) this.cancel();
      else if (this.complete) this.exportMp3();
      else this.start();
    });
  },

  /** Junta os trechos guardados do capítulo exibido em um único MP3 e entrega o arquivo. */
  async exportMp3() {
    const src = BookUI.source;
    if (!src?.id || this.exporting) return;
    this.exporting = true;
    $('#downloadLabel').textContent = 'Gerando MP3…';
    try {
      const u = await this.displayedUnit(src);
      const chunks = await src.getUnit(u);
      const sig = Settings.signature();
      const blobs = [];
      for (let c = 0; c < chunks.length; c++) {
        const rec = await AudioStore.get(AudioStore.key(src.id, sig, u, c));
        if (!rec?.blob) {
          toast('Faltam trechos deste capítulo. Toque em "Baixar" para completá-lo antes de exportar.', { error: true });
          return;
        }
        blobs.push(rec.blob);
      }
      const mp3 = blobs.every((b) => /mpeg|mp3/i.test(b.type));
      const blob = mp3 ? await Mp3.join(blobs) : new Blob(blobs, { type: blobs[0]?.type || 'audio/mpeg' });
      const name = safeFileName(`${src.title} - ${src.unitLabel(u)}`) + '.mp3';
      await saveFile(new File([blob], name, { type: 'audio/mpeg' }));
      const mb = (blob.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      toast(`MP3 exportado: ${name} (${mb} MB).`);
    } catch (e) {
      handleError(e);
    } finally {
      this.exporting = false;
      this.refresh();
    }
  },

  cancel() { if (this.job) this.job.cancel = true; },

  async displayedUnit(src) {
    try { return (await src.locationNow()).u; } catch { return 0; }
  },

  async start() {
    const src = BookUI.source;
    if (!src?.id) return;
    const missing = missingTtsCreds();
    if (missing) return handleError(missing);
    const u = await this.displayedUnit(src);
    const chunks = await src.getUnit(u);
    if (!chunks.length) return toast('Não há texto para gerar áudio aqui.');
    const sig = Settings.signature();
    const job = { cancel: false, src, u, done: 0, total: chunks.length, error: null };
    this.job = job;
    this.render();
    let next = 0;
    const worker = async () => {
      while (!job.cancel && !job.error && next < chunks.length) {
        const c = next++;
        const k = AudioStore.key(src.id, sig, u, c);
        try {
          if (!(await AudioStore.get(k))) {
            const r = await TTS.synthesize(chunks[c].text);
            await AudioStore.put({ k, book: src.id, u, c, blob: r.blob, clientRate: r.clientRate, t: Date.now() });
          }
          job.done++;
          this.render();
        } catch (e) {
          job.error = e;
        }
      }
    };
    await Promise.all(Array.from({ length: this.CONCURRENCY }, worker));
    this.job = null;
    const what = src.kind === 'pdf' ? 'Página' : 'Capítulo';
    if (job.error) handleError(job.error);
    else if (job.cancel) toast(`Download interrompido (${job.done} de ${job.total} trechos guardados).`);
    else toast(`${what} guardado no aparelho ✓ Reouvir não gasta créditos.`);
    this.refresh();
  },

  render() {
    const j = this.job;
    if (!j) return;
    $('#downloadLabel').textContent = `Baixando ${j.done}/${j.total} · cancelar`;
    $('#btnDownload').classList.add('busy');
  },

  /** Atualiza o botão conforme o capítulo exibido já esteja guardado ou não. */
  refresh: debounce(async function () {
    const self = ChapterDownload;
    const btn = $('#btnDownload');
    if (self.job) return self.render();
    if (self.exporting) return;
    btn.classList.remove('busy');
    const src = BookUI.source;
    const what = src?.kind === 'pdf' ? 'página' : 'capítulo';
    if (!src?.id) { self.complete = false; $('#downloadLabel').textContent = `Baixar ${what}`; return; }
    const u = await self.displayedUnit(src);
    const chunks = await src.getUnit(u).catch(() => []);
    const saved = await AudioStore.countUnit(src.id, Settings.signature(), u);
    if (BookUI.source !== src || self.job || self.exporting) return;
    self.complete = chunks.length > 0 && saved >= chunks.length;
    btn.classList.toggle('ready', self.complete);
    btn.title = self.complete
      ? `${what[0].toUpperCase() + what.slice(1)} guardado no aparelho — exportar como um arquivo MP3`
      : `Gerar e guardar no aparelho o áudio ${what === 'página' ? 'desta página inteira' : 'deste capítulo inteiro'}`;
    $('#downloadLabel').textContent = self.complete
      ? 'Exportar MP3'
      : saved > 0 ? `Baixar ${what} (${saved}/${chunks.length})` : `Baixar ${what}`;
  }, 300),
};

/* =====================================================================
 * Aba "Livro" (ePub / PDF)
 * ===================================================================== */
const BookUI = {
  source: null,
  sel: null, // parágrafo escolhido como ponto de início: { u, c, para, key, text }

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
    $('#btnReadSel').addEventListener('click', () => { Player.unlock(); this.readFrom(this.sel); });
    $('#btnClearSel').addEventListener('click', () => this.select(null));
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
    this.select(null);
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
      $('#summaryBtnLabel').textContent = kind === 'pdf' ? 'Resumir página' : 'Resumir capítulo';
      ChapterDownload.refresh();
      fitViewer();
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
    this.select(null);
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
    ChapterDownload.refresh();
    if (src.kind === 'pdf') { sel.value = String(loc.page); return; }
    const b = baseName(loc?.start?.href);
    const opt = [...sel.options].find((o) => baseName(o.value) === b);
    if (opt) sel.value = opt.value;
  },

  /** Marca (ou desmarca, se for o mesmo) o parágrafo tocado como ponto de início da leitura. */
  select(pick) {
    const same = pick && this.sel && pick.u === this.sel.u && pick.para === this.sel.para;
    this.sel = same ? null : pick;
    this.source?.mark?.('lv-sel', this.sel);
    $('#selBar').hidden = !this.sel;
    if (this.sel) {
      const t = this.sel.text;
      const label = paraLabel(this.sel.n);
      $('#selInfo').textContent = `${label[0].toUpperCase() + label.slice(1)}: ${t.length > 90 ? t.slice(0, 90) + '…' : t}`;
    }
  },

  async readHere() {
    const src = this.source;
    if (!src) return;
    if (this.sel) return this.readFrom(this.sel);
    try {
      const { u, c } = await src.locationNow();
      Player.jumpTo(src, u, c);
    } catch (e) {
      handleError(e);
    }
  },

  readFrom(pick) {
    const src = this.source;
    if (!src || !pick) return;
    this.select(null);
    Player.jumpTo(src, pick.u, pick.c);
  },

  async renderRecent() {
    let books = [];
    try { books = (await DB.all()).sort((a, b) => b.opened - a.opened); } catch { /* IndexedDB indisponível */ }
    $('#recentTitle').hidden = !books.length;
    $('#recentList').replaceChildren(...books.map((b) => {
      const li = document.createElement('li');
      const prog = store.get(K.progress(b.id));
      const para = prog?.n ? `, parágrafo ${prog.n}` : '';
      const sub = prog ? (b.kind === 'pdf' ? `Parou na página ${prog.u + 1}${para}` : `Parou em: ${prog.label}${para}`) : 'Não iniciado';
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
      await AudioStore.deleteBook(del.dataset.id);
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
  const para = prog.n ? `, parágrafo ${prog.n}` : '';
  $('#resumeText').textContent = `Você parou ${where}${para}. Deseja continuar de onde parou ou recomeçar?`;
  const dlg = $('#resumeDialog');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'restart' ? 'restart' : 'continue'), { once: true });
  });
}

/* =====================================================================
 * "Onde parei": ponto exato da leitura, para avançar até ele em outro leitor (ex.: Kindle)
 * ===================================================================== */
const Where = {
  pos: null,

  init() {
    $('#btnCopyWhere').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.pos.search);
        toast('Trecho copiado. Cole na busca do Kindle para chegar a este ponto.');
      } catch {
        toast('Não foi possível copiar. Selecione o trecho e copie manualmente.');
      }
    });
    $('#btnShowWhere').addEventListener('click', () => {
      $('#whereDialog').close();
      const { src, u, chunk } = this.pos;
      if (BookUI.source !== src) return;
      showTab('book');
      src.reveal(u, chunk);
    });
    $('.player-info').addEventListener('click', () => {
      if (isBook(Player.source)) Player.position().then((p) => this.show(p)).catch(() => {});
    });
  },

  show(pos) {
    if (!pos || !isBook(pos.src)) return;
    const { src, u, chunk, chunks, p } = pos;
    const first = chunks.find((ch) => ch.para === chunk.para) || chunk;
    const sentence = sentenceAt(chunk.text, p);
    const atStart = first === chunk && first.text.startsWith(sentence);
    const total = chunks.reduce((m, ch) => Math.max(m, ch.n), 0);
    // Poucas palavras funcionam melhor na busca do Kindle do que a frase inteira.
    pos.search = sentence.replace(/^[\s"'“”‘’«»—–-]+/, '').split(/\s+/).slice(0, 8).join(' ');
    this.pos = pos;

    $('#whereLoc').textContent = `${src.unitLabel(u)} · ${chunk.n ? `parágrafo ${chunk.n} de ${total}` : 'título'}`;
    $('#whereStart').textContent = first.text.length > 160 ? first.text.slice(0, 160) + '…' : first.text;
    $('#whereSentenceBox').hidden = atStart;
    $('#whereSentence').textContent = sentence;
    $('#whereSearch').textContent = pos.search;
    $('#btnShowWhere').hidden = BookUI.source !== src;
    const dlg = $('#whereDialog');
    if (!dlg.open) dlg.showModal();
  },
};

/* =====================================================================
 * Resumo de capítulo com a API Gemini (REST, direto do navegador)
 * ===================================================================== */
function describeGeminiError(status, data, model) {
  const err = data?.error || {};
  const msg = err.message || '';
  const all = msg + ' ' + JSON.stringify(err.details || '');
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(all)) return 'A Gemini API Key é inválida ou expirou. Confira em Configurações.';
  if (status === 402) return 'Os créditos pré-pagos do Gemini deste projeto acabaram (erro 402). Adicione créditos no faturamento do AI Studio ou crie uma chave em um projeto novo, sem faturamento, para usar o nível gratuito.';
  if (status === 429) return 'Cota do Gemini excedida (limite por minuto ou por dia do nível gratuito). Aguarde um pouco e tente de novo.';
  if (status === 403) return 'O Google negou acesso ao Gemini: a chave pode estar restrita a outros sites/APIs ou a API está desativada. ' + msg;
  if (status === 404) return `Modelo "${model}" não encontrado. Ajuste o modelo em Configurações.`;
  if (status === 400 && /location|region|country/i.test(msg)) return 'O Gemini não está disponível na sua região para esta chave.';
  if (status >= 500) return 'O Gemini está indisponível ou sobrecarregado agora. Tente de novo em instantes.';
  return `Erro ${status} do Gemini${msg ? ': ' + msg : ''}`;
}

const Gemini = {
  has() { return !!store.get(K.gemini)?.key; },

  /** Valida a chave listando modelos (não gera texto, não consome cota de geração). */
  async check() {
    const key = store.get(K.gemini)?.key;
    let res;
    try {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
    } catch {
      throw new AppError('Sem conexão com o Gemini. Verifique a internet.', { code: 'NET' });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new AppError(describeGeminiError(res.status, data, ''), { code: 'GEMINI', status: res.status });
    }
  },

  async summarize(prompt) {
    const cfg = store.get(K.gemini) || {};
    if (!cfg.key) throw new AppError('Configure sua Gemini API Key em Configurações para gerar resumos.', { code: 'NO_GEMINI' });
    const models = [...new Set([cfg.model || GEMINI_MODEL, GEMINI_FALLBACK])];
    let lastErr;
    for (const model of models) {
      try {
        return { text: await this.generate(model, cfg.key, prompt), model };
      } catch (e) {
        lastErr = e;
        if (e.status !== 404) throw e;
      }
    }
    throw lastErr;
  },

  async generate(model, key, prompt) {
    let res;
    try {
      // A chave vai no cabeçalho x-goog-api-key (equivale ao ?key=, mas não fica em URLs e históricos).
      res = await fetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      });
    } catch {
      throw new AppError('Sem conexão com o Gemini. Verifique a internet.', { code: 'NET' });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(describeGeminiError(res.status, data, model), { code: 'GEMINI', status: res.status });
    const blocked = data.promptFeedback?.blockReason;
    if (blocked) throw new AppError(`O Gemini recusou este texto (${blocked}).`);
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
    if (!text) {
      throw new AppError(cand?.finishReason === 'SAFETY'
        ? 'O Gemini bloqueou o resumo pelos filtros de segurança.'
        : 'O Gemini não retornou texto. Tente de novo.');
    }
    return text;
  },
};

/** Markdown simples → blocos [{ tag: 'h3' | 'p' | 'li', md }] (um por título, parágrafo ou tópico). */
function parseMarkdown(md) {
  const blocks = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (li) blocks.push({ tag: 'li', md: li[1] });
    else if (h) blocks.push({ tag: 'h3', md: h[1] });
    else if (line.trim()) blocks.push({ tag: 'p', md: line.trim() });
  }
  return blocks;
}

/** Texto para leitura em voz: sem marcas de negrito/itálico. */
const plainMarkdown = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])[*_](?!\s)(.+?)[*_](?![*\w])/g, '$1$2');

/** Markdown simples (títulos, listas, negrito, itálico) → HTML seguro (tudo é escapado antes).
 *  Cada bloco recebe data-b com seu índice, para destacar o trecho em leitura. */
function renderMarkdown(md) {
  const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])[*_](?!\s)(.+?)[*_](?![*\w])/g, '$1<em>$2</em>');
  const out = [];
  let inList = false;
  parseMarkdown(md).forEach((b, i) => {
    if (b.tag === 'li' && !inList) { out.push('<ul>'); inList = true; }
    if (b.tag !== 'li' && inList) { out.push('</ul>'); inList = false; }
    out.push(`<${b.tag} data-b="${i}">${inline(b.md)}</${b.tag}>`);
  });
  if (inList) out.push('</ul>');
  return out.join('');
}

const Summary = {
  ctx: null,
  gen: 0,

  init() {
    $('#btnSummary').addEventListener('click', () => this.open());
    $('#btnSummaryRedo').addEventListener('click', () => this.open(true));
    $('#btnSummaryListen').addEventListener('click', () => this.listen());
    $('#btnSummaryCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.ctx?.text || '');
        toast('Resumo copiado.');
      } catch {
        toast('Não foi possível copiar. Selecione o texto e copie manualmente.');
      }
    });
    $('#btnSummaryKey').addEventListener('click', () => {
      $('#summaryDialog').close();
      Settings.open();
      $('#geminiKey').focus();
    });
  },

  /** Texto do capítulo/página: trechos do mesmo parágrafo juntos, parágrafos separados por linha em branco. */
  async unitText(src, u) {
    const chunks = await src.getUnit(u);
    let text = '';
    chunks.forEach((ch, i) => {
      const samePara = i > 0 && ch.para != null && ch.para === chunks[i - 1].para;
      text += (i === 0 ? '' : samePara ? ' ' : '\n\n') + ch.text;
    });
    return text;
  },

  buildPrompt(src, label, text) {
    const what = src.kind === 'pdf'
      ? 'da seguinte página de um livro ou documento, destacando os pontos e eventos principais e, se houver, o desenvolvimento dos personagens'
      : 'do seguinte capítulo de livro, destacando os eventos principais e o desenvolvimento dos personagens';
    return `Faça um resumo conciso e detalhado ${what}.
Responda em português do Brasil, em Markdown simples: parágrafos curtos e, se ajudar, uma lista de tópicos. Não invente nada que não esteja no texto.

Livro: ${src.title}
${src.kind === 'pdf' ? label : 'Capítulo: ' + label}

${text}`;
  },

  async open(force = false) {
    const src = BookUI.source;
    if (!src) return;
    const gen = ++this.gen;
    let u = 0;
    try { ({ u } = await src.locationNow()); } catch { /* usa o início */ }
    const label = src.unitLabel(u);
    this.ctx = { src, u, text: '' };

    $('#summaryTitle').textContent = src.kind === 'pdf' ? 'Resumo da página' : 'Resumo do capítulo';
    $('#summaryMeta').textContent = `${src.title} · ${label}`;
    const dlg = $('#summaryDialog');
    if (!dlg.open) dlg.showModal();

    const cacheKey = K.summary(src.id, u);
    const cached = !force && store.get(cacheKey);
    if (cached?.text) return this.show(cached);
    if (!Gemini.has()) {
      return this.fail(new AppError('Para gerar resumos, cole sua Gemini API Key em Configurações. Veja na Ajuda como criar uma de graça.', { code: 'NO_GEMINI' }));
    }

    this.setView('loading');
    try {
      let text = await this.unitText(src, u);
      if (!text.trim()) throw new AppError(src.kind === 'pdf' ? 'Esta página não tem texto para resumir.' : 'Este capítulo não tem texto para resumir.');
      if (text.length > SUMMARY_MAX_CHARS) text = text.slice(0, SUMMARY_MAX_CHARS) + '\n\n[texto cortado por ser muito longo]';
      const r = await Gemini.summarize(this.buildPrompt(src, label, text));
      const rec = { text: r.text, model: r.model, t: Date.now() };
      store.set(cacheKey, rec); // guarda mesmo se o modal já foi fechado
      if (gen === this.gen && this.ctx?.src === src) this.show(rec);
    } catch (e) {
      if (gen === this.gen) this.fail(e);
    }
  },

  /** O resumo exibido é o que está carregado no player? */
  isPlayingThis() {
    const ps = Player.source;
    return ps?.kind === 'summary' && this.ctx && ps.book === this.ctx.src && ps.bookU === this.ctx.u && ps.text === this.ctx.text;
  },

  /** Ouvir / pausar / continuar o resumo exibido, no mesmo player do livro. */
  listen() {
    if (!this.ctx?.text) return;
    if (this.isPlayingThis()) {
      if (Player.state === 'playing' || Player.state === 'loading') Player.pause();
      else Player.toggle();
      return;
    }
    const missing = missingTtsCreds();
    if (missing) { $('#summaryDialog').close(); return handleError(missing); }
    Player.unlock();
    const { src, u, text } = this.ctx;
    const s = new SummarySource(src, u, text);
    if (!s.chunks.length) return toast('O resumo não tem texto para ler.');
    // Guarda onde o livro estava, para voltar a ele quando o resumo acabar.
    const prev = Player.source;
    s.resume = isBook(prev) ? { source: prev, u: Player.u, c: Player.c } : prev?.kind === 'summary' ? prev.resume : null;
    Player.jumpTo(s, 0, 0);
  },

  highlight(source, para) {
    const body = $('#summaryBody');
    $$('[data-b].reading', body).forEach((el) => el.classList.remove('reading'));
    if (!this.ctx || source.text !== this.ctx.text || para == null) return;
    const el = $(`[data-b="${para}"]`, body);
    if (!el) return;
    el.classList.add('reading');
    if ($('#summaryDialog').open) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  afterListen(source) {
    $$('#summaryBody [data-b].reading').forEach((el) => el.classList.remove('reading'));
    const back = source.resume;
    if (back && BookUI.source === back.source) {
      Player.load(back.source, back.u, back.c);
      toast('Fim do resumo. Toque em ▶ para continuar o livro de onde parou.');
    } else {
      toast('Fim do resumo.');
    }
  },

  /** Rótulo do botão conforme o estado do player. */
  syncButton() {
    const btn = $('#btnSummaryListen');
    if (!btn) return;
    const mine = this.isPlayingThis();
    const playing = mine && (Player.state === 'playing' || Player.state === 'loading');
    btn.textContent = playing ? '❚❚ Pausar' : mine && Player.state === 'paused' ? '▶ Continuar' : '▶ Ouvir resumo';
  },

  setView(view) {
    $('#summaryLoading').hidden = view !== 'loading';
    $('#summaryError').hidden = view !== 'error';
    $('#summaryBody').hidden = view !== 'done';
    $('#btnSummaryCopy').hidden = view !== 'done';
    $('#btnSummaryListen').hidden = view !== 'done';
    this.syncButton();
    $('#btnSummaryRedo').hidden = view === 'loading';
    $('#btnSummaryKey').hidden = true;
  },

  show(rec) {
    this.ctx.text = rec.text;
    $('#summaryBody').innerHTML = renderMarkdown(rec.text)
      + `<p class="muted small">Gerado por ${rec.model.replace(/[^\w.-]/g, '')} em ${new Date(rec.t).toLocaleDateString('pt-BR')}. Pode conter imprecisões.</p>`;
    this.setView('done');
    $('#summaryBody').scrollTop = 0;
    // Reabriu o resumo que está tocando: destaca de novo o trecho atual.
    if (this.isPlayingThis()) this.highlight(Player.source, Player.chunks[Player.c]?.para);
  },

  fail(e) {
    console.warn(e);
    $('#summaryError').textContent = e?.message || String(e);
    this.setView('error');
    $('#btnSummaryKey').hidden = !(e?.code === 'NO_GEMINI' || e?.status === 402 || /API Key/i.test(e?.message || ''));
    $('#btnSummaryRedo').hidden = e?.code === 'NO_GEMINI' || e?.status === 402; // 402 não adianta repetir
  },
};

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
  if (name === 'book') fitViewer();
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
  $('#appVersion').textContent = 'v' + (self.APP_VERSION || '?');
  Settings.load();
  applyTheme();
  Settings.init();
  Settings.renderCred();
  Quick.init();
  BookUI.init();
  Where.init();
  Summary.init();
  ChapterDownload.init();

  // Ao voltar para o app, leva o livro até o trecho que está tocando (em segundo plano a tela não é movida).
  document.addEventListener('visibilitychange', () => {
    const chunk = Player.chunks[Player.c];
    if (!document.hidden && chunk && BookUI.source && Player.source === BookUI.source && Player.state === 'playing') {
      BookUI.source.onChunk(Player.u, Player.c, chunk);
    }
  });

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
