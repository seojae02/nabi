/* ══════════════════════════════════════════════════════════════
   /api/chat — 브라우저와 Gemini API 사이의 프록시.
   API 키는 이 함수 안에서만 존재한다. 브라우저로도, 저장소로도
   나가지 않는다. (docs/prd.md 11장)

   intent: "chat"      → 답변을 SSE 로 스트리밍
   intent: "summary"   → 대화를 연결 요청서용 한 단락으로 요약 (JSON)
   intent: "korean"    → 대화에서 사용자의 상황을 한국어 문장으로 정리 (JSON)
                         창구 직원에게 화면을 그대로 보여주기 위한 것
   intent: "translate" → 텍스트 한 건을 번역 (JSON)
   ══════════════════════════════════════════════════════════════ */

import { findCard, groundingFor, followupsFor, sourceBlockFor } from "./_kb.js";

// Gemini 응답이 20초를 넘길 수 있다. 기본 10초로는 잘린다.
export const config = { maxDuration: 60 };

/* 위 maxDuration 을 코드도 알아야 재시도 예산을 계산할 수 있다.
   전부 응답을 받아오는 데 쓰면 본문을 흘려보낼 시간이 남지 않고,
   그러면 사용자에게 429 대신 게이트웨이 504 가 나간다. */
const BUDGET_MS  = 60_000;
const STREAM_MS  = 24_000;                    // 본문 스트리밍 몫으로 남겨둔다
const ACQUIRE_MS = BUDGET_MS - STREAM_MS;     // 응답 헤더를 받는 데 쓸 수 있는 시간
const ATTEMPT_MS = 20_000;                    // 호출 한 번이 예산을 독식하지 못하게
const MIN_TRY_MS = 3_000;                     // 이보다 적게 남으면 시도할 가치가 없다

// 첫 모델이 혼잡(503)하면 다음 모델로 넘어간다. 무료 티어에서 실제로 발생한다.
// gemini-2.5-flash 는 신규 사용자 지원이 종료되어 목록에서 제외한다.
const MODELS     = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash"];
const API_BASE   = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_TURNS  = 20;      // 공개 엔드포인트 — 히스토리 길이 제한
const MAX_CHARS  = 2000;    // 메시지 1건 길이 제한

const apiKey = () => process.env.GEMINI_API_KEY || process.env.gemini_api || "";

const TOPIC = {
  medical: "Medical — hospitals, pharmacies, national health insurance.",
  housing: "Housing — finding a place to live, leases, deposits, moving in.",
  admin:   "Administration — visas, residence registration, documents, public services.",
  auto:    "Not selected. Infer the topic from the question itself.",
};

const LANGUAGE = {
  en: "English",
  ko: "Korean (한국어)",
  vi: "Vietnamese (Tiếng Việt)",
  zh: "Chinese (中文)",
};

/* ── 시스템 프롬프트 — PRD 6.2~6.5 가 코드로 내려오는 지점 ──── */
function systemChat({ topic, lang, hit }) {
  /* 근거 카드가 있으면 프롬프트에 주입한다 (PRD 6.2 — 모델 기억에만
     의존한 답변 금지). 없으면 빈 문자열이고 기존 동작이 그대로 유지된다.
     카드 12장으로 하드 거부를 걸면 대부분의 질문이 막히므로, 지금은
     근거가 있을 때만 강화하고 없을 때는 아래 "Honesty" 규칙에 맡긴다. */
  let grounded = "";
  if (hit) {
    const nexts = followupsFor(hit.card, lang).map(q => "- " + q).join("\n");
    grounded = "\n" + groundingFor(hit.card, lang) +
      "\n\nIf these follow-up questions fit your answer, prefer them over inventing new ones:\n" +
      nexts + "\n";
  }

  return `You are Nabi, an assistant for foreign residents and visitors in South Korea.

Your job is to understand the question, explain what to actually do in plain language, and hand off to a person or institution when that is the right answer. You are not a lawyer, a doctor, or a government official, and you never imply that you are.

# Output language

Write your entire answer in ${LANGUAGE[lang] || LANGUAGE.en}.

Keep the Korean for anything the user must say, show, search for, or hand over at a counter — document names, office names, form names, addresses. Give the translation first, then the Korean in parentheses:

  Certificate of Alien Registration (외국인등록 사실증명)

This is not decoration. The user will show your answer to a clerk who may not speak their language.

# Topic

${TOPIC[topic] || TOPIC.auto}

${grounded}
# Answer shape

Use this order. Skip any section that does not apply — do not pad.

1. **One-sentence conclusion.** Lead with it. Yes, no, or "it depends on X".
2. **What they need** — documents, conditions, money, timing.
3. **Where and how** — which office, which website, which phone number.
4. **What can go wrong** — include only when getting it wrong costs money, time, or residency status. Name the specific consequence, not a vague warning.
5. **Basis** — the institution or rule your answer rests on.

Use \`##\` for those section headings and \`-\` for lists. Keep it short: the person reading this is often standing in a queue or sitting across from a landlord. Never exceed about 250 words.

# Honesty about what you know

You have no live access to Korean government systems. Rules change, and they differ by visa type, city, and district office.

- State what is generally true, then name what depends on their specific situation.
- If you are not confident, say so plainly in one sentence and point them to the office that can confirm. Do not guess at fees, deadlines, or eligibility.
- Never invent a document name, office name, phone number, or URL. If you don't know the specific office, say which kind of office handles it.

# Hand off instead of answering

For these, do not answer yourself. Say in one sentence why, then give the contact.

- Diagnosis, treatment, or what medication to take → a doctor or pharmacist.
- Whether a specific contract, dispute, or case is legally valid, or how it will turn out → Korea Legal Aid Corporation, 132.
- Whether their visa or residency application will be approved → Immigration Contact Center, 1345.

# Emergency

If the question describes a medical emergency — trouble breathing, unconsciousness, heavy bleeding, chest pain, suspected stroke, poisoning, seizure, severe burns — your first line is to call **119** (ambulance, free, no insurance needed). Nothing comes before it. Mention **1339** for medical information. Then stop. Do not continue into general guidance.

# Real phone numbers — use these exactly, never alter them

- **1345** — Immigration Contact Center. 20 languages, free.
- **119** — fire and ambulance.
- **1339** — emergency medical information.
- **132** — Korea Legal Aid Corporation. Free legal help.
- **120** — local government civil service (Seoul and several other cities).

# Never

- Never ask for a passport number, alien registration number, card number, or password. If the user volunteers one, tell them not to share it and continue without it.
- Never present a guess as a fact.
- Never tell someone their situation is fine when you cannot verify it.

# Where to go

If your answer tells them to go somewhere physical — a district office, an immigration office, a clinic, a public health center, a bank — output this line on its own right after the answer:

<<<PLACE>>>

Then 1 to 3 lines, most likely first, one place per line, in exactly this shape:

Korean search term | one short reason in ${LANGUAGE[lang] || LANGUAGE.en}

The search term:

- Korean only, and something a map can find. No specific branch, no hospital brand name.
- Administrative: 주민센터, 출입국·외국인청, 보건소, 세무서, 경찰서, 약국, 은행.
- **Medical: name the department, not just 병원.** Use the one people with this problem normally go to first: 내과, 정형외과, 이비인후과, 피부과, 치과, 안과, 산부인과, 신경과, 정신건강의학과, 가정의학과, 응급실.
- If more than one department could fit what they described, list them — that is what the extra lines are for.
- If what they said is not specific enough to tell, put 가정의학과 first and then the closest candidates. Do not pick one at random to look decisive.

The reason is one short clause naming what it handles — where people with this kind of problem usually go. **It is not a diagnosis and must not read like one.** Do not name a condition, do not say what they have, do not predict what the doctor will find.

Skip this block entirely when the answer is only an explanation, or when everything can be done online.

# Follow-up suggestions

After that, output this exact line on its own:

<<<NEXT>>>

Then 2 or 3 questions this person is most likely to ask next, one per line. No bullets, no numbering, no quotes. Write them in ${LANGUAGE[lang] || LANGUAGE.en}, short enough to fit on a button, and phrased the way the person would say them.

Base them on your own answer, not on generic advice. If your answer mentioned a Korean term, an office, or a deadline they may not understand, make one of them ask about that specific thing — for example "What is 확정일자?" or "Where is the 주민센터?".

Output nothing after those lines.`;
}

/* ── 창구용 한국어 정리 (intent: korean) ─────────────────────
   말이 막히는 자리에서 화면을 그대로 내밀기 위한 기능이다.
   역번역을 같은 응답에 실어 보낸다 — 자기가 무엇을 보여주는지
   모르는 채로 내밀게 하면 안 된다. 호출은 1회로 끝낸다.
   ──────────────────────────────────────────────────────── */
function systemKorean({ lang }) {
  const back = lang === "ko" ? "" : `

After the statement, output this exact line on its own:

<<<BACK>>>

Then the same statement in ${LANGUAGE[lang] || LANGUAGE.en}, so the person knows what they are about to show. Output nothing after it.`;

  return `You write a short statement in KOREAN that a foreign resident will show, on their phone screen, to a Korean staff member — a clerk at a district office, a nurse, a pharmacist, a landlord.

Read the conversation and write what this person needs to get across right now.

# Rules

- Write the statement in Korean only. No other language, no romanization, no translation in parentheses.
${lang === "ko" ? "" : "- Begin with exactly this sentence: 저는 한국어를 잘 못합니다.\n"}- 2 to 5 short sentences, first person, polite (해요체 or 합니다체).
- Cover, in this order and only when the conversation supports it: what the situation is, what they need, and what they are asking the staff to do.
- If it is medical: where it hurts, since when, how it feels, and anything they already took. Only what the conversation actually says.
- Never invent a detail the conversation does not contain — no symptoms, no dates, no amounts. Missing is better than wrong: the staff will act on this.
- No names, ID numbers, card numbers, addresses, or phone numbers, even if the user gave them.
- No headings, no bullets, no markdown, no quotation marks. Plain sentences only.${back}`;
}

/* ── 번역기 (intent: translate) ──────────────────────────────
   생활 안내와 무관한 한 문장짜리 번역도 필요하다. 대화 기록을
   쓰지 않으므로 히스토리를 오염시키지 않는다.
   ──────────────────────────────────────────────────────── */
function systemTranslate({ from, to }) {
  return `You are a translator. Translate the user's message from ${LANGUAGE[from] || LANGUAGE.en} into ${LANGUAGE[to] || LANGUAGE.ko}.

- Output ONLY the translation. Nothing before it, nothing after it.
- No explanation, no notes, no romanization, no quotation marks, no markdown.
- Keep names, numbers, addresses, and document names exactly as given.
- Match the register of the original. A polite request stays a polite request.
- If the message is already in ${LANGUAGE[to] || LANGUAGE.ko}, output it unchanged.
- Translate even if the message is a fragment or a single word. Never ask a question back.`;
}

function systemSummary({ lang }) {
  return `You write the "what you need help with" field of a request form that gets handed to a volunteer interpreter.

Read the conversation and write 1–3 short sentences in ${LANGUAGE[lang] || LANGUAGE.en} that tell the interpreter:
- what the person is trying to do,
- what specifically is blocking them,
- whether someone needs to be physically present.

Write it in the first person, as if the person wrote it themselves ("I need help understanding...").

Output rules — these matter, the text goes straight into a form field:
- Output ONLY the sentences. Nothing before them, nothing after them.
- No heading, no label, no field name, no "Purpose:", no colon-prefixed prefix of any kind.
- No quotation marks, no bullet points, no markdown, no asterisks, no slashes.
- Do not include names, ID numbers, card numbers, addresses, or phone numbers.

Plain sentences only.`;
}

/* ── 유틸 ──────────────────────────────────────────────────── */
function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

/* Vercel 은 JSON 본문을 req.body 로 파싱해준다. 로컬 개발 서버는 아니므로 둘 다 지원한다. */
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validate(body, intent) {
  if (!body || typeof body !== "object") return "bad_request";
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) return "no_messages";
  if (messages.length > MAX_TURNS) return "too_many_turns";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "bad_role";
    if (typeof m.content !== "string" || !m.content.trim()) return "empty_content";
    if (m.content.length > MAX_CHARS) return "message_too_long";
  }
  /* 답을 이어 쓰는 건 chat 뿐이다. summary·korean 은 이미 끝난 대화를 읽는
     쪽이라 마지막이 assistant 로 끝난다 — 사용자가 답변을 받고 나서 누르는
     버튼이기 때문이다. 여기에 같은 규칙을 걸면 정상 경로가 400 으로 막힌다. */
  if (intent === "chat" && messages[messages.length - 1].role !== "user") {
    return "last_must_be_user";
  }
  if (!messages.some(m => m.role === "user")) return "no_messages";
  return null;
}

/* Gemini 는 assistant 를 "model" 이라고 부른다 */
const toContents = messages =>
  messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

/* Gemini 는 model 턴으로 끝나는 요청을 거부한다("Requests ending with a
   model turn are not supported"). summary·korean 은 이미 끝난 대화를 읽는
   쪽이라 마지막이 model 인 것이 정상이므로, 지시문을 user 턴 하나로 덧붙여
   요청을 닫는다. chat 은 애초에 user 로 끝나므로 그대로 지나간다. */
function toContentsFor(messages, ask) {
  const c = toContents(messages);
  if (c.length && c[c.length - 1].role === "model") {
    c.push({ role: "user", parts: [{ text: ask }] });
  }
  return c;
}

/* 의료·법률 질문이 과차단되지 않도록 임계값을 높인다 */
const SAFETY = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map(category => ({ category, threshold: "BLOCK_ONLY_HIGH" }));

function upstreamError(status) {
  if (status === 429) return "rate_limited";     // 무료 티어에서 실제로 자주 발생
  if (status === 503) return "overloaded";       // 모델 혼잡 — 잠시 후 되는 경우가 많다
  if (status === 403) return "bad_key";
  if (status === 404) return "model_not_found";
  if (status >= 500)  return "upstream_error";
  return "bad_upstream";
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function callGemini({ model, system, contents, stream, maxTokens, timeoutMs }) {
  const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";

  /* 타이머는 응답 헤더가 돌아올 때까지만 건다. 스트리밍 본문에까지 걸어두면
     멀쩡히 받아놓은 답변이 중간에 끊긴다 — 그래서 AbortSignal.timeout 이
     아니라 직접 만든 컨트롤러를 쓰고, fetch 가 풀리는 즉시 해제한다. */
  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs ?? ATTEMPT_MS);

  try {
    return await fetch(`${API_BASE}/${model}:${method}key=${apiKey()}`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        safetySettings: SAFETY,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.4,
          // 사고 시간을 낮춘다 — 채팅에서 첫 글자까지 10초는 너무 길다
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

/* 혼잡·과부하일 때 같은 모델을 한 번 더, 그다음 다른 모델을 시도한다.
   응답 본문은 포기할 때만 읽는다 — 한 번 읽으면 스트림이 소비된다. */
async function callWithFallback(opts, deadline) {
  let last = null;
  const left = () => deadline - Date.now();

  for (const model of MODELS) {
    const attempts = model === MODELS[0] ? 2 : 1;
    for (let i = 0; i < attempts; i++) {
      /* 남은 예산이 한 번 시도하기에도 모자라면 그만두고 지금까지 받은
         응답을 그대로 돌려준다. 끝까지 매달리면 429 를 손에 쥐고도
         핸들러가 그걸 반환하기 전에 함수가 죽는다. */
      if (left() < MIN_TRY_MS) {
        console.error(`[api/chat] 예산 소진 — ${model} 시도 생략 (남은 ${left()}ms)`);
        return last;
      }

      let r;
      try {
        r = await callGemini({ ...opts, model, timeoutMs: Math.min(ATTEMPT_MS, left()) });
      } catch (err) {
        console.error(`[api/chat] fetch threw on ${model}:`, err);
        last = null;
        break;
      }
      if (r.ok) return r;
      last = r;
      if (!RETRYABLE.has(r.status)) return r;    // 재시도해도 달라지지 않는다
      console.error(`[api/chat] ${model} → ${r.status}, 재시도/폴백`);
      if (i + 1 < attempts && left() > MIN_TRY_MS + 1200) await sleep(1200);
    }
  }
  return last;
}

/* SSE 한 줄에서 텍스트 조각을 꺼낸다 */
function extractText(payload) {
  let out = "";
  for (const cand of payload.candidates || []) {
    for (const part of cand.content?.parts || []) {
      if (typeof part.text === "string") out += part.text;
    }
  }
  return out;
}

/* ── 핸들러 ────────────────────────────────────────────────── */
export default async function handler(req, res) {
  const started = Date.now();   // 재시도 예산은 요청 시작부터 센다

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  // 키가 없을 때 조용히 실패하지 않는다 — 설정 단계에서 바로 드러나야 한다
  if (!apiKey()) return json(res, 503, { error: "missing_api_key" });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "bad_json" });
  }

  const lang   = LANGUAGE[body.lang] ? body.lang : "en";
  const INTENTS = new Set(["chat", "summary", "korean", "translate"]);
  const intent = INTENTS.has(body.intent) ? body.intent : "chat";

  /* ── 번역: 대화 기록 없이 텍스트 한 건만 다룬다 ── */
  if (intent === "translate") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(res, 400, { error: "empty_content" });
    if (text.length > MAX_CHARS) return json(res, 400, { error: "message_too_long" });

    const from = LANGUAGE[body.from] ? body.from : "en";
    const to   = LANGUAGE[body.to]   ? body.to   : "ko";
    if (from === to) return json(res, 200, { text });

    try {
      const up = await callWithFallback({
        system: systemTranslate({ from, to }),
        contents: toContents([{ role: "user", content: text }]),
        stream: false,
        maxTokens: 1500,
      }, started + BUDGET_MS - MIN_TRY_MS);
      if (!up)     return json(res, 502, { error: "upstream_error" });
      if (!up.ok)  return json(res, up.status === 429 ? 429 : 502, { error: upstreamError(up.status) });

      const out = extractText(await up.json()).trim();
      if (!out) return json(res, 502, { error: "empty_response" });
      return json(res, 200, { text: out });
    } catch (err) {
      console.error("[api/chat] translate failed:", err);
      return json(res, 502, { error: "upstream_error" });
    }
  }

  const invalid = validate(body, intent);
  if (invalid) return json(res, 400, { error: invalid });

  const topic  = TOPIC[body.topic] ? body.topic : "auto";

  /* 근거 검색 — 마지막 사용자 질문으로 카드를 찾는다.
     요약(summary)은 이미 있는 대화를 줄이는 일이라 근거가 필요 없다. */
  const lastUser = [...body.messages].reverse().find(m => m.role === "user");
  const hit = intent === "chat" ? findCard(lastUser?.content || "", topic) : null;
  if (hit) console.log(`[api/chat] 근거 적용: ${hit.id}`);

  /* ── 요약: 한 번에 받아 JSON 으로 돌려준다 ── */
  if (intent === "summary") {
    try {
      const up = await callWithFallback({
        system: systemSummary({ lang }),
        contents: toContentsFor(body.messages,
          "Write the request-form text now, following the output rules."),
        stream: false,
        maxTokens: 1500,
      }, started + BUDGET_MS - MIN_TRY_MS);
      if (!up) return json(res, 503, { error: "overloaded" });
      if (!up.ok) {
        return json(res, up.status === 429 ? 429 : 502, { error: upstreamError(up.status) });
      }
      const payload = await up.json();
      const text = extractText(payload).trim();
      if (!text) return json(res, 502, { error: "empty_response" });
      return json(res, 200, { summary: text });
    } catch (err) {
      console.error("[api/chat] summary failed:", err);
      return json(res, 502, { error: "upstream_error" });
    }
  }

  /* ── 창구용 한국어 정리: 한국어 본문과 역번역을 함께 돌려준다 ── */
  if (intent === "korean") {
    try {
      const up = await callWithFallback({
        system: systemKorean({ lang }),
        contents: toContentsFor(body.messages,
          "Write the Korean statement now, following the rules."),
        stream: false,
        maxTokens: 1200,
      }, started + BUDGET_MS - MIN_TRY_MS);
      if (!up)     return json(res, 502, { error: "upstream_error" });
      if (!up.ok)  return json(res, up.status === 429 ? 429 : 502, { error: upstreamError(up.status) });

      const text = extractText(await up.json()).trim();
      if (!text) return json(res, 502, { error: "empty_response" });

      /* 제어 블록은 채팅과 같은 규약을 쓴다 (index.html splitAnswer 참고).
         모델이 블록을 빠뜨려도 한국어 본문은 살아 있어야 한다. */
      const [ko, back = ""] = text.split(/^<<<BACK>>>$/m);
      if (!ko.trim()) return json(res, 502, { error: "empty_response" });
      return json(res, 200, { ko: ko.trim(), back: back.trim() });
    } catch (err) {
      console.error("[api/chat] korean failed:", err);
      return json(res, 502, { error: "upstream_error" });
    }
  }

  /* ── 채팅: SSE 를 평문 스트림으로 중계한다 ── */
  const upstream = await callWithFallback({
    system: systemChat({ topic, lang, hit }),
    contents: toContents(body.messages),
    stream: true,
    maxTokens: 2048,
  }, started + ACQUIRE_MS);

  if (!upstream) return json(res, 503, { error: "overloaded" });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[api/chat] upstream", upstream.status, detail.slice(0, 300));
    return json(res, upstream.status === 429 ? 429 : 502, { error: upstreamError(upstream.status) });
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", emitted = false;

  const push = text => { res.write(text); emitted = true; };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";      // 마지막 조각은 다음 청크와 이어붙인다

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;

        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }

        if (payload.promptFeedback?.blockReason && !emitted) {
          push("__NABI_BLOCKED__");
          return res.end();
        }
        const text = extractText(payload);
        if (text) push(text);
      }
    }

    if (!emitted) {
      push("__NABI_EMPTY__");
    } else if (hit) {
      /* 출처는 모델에게 맡기지 않는다. URL 을 지어낼 수 있고, renderMd 가
         링크를 지원하지도 않는다. 서버가 검증된 목록을 그대로 덧붙인다. */
      const src = sourceBlockFor(hit.card, lang);
      if (src) push("\n<<<SRC>>>\n" + src);
    }
  } catch (err) {
    console.error("[api/chat] stream failed:", err);
    if (!emitted) push("__NABI_ERROR__");
    else push("\n\n_(The response was cut off. Please ask again.)_");
  } finally {
    res.end();
  }
}
