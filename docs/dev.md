# 개발 가이드

Nabi 에 기능을 추가하거나 고칠 때 필요한 내용을 모았다.
서비스가 무엇이고 왜 이렇게 만들었는지는 [`../README.md`](../README.md) · [`prd.md`](./prd.md) 를 먼저 본다.

---

## 빠르게 실행하기

```bash
git clone https://github.com/seojae02/nabi.git
cd nabi
npm install            # 실행 의존성은 0개 — devDependency 도 없다
```

프로젝트 루트에 **`key.env`** 를 만든다. (`.gitignore` 에 있으므로 커밋되지 않는다)

```ini
gemini_api="AIza..."

# 지도 기능용 (없어도 앱은 동작한다 — 아래 '알려진 제약' 참고)
X-NCP-APIGW-API-KEY-ID="..."
X-NCP-APIGW-API-KEY="..."
```

```bash
npm run dev            # http://localhost:4321
```

`npm run dev` 는 `node --env-file=key.env scripts/dev.mjs` 다. 이 개발 서버는 **Vercel 과 똑같은 코드 경로**로 `api/*.js` 를 실행하므로, 여기서 되면 배포에서도 된다.

### 키 발급처

| 키 | 발급처 | 없으면 |
|---|---|---|
| `gemini_api` | https://aistudio.google.com/apikey | AI 답변이 안 나온다 (화면에 안내 표시) |
| `X-NCP-APIGW-API-KEY-ID` / `-KEY` | NCP 콘솔 → Maps | 지역명·거리만 빠진다. 지도 링크는 그대로 동작 |

---

## 구조

### 왜 프록시가 필요한가

**저장소가 Public 이고 `index.html` 은 누구나 소스를 볼 수 있다.** API 키를 클라이언트에 두면 즉시 유출된다. 그래서 모든 외부 호출은 서버리스 함수를 거친다.

```
브라우저 ──▶ /api/chat  ──[키]──▶ Gemini API
         ──▶ /api/place ──[키]──▶ NCP Maps
                  ↑
        키는 이 함수 안에서만 존재한다
```

키를 클라이언트로 내보내는 코드는 넣지 말 것.

### 파일

```
index.html          전체 UI. 화면 8개가 한 파일에 있다 (빌드 단계 없음)
api/chat.js         Gemini 프록시 — intent 4종 (chat · summary · korean · translate)
api/_kb.js          근거 지식베이스 — 카드 12장 + 출처 9곳 + 정규식 검색
api/place.js        위치 기반 장소 조회 (NCP Geocoding + 지도 딥링크)
scripts/dev.mjs     로컬 개발 서버. api/ 를 실제로 실행한다
docs/prd.md         제품 요구사항 — 왜 이렇게 만들었는지
docs/dev.md         이 문서 — 개발 가이드
docs/screen.md      화면 정의서 — 실제 구현 기준
```

### 화면과 탭

| 화면 | 내용 |
|---|---|
| `viewOnboard` | 첫 방문 언어 선택 |
| `viewHome` | 질문 입력 · 분야 선택 · 예시 질문 |
| `viewChat` | AI 상담 (스트리밍 · 멀티턴) |
| `viewRequest` | 연결 요청서 (대화 기반 자동 입력) |
| `viewResult` | 매칭 결과 · 기관 안내 |
| `viewOrgs` | 기관 목록 (탭) |
| `viewHistory` | 대화 기록 (탭) |
| `viewSettings` | 설정 (탭) |

탭바는 **홈 · 기록 · 기관 · 설정** 4칸이고, 탭이 없는 화면(`chat`/`request`/`result`)에서는 숨는다. 라우팅은 `show(name)` 하나로 끝난다 — 프레임워크도 히스토리 API 도 쓰지 않는다.

### 입력창 위 도구 3개와 `intent`

창구 앞에서 쓰는 기능이라 답변을 기다렸다 누르는 흐름이면 늦다. 채팅 입력창 위에 상시 노출한다.
시트는 `openTool(title, sub, build, opener)` 하나를 공유하고, 스크림은 언어 시트와 같은 것을 쓴다.

| 도구 | 진입점 | 서버 | 주의 |
|---|---|---|---|
| 시설 안내받기 | `openFacilities()` | `/api/place` | 장소 안내로 가는 **입구는 이 버튼 하나뿐이다.** 답변에 딸려 나오던 인라인 `내 주변에서 찾기` 버튼은 없앴다 — 입구가 둘이면 어디를 눌러야 하는지 헷갈린다. 답변이 `<<<PLACE>>>` 를 실어 오면 `markPlaces(list)` 가 후보를 채우고 버튼에 `data-hot` 을 켠다. 후보는 목록 맨 위에 이유와 함께 올라간다 — 대화마다 다르게 뜬다. 실제 조회는 `runPlaceLookup(term)` |
| 내 상태 한국어로 | `openStatus()` | `intent:'korean'` | 한국어 본문(`ko`)과 역번역(`back`)을 **한 응답에** 담는다. `<<<BACK>>>` 로 나눈다. 대화 메시지가 2개 미만이면 열지 않고 토스트만 띄운다 |
| 번역기 | `openTranslate()` | `intent:'translate'` | **`history` 를 건드리지 않는다.** 번역한 문장이 다음 턴 프롬프트에 섞이면 답변이 오염된다 |

`validate()` 의 "마지막이 user" 규칙은 `chat` 에만 걸린다. `summary` · `korean` 은 답변을 받은 뒤 누르는
버튼이라 마지막이 assistant 다 — 여기에 같은 규칙을 걸면 정상 경로가 400 으로 막힌다.

같은 이유로 Gemini 에 보낼 때는 `toContentsFor(messages, ask)` 를 쓴다. **Gemini 는 model 턴으로 끝나는
요청을 거부한다**(`Requests ending with a model turn are not supported`). 지시문을 user 턴 하나로 덧붙여
요청을 닫는다. `chat` 은 애초에 user 로 끝나므로 그대로 지나간다.

시트 안의 요소에 포커스를 줄 때는 반드시 **`focus({ preventScroll:true })`** 를 쓴다. `.phone` 은
`overflow:hidden` 이지만 포커스는 여전히 프레임을 스크롤시킨다 — 그냥 `focus()` 를 부르면 시트를 여는
순간 화면 전체가 밀려 올라가고 닫혀 있어야 할 언어 시트가 아래에서 딸려 나온다.

프롬프트에서 지키는 것:

- 한국어 정리는 **대화에 없는 사실을 만들지 않는다.** 증상·날짜·금액을 지어내면 직원이 그걸 근거로 움직인다
- 이름 · 등록번호 · 카드번호 · 주소 · 전화번호는 사용자가 입력했더라도 넣지 않는다
- 번역기는 번역문만 출력한다. 설명 · 로마자 · 마크다운 금지

---

## 기능 추가 전에 알아야 할 5가지

### 1. AI 응답에는 제어 블록이 실려 온다

추가 API 호출을 피하려고, 후속 질문과 방문 장소를 **답변과 같은 응답에** 담는다. 무료 티어 할당량과 지연을 늘리지 않기 위한 설계다.

```
답변 본문...

<<<PLACE>>>
정형외과 | for bone, joint, or muscle injuries
가정의학과 | for general evaluation and referrals
<<<NEXT>>>
확정일자는 어떻게 받나요?
주민센터는 어디에 있나요?
```

`<<<PLACE>>>` 는 **최대 3줄**이고 한 줄은 `한국어 검색어 | 이유` 다. 이유는 사용자 언어로 쓰고 없어도 된다.

- 의료 질문이면 `병원` 이 아니라 **진료과 이름**을 받는다 — 내과 · 정형외과 · 치과 · 이비인후과 등
- 증상만으로 한 과로 좁혀지지 않으면 후보를 여러 줄로 받는다. 이때 `가정의학과` 가 먼저 온다.
  임의로 하나를 골라 단호해 보이게 만들지 않는 것이 규약이다
- **이유는 진단이 아니다.** 병명을 말하거나 진료 결과를 예측하지 않는다 (PRD 6.4).
  화면에서도 그렇게 읽히도록 후보 아래에 `facAsk` 안내를 붙인다
- 규약은 `api/chat.js` 의 `systemChat()` 의 `# Where to go` 에 있다
- 파싱은 `index.html` 의 `splitAnswer()` → `{ places: [{ q, why }] }` / `parseFollowups()`
- **스트리밍 중 마커가 조각으로 도착한다** (`<<<PLA`). 화면에 새지 않도록 꼬리를 잘라내고 있으니, 파서를 건드릴 땐 이 경우를 꼭 확인할 것
- 히스토리에는 제어 블록을 저장하지 않는다. 남기면 다음 턴 프롬프트가 오염된다

### 2. 문자열은 반드시 4개 언어 전부에 넣는다

하드코딩 금지. `STRINGS.en` · `ko` · `vi` · `zh` 에 같은 키가 있어야 한다. `t()` 는 없는 키를 영어로 폴백하므로 빠뜨려도 화면은 깨지지 않는다 — **그래서 대칭 검사를 돌리지 않으면 누락을 못 본다.**

`%N` `%R` `%Q` `%L` `%Y` `%T` 는 값이 치환되는 자리다. 번역할 때 반드시 그대로 남겨야 한다.

```js
// 마크업
<span data-i18n="myKey"></span>
// 또는 코드에서
el('x').textContent = t('myKey');
```

대칭 검사:

```bash
# STRINGS 를 실제로 평가해서 비교한다 — 정규식으로 긁으면 중첩 키를 놓친다
python3 - << 'PY' > /tmp/strings.mjs
import pathlib
s = pathlib.Path('index.html').read_text(encoding='utf-8')
i = s.index('const STRINGS = {'); j = s.index(chr(10) + '};', i) + 3
print(s[i:j].replace('const STRINGS =', 'export const STRINGS =', 1))
PY

node --input-type=module -e "
import { STRINGS } from '/tmp/strings.mjs';
const base = Object.keys(STRINGS.en).sort();
const ph = s => (String(s).match(/%[A-Z]/g) || []).sort().join('');
for (const l of Object.keys(STRINGS)) {
  const k = Object.keys(STRINGS[l]).sort();
  const miss  = base.filter(x => !k.includes(x));
  const extra = k.filter(x => !base.includes(x));
  const phBad = base.filter(x => x !== 'ex' && ph(STRINGS[l][x]) !== ph(STRINGS.en[x]));
  console.log((miss.length || extra.length || phBad.length ? '❌' : '✅'), l, k.length,
    miss.length  ? '누락:' + miss   : '',
    extra.length ? '잉여:' + extra  : '',
    phBad.length ? '플레이스홀더:' + phBad : '');
}"
```

### 3. 근거는 지식베이스에서 오고, 출처는 서버가 붙인다

`api/_kb.js` 에 손으로 정제한 카드가 있다. 질문이 카드의 `match` 정규식에 걸리면
`api/chat.js` 가 그 내용을 시스템 프롬프트에 주입한다 — 모델이 기억으로 답하는 대신
확인된 정보를 근거로 답하게 만드는 장치다 (`docs/prd.md` 6.2).

```
질문 → findCard() → groundingFor() → 프롬프트 주입 → 답변
                 └→ sourceBlockFor() → <<<SRC>>> → 출처 링크 카드
```

- **출처 URL 은 모델이 만들지 않는다.** 서버가 `<<<SRC>>>` 블록으로 붙인다. 모델에게
  맡기면 링크를 지어내고, `renderMd()` 는 마크다운 링크를 지원하지도 않는다
- **`match` 는 4개 언어 전부 넣는다.** 한국어·영어만 넣으면 vi/zh 사용자는 근거 없는
  답변을 받는데 화면상으로는 구분이 안 된다
- **`sources` 가 빈 카드는 만들지 않는다.** 근거 없는 카드는 존재 이유가 없다
- **전화번호·수수료는 확인된 것만.** 추측해서 넣지 말 것
- 카드를 추가하면 아래 검증 스크립트로 `chips.next` 가 살아있는지 반드시 확인한다

카드 스키마는 `systemChat()` 의 5단 답변 구조와 1:1 로 맞춰져 있다 —
`verdict`/`docs`/`where`/`warn`/`sources` 가 각각 결론/필요한 것/어디서 어떻게/주의할
점/근거다. 새 카드도 이 대응을 깨지 말 것.

### 4. 외부 요청은 0개다

웹폰트도, 아이콘 CDN 도, 지도 SDK 도 쓰지 않는다. 이유는 **기관 목록이 오프라인에서도 열려야** 하기 때문이다 — 데이터 없는 환경에서 119 번호를 못 보면 안 된다.

- 아이콘: `index.html` 상단 `<svg class="sprite">` 안의 `<symbol>`. 24×24 · stroke 1.6 · `currentColor`
- 파비콘: 나비 마크 data URI
- 새 아이콘이 필요하면 스프라이트에 `<symbol id="i-이름">` 을 추가한다. 이모지는 쓰지 않는다 — 플랫폼마다 다르게 렌더링된다

### 5. 색은 토큰으로만 쓴다

단청(丹靑) 색계다. 하드코딩된 hex 를 넣지 말 것 — 다크모드가 깨진다.

| 토큰 | 역할 |
|---|---|
| `--guide` | 청(靑). 주색 · CTA |
| `--wing` / `--wing-ink` | 황(黃). 날개 · 부동산 (`-ink` 는 글자용) |
| `--iris` | 남(藍). 행정 · 위치 |
| `--alert` | 적(赤). **응급 전용** |
| `--ink` / `--ink-2` / `--ink-3` | 글자 (진함 → 흐림) |
| `--panel` / `--panel-2` / `--ground` | 면 |

`--wing` 은 흰 배경에서 명암비 2.16:1 이라 **글자에 쓰면 안 된다.** 로고와 그라디언트 장식 전용이고, 글자에는 `--wing-ink`(5.62:1)를 쓴다.

---

## 안전 정책 — 임의로 지우지 말 것

의료·비자·계약은 틀린 답변의 피해가 실제로 크다. 아래는 그 대응이고, `docs/prd.md` 6장이 근거다.

| 항목 | 어디에 있나 | 왜 |
|---|---|---|
| 면책 문구 | `addAi().finish()` — **UI 가 강제로 붙인다** | 모델에게 맡기면 빠뜨린다 |
| 응급 분기 | 클라이언트 키워드(`EMERGENCY`) + 시스템 프롬프트 | 이중 처리. 하나가 놓쳐도 다른 쪽이 잡는다 |
| 진단·법적판단·심사예측 차단 | `systemChat()` | 기관으로 넘긴다 |
| 실제 전화번호 | `ORGS` 배열 | **확인된 번호만.** 추측해서 넣지 말 것 |
| 지원자 데모 표시 | `viewResult` 의 `.demo-note` | 실제 매칭이 아닌데 실제처럼 보이면 안 된다 |
| 개인정보 문구 | `privacy` / `setPrivBody` 문자열 | **저장 방식을 바꾸면 이 문구도 바꿔야 한다** |

마지막 항목이 특히 중요하다. 대화 기록은 `localStorage` 에만 저장하고 서버로 보내지 않는다. 저장 위치를 바꾸면 화면의 고지도 같이 고쳐야 한다 — 화면에 사실과 다른 개인정보 문구를 두면 안 된다.

---


## 알려진 제약

**1. Gemini 무료 티어 할당량이 빡빡하다.** 테스트 중 429 를 실제로 만났다. 혼잡(503) 시 재시도 후 다른 모델로 폴백하도록 해뒀지만(`MODELS` 배열), 연습을 많이 하면 정작 필요할 때 막힐 수 있다.

**2. 첫 응답까지 7~27초.** 모델이 생각하는 시간이라 더 줄이기 어렵다. `thinkingLevel: "low"` 로 낮춘 상태다. 타이핑 인디케이터에 문구를 넣어 완화했다.

**3. NCP Maps 가 막혀 있다.** 키는 유효하고 게이트웨이도 통과하는데 서비스가 거부한다.

```
Geocoding / Reverse Geocoding / Static / Directions → 401
"A subscription to the API is required."
```

인증 방식 4종, 도메인 2종, Referer 5종, 지도 SDK 인증 엔드포인트까지 시험했다. **코드 문제가 아니라 NCP 계정 설정이다** — 결제 수단 미등록이 가장 유력하다. 열리면 코드 수정 없이 지역명·거리가 추가된다. 확인은 이 한 줄:

```bash
curl -s "https://nabi-korea.vercel.app/api/place?q=주민센터&lat=37.4979&lng=127.0276"
# "degraded":"not_subscribed" 가 사라지면 열린 것
```

**4. 빌드 단계가 없다.** `index.html` 이 121KB 단일 파일이다. 화면이 더 늘면 분리를 검토해야 한다. 지금은 빌드 없이 바로 배포되는 이점이 더 크다고 판단했다.

---

## 배포

**`main` 에 push 하면 자동으로 프로덕션에 올라간다.** 저장소가 Vercel 프로젝트(`nabi`)에 연결되어 있다.

| 무엇을 하면 | 무엇이 생기나 |
|---|---|
| `main` 에 push / PR 머지 | 프로덕션 배포 → https://nabi-korea.vercel.app |
| 다른 브랜치에 push · PR 열기 | 프리뷰 배포 (PR 에 URL 이 댓글로 붙는다) |

수동 배포가 필요하면 (연결 끊겼을 때 · 커밋 없이 확인만 할 때):

```bash
npx vercel@latest deploy --prod --yes
```

`nabi-korea.vercel.app` 은 프로젝트 도메인으로 등록되어 있어 프로덕션 배포를 자동으로 따라간다. **`vercel alias set` 을 수동으로 부를 일은 없다** — 예전에는 alias 라서 배포해도 옛 빌드가 계속 서빙됐다.

Vercel 환경변수(**하이픈 불가**)에 아래가 등록되어 있어야 한다.

```
GEMINI_API_KEY
NCP_KEY_ID
NCP_KEY
```

`key.env` 는 NCP 콘솔이 주는 이름(`X-NCP-…`)을 그대로 쓰고, `scripts/dev.mjs` 가 기동 시 별칭을 만든다. **값을 두 곳에 복사해두지 말 것** — 키를 재발급하면 반드시 어긋난다.

---

## 검증 스크립트

PR 전에 돌려볼 것.

```bash
# JS 문법
python3 -c "
import re,pathlib
open('/tmp/c.mjs','w').write(re.search(r'<script>(.*?)</script>',
  pathlib.Path('index.html').read_text(encoding='utf-8'),re.S).group(1))"
node --check /tmp/c.mjs
node --check api/chat.js && node --check api/place.js && node --check api/_kb.js

# 지식베이스 무결성 — 필수 필드 · 존재하지 않는 출처 · 끊긴 chip 링크
node -e '
(async () => {
  const { CARDS, SOURCES } = await import("./api/_kb.js");
  let bad = 0;
  for (const [id, c] of Object.entries(CARDS)) {
    if (!c.sources?.length) { console.log("근거 없는 카드:", id); bad++; }
    for (const s of c.sources || []) if (!SOURCES[s]) { console.log("없는 출처:", id, s); bad++; }
    for (const ch of c.chips || []) if (!CARDS[ch.next]) { console.log("끊긴 chip:", id, "→", ch.next); bad++; }
  }
  console.log(bad ? "❌ " + bad : "✅ 카드 " + Object.keys(CARDS).length + "장 정상");
})();'

# UI 예시 질문이 4개 언어 전부 카드에 걸리는지 — 근거 커버리지의 최소 조건
python3 - << 'PY' > /tmp/strings.mjs
import pathlib
s = pathlib.Path('index.html').read_text(encoding='utf-8')
i = s.index('const STRINGS = {'); j = s.index(chr(10) + '};', i) + 3
print(s[i:j].replace('const STRINGS =', 'export const STRINGS =', 1))
PY
node -e '
(async () => {
  const kb = await import("./api/_kb.js");
  const { STRINGS } = await import("/tmp/strings.mjs");
  let fail = 0, n = 0;
  for (const lang of Object.keys(STRINGS))
    for (const topic of Object.keys(STRINGS[lang].ex))
      for (const q of STRINGS[lang].ex[topic]) {
        n++;
        if (!kb.findCard(q, topic)) { fail++; console.log("미매칭", lang, q); }
      }
  console.log(fail ? "❌ " + fail + "/" + n : "✅ " + n + "건 전부 매칭");
})();'

# 아이콘 참조 무결성
for id in $(grep -o 'href="#i-[a-z-]*"' index.html | sed 's/href="#//;s/"//' | sort -u); do
  grep -q "<symbol id=\"$id\"" index.html || echo "MISSING $id"; done

# DOM id 참조 무결성
for id in $(grep -oE "el\('[A-Za-z0-9]+'\)" index.html | sed "s/el('//;s/')//" | sort -u); do
  grep -q "id=\"$id\"" index.html || echo "MISSING #$id"; done
```

---

