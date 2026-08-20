/* ══════════════════════════════════════════════════════════════
   로컬 개발 서버 — 정적 파일 + 실제 /api 핸들러를 그대로 실행한다.
   Vercel 과 동일한 코드 경로를 타므로 배포 전에 여기서 검증한다.

   실행:  node --env-file=key.env scripts/dev.mjs
   ══════════════════════════════════════════════════════════════ */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/* key.env 는 NCP 콘솔이 주는 이름(X-NCP-…)을 그대로 쓴다.
   Vercel 은 환경변수 이름에 하이픈을 못 쓰므로 여기서 별칭을 만든다.
   값을 파일에 복사해두면 키를 재발급할 때 반드시 어긋난다. */
process.env.NCP_KEY_ID ||= process.env["X-NCP-APIGW-API-KEY-ID"] || "";
process.env.NCP_KEY    ||= process.env["X-NCP-APIGW-API-KEY"]    || "";

const PORT = Number(process.env.PORT || 4321);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8",
  ".svg":  "image/svg+xml",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  /* ── /api/* → api/*.js 의 default export 실행 ── */
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, "");
    try {
      const mod = await import(new URL(`../api/${name}.js`, import.meta.url).href);
      return await mod.default(req, res);   // Vercel 과 동일한 (req, res) 시그니처
    } catch (err) {
      console.error(`[dev] /api/${name} 실패:`, err);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "handler_failed" }));
    }
  }

  /* ── 정적 파일 ── */
  const rel = url.pathname === "/"
    ? "index.html"
    : normalize(url.pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  try {
    const buf = await readFile(join(ROOT, rel));
    res.writeHead(200, {
      "Content-Type": TYPES[extname(rel)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  const key = process.env.GEMINI_API_KEY || process.env.gemini_api;
  console.log(`개발 서버 → http://localhost:${PORT}`);
  console.log(key ? `Gemini 키 감지됨 (${key.slice(0, 6)}…)` : "⚠️  키 없음 — /api/chat 이 503 을 반환합니다");
});
