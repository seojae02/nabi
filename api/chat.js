/* ══════════════════════════════════════════════════════════════
   /api/chat — 브라우저와 Gemini API 사이의 프록시.
   API 키는 이 함수 안에서만 존재한다. 브라우저로도, 저장소로도
   나가지 않는다. (docs/prd.md 11장)

   intent: "chat"    → 답변을 SSE 로 스트리밍
   intent: "summary" → 대화를 연결 요청서용 한 단락으로 요약 (JSON)
   ══════════════════════════════════════════════════════════════ */

// Gemini 응답이 20초를 넘길 수 있다. 기본 10초로는 잘린다.
export const config = { maxDuration: 60 };

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
function systemChat({ topic, lang }) {
  return `You are Nabi, an assistant for foreign residents and visitors in South Korea.

Your job is to understand the question, explain what to actually do in plain language, and hand off to a person or institution when that is the right answer. You are not a lawyer, a doctor, or a government official, and you never imply that you are.

# Output language

Write your entire answer in ${LANGUAGE[lang] || LANGUAGE.en}.

Keep the Korean for anything the user must say, show, search for, or hand over at a counter — document names, office names, form names, addresses. Give the translation first, then the Korean in parentheses:

  Certificate of Alien Registration (외국인등록 사실증명)

This is not decoration. The user will show your answer to a clerk who may not speak their language.

# Topic

${TOPIC[topic] || TOPIC.auto}

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

If your answer tells them to go somewhere physical — a district office, an immigration office, a hospital, a public health center, a bank — output this line on its own right after the answer:

<<<PLACE>>>

Then, on the next line, the Korean search term for that kind of place and nothing else. Use the generic Korean name, not a specific branch: 주민센터, 출입국·외국인청, 보건소, 세무서, 경찰서, 병원, 약국.

Skip this block entirely when the answer is only an explanation, or when everything can be done online.

# Follow-up suggestions

After that, output this exact line on its own:

<<<NEXT>>>

Then 2 or 3 questions this person is most likely to ask next, one per line. No bullets, no numbering, no quotes. Write them in ${LANGUAGE[lang] || LANGUAGE.en}, short enough to fit on a button, and phrased the way the person would say them.

Base them on your own answer, not on generic advice. If your answer mentioned a Korean term, an office, or a deadline they may not understand, make one of them ask about that specific thing — for example "What is 확정일자?" or "Where is the 주민센터?".

Output nothing after those lines.`;
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

function validate(body) {
  if (!body || typeof body !== "object") return "bad_request";
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) return "no_messages";
  if (messages.length > MAX_TURNS) return "too_many_turns";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "bad_role";
    if (typeof m.content !== "string" || !m.content.trim()) return "empty_content";
    if (m.content.length > MAX_CHARS) return "message_too_long";
  }
  if (messages[messages.length - 1].role !== "user") return "last_must_be_user";
  return null;
}

/* Gemini 는 assistant 를 "model" 이라고 부른다 */
const toContents = messages =>
  messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

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

async function callGemini({ model, system, contents, stream, maxTokens }) {
  const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  return fetch(`${API_BASE}/${model}:${method}key=${apiKey()}`, {
    method: "POST",
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
}

/* 혼잡·과부하일 때 같은 모델을 한 번 더, 그다음 다른 모델을 시도한다.
   응답 본문은 포기할 때만 읽는다 — 한 번 읽으면 스트림이 소비된다. */
async function callWithFallback(opts) {
  let last = null;
  for (const model of MODELS) {
    const attempts = model === MODELS[0] ? 2 : 1;
    for (let i = 0; i < attempts; i++) {
      let r;
      try {
        r = await callGemini({ ...opts, model });
      } catch (err) {
        console.error(`[api/chat] fetch threw on ${model}:`, err);
        last = null;
        break;
      }
      if (r.ok) return r;
      last = r;
      if (!RETRYABLE.has(r.status)) return r;    // 재시도해도 달라지지 않는다
      console.error(`[api/chat] ${model} → ${r.status}, 재시도/폴백`);
      if (i + 1 < attempts) await sleep(1200);
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
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  // 키가 없을 때 조용히 실패하지 않는다 — 설정 단계에서 바로 드러나야 한다
  if (!apiKey()) return json(res, 503, { error: "missing_api_key" });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "bad_json" });
  }

  const invalid = validate(body);
  if (invalid) return json(res, 400, { error: invalid });

  const topic  = TOPIC[body.topic] ? body.topic : "auto";
  const lang   = LANGUAGE[body.lang] ? body.lang : "en";
  const intent = body.intent === "summary" ? "summary" : "chat";

  /* ── 요약: 한 번에 받아 JSON 으로 돌려준다 ── */
  if (intent === "summary") {
    try {
      const up = await callWithFallback({
        system: systemSummary({ lang }),
        contents: toContents(body.messages),
        stream: false,
        maxTokens: 1500,
      });
      if (!up) return json(res, 502, { error: "upstream_error" });
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

  /* ── 채팅: SSE 를 평문 스트림으로 중계한다 ── */
  const upstream = await callWithFallback({
    system: systemChat({ topic, lang }),
    contents: toContents(body.messages),
    stream: true,
    maxTokens: 2048,
  });

  if (!upstream) return json(res, 502, { error: "upstream_error" });

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

    if (!emitted) push("__NABI_EMPTY__");
  } catch (err) {
    console.error("[api/chat] stream failed:", err);
    if (!emitted) push("__NABI_ERROR__");
    else push("\n\n_(The response was cut off. Please ask again.)_");
  } finally {
    res.end();
  }
}
