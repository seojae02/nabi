/* ══════════════════════════════════════════════════════════════
   /api/place — 대화에서 나온 장소를 사용자 위치 기준으로 찾는다.

   NCP Maps(Geocoding / Reverse Geocoding) 구독이 켜져 있으면
   지역명과 후보 목록·거리까지 돌려준다. 구독이 꺼져 있어도
   좌표 기반 지도 링크는 항상 만들 수 있으므로 기능이 죽지 않는다.
   ══════════════════════════════════════════════════════════════ */

export const config = { maxDuration: 30 };

const NCP_BASE = "https://naveropenapi.apigw.ntruss.com";
const MAX_RESULTS = 3;

/* Vercel 은 환경변수 이름에 하이픈을 못 쓴다. 로컬 key.env 의
   원래 이름과 배포용 별칭을 모두 받는다. */
const ncpId  = () => process.env.NCP_KEY_ID || process.env["X-NCP-APIGW-API-KEY-ID"] || "";
const ncpKey = () => process.env.NCP_KEY    || process.env["X-NCP-APIGW-API-KEY"]    || "";

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

const ncpHeaders = () => ({
  "X-NCP-APIGW-API-KEY-ID": ncpId(),
  "X-NCP-APIGW-API-KEY": ncpKey(),
});

/* 두 좌표 사이 거리(m) — 하버사인 */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/* 좌표 → 행정구역. 외국인이 자기 '구' 이름을 모르는 게 이 앱의 핵심 문제라
   이 한 조각이 답변을 '어디로 가라'까지 구체화해준다. */
async function reverseGeocode(lat, lng) {
  const url = `${NCP_BASE}/map-reversegeocode/v2/gc`
    + `?coords=${lng},${lat}&output=json&orders=admcode,legalcode`;
  const r = await fetch(url, { headers: ncpHeaders() });
  if (!r.ok) return { ok: false, status: r.status };

  const data = await r.json();
  const region = data.results?.[0]?.region;
  if (!region) return { ok: false, status: 204 };

  const parts = [region.area1?.name, region.area2?.name, region.area3?.name]
    .filter(Boolean);
  return { ok: true, full: parts.join(" "), city: region.area1?.name || "",
           district: region.area2?.name || "" };
}

/* "강남구 주민센터" 처럼 지역명을 붙여 검색한다 */
async function geocode(query) {
  const url = `${NCP_BASE}/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: ncpHeaders() });
  if (!r.ok) return { ok: false, status: r.status };
  const data = await r.json();
  return { ok: true, items: data.addresses || [] };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });

  const url = new URL(req.url, "http://localhost");
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  const rawLat = url.searchParams.get("lat");
  const rawLng = url.searchParams.get("lng");

  if (!q) return json(res, 400, { error: "no_query" });

  // Number(null) 은 0 이라 유효 좌표로 통과한다 — 빈 값을 먼저 걷어낸다
  if (!rawLat?.trim() || !rawLng?.trim()) return json(res, 400, { error: "no_coords" });
  const lat = Number(rawLat), lng = Number(rawLng);
  const okCoords = Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!okCoords) return json(res, 400, { error: "bad_coords" });

  /* 좌표만 있어도 지도 링크는 만들 수 있다 — API 없이 항상 동작하는 최소 보장.
     제공자를 셋 다 주는 이유: 외국인은 구글 지도를 쓰고, 국내 사용자는
     네이버·카카오를 쓴다. 어느 앱이 깔려 있든 열리게 한다. */
  const mapLinks = (term, plat = lat, plng = lng) => ({
    naver: `https://map.naver.com/p/search/${encodeURIComponent(term)}`
      + `?c=${plng.toFixed(6)},${plat.toFixed(6)},15,0,0,0,dh`,
    kakao: `https://map.kakao.com/link/search/${encodeURIComponent(term)}`,
    google: `https://www.google.com/maps/search/${encodeURIComponent(term)}`
      + `/@${plat.toFixed(6)},${plng.toFixed(6)},15z`,
  });

  if (!ncpId() || !ncpKey()) {
    return json(res, 200, { query: q, region: null, results: [],
                            links: mapLinks(q), degraded: "no_key" });
  }

  try {
    const rev = await reverseGeocode(lat, lng);

    // 구독이 꺼져 있으면(401/403) 지도 링크만 돌려주고 조용히 물러난다
    if (!rev.ok && (rev.status === 401 || rev.status === 403)) {
      return json(res, 200, { query: q, region: null, results: [],
                              links: mapLinks(q), degraded: "not_subscribed" });
    }

    const region = rev.ok ? rev : null;
    const term = region?.district ? `${region.district} ${q}` : q;

    const geo = await geocode(term);
    if (!geo.ok) {
      return json(res, 200, { query: q, region: region?.full ?? null, results: [],
                              links: mapLinks(term),
                              degraded: geo.status === 401 || geo.status === 403
                                ? "not_subscribed" : "geocode_failed" });
    }

    const results = geo.items.slice(0, MAX_RESULTS).map(a => {
      const plat = Number(a.y), plng = Number(a.x);
      return {
        name: a.roadAddress || a.jibunAddress || term,
        address: a.jibunAddress || a.roadAddress || "",
        lat: plat, lng: plng,
        distance: Number.isFinite(plat) ? distanceM(lat, lng, plat, plng) : null,
        links: Number.isFinite(plat) ? mapLinks(term, plat, plng) : mapLinks(term),
      };
    }).sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));

    return json(res, 200, {
      query: q, region: region?.full ?? null, results, links: mapLinks(term),
    });
  } catch (err) {
    console.error("[api/place] failed:", err);
    return json(res, 200, { query: q, region: null, results: [],
                            links: mapLinks(q), degraded: "error" });
  }
}
