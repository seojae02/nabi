# Nabi

> 외국인이 한국 생활에서 마주하는 문제를 자기 언어로 물어보면, 무엇을 준비하고 어디로 가야 하는지 알려주고, 정보만으로 부족할 때 사람이나 기관까지 연결해주는 생활 지원 서비스

**배포:** https://nabi-korea.vercel.app

```
질문 → 근거 있는 답변 → 갈 곳 안내 → 필요 시 사람·기관 연결
```

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
api/chat.js         Gemini 프록시 — 채팅 스트리밍 + 대화 요약
api/place.js        위치 기반 장소 조회 (NCP Geocoding + 지도 딥링크)
scripts/dev.mjs     로컬 개발 서버. api/ 를 실제로 실행한다
docs/prd.md         제품 요구사항 — 왜 이렇게 만들었는지
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

---

## 기능 추가 전에 알아야 할 4가지

### 1. AI 응답에는 제어 블록이 실려 온다

추가 API 호출을 피하려고, 후속 질문과 방문 장소를 **답변과 같은 응답에** 담는다. 무료 티어 할당량과 지연을 늘리지 않기 위한 설계다.

```
답변 본문...

<<<PLACE>>>
주민센터
<<<NEXT>>>
확정일자는 어떻게 받나요?
주민센터는 어디에 있나요?
```

- 규약은 `api/chat.js` 의 `systemChat()` 에 있다
- 파싱은 `index.html` 의 `splitAnswer()` / `parseFollowups()`
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

### 3. 외부 요청은 0개다

웹폰트도, 아이콘 CDN 도, 지도 SDK 도 쓰지 않는다. 이유는 **기관 목록이 오프라인에서도 열려야** 하기 때문이다 — 데이터 없는 환경에서 119 번호를 못 보면 안 된다.

- 아이콘: `index.html` 상단 `<svg class="sprite">` 안의 `<symbol>`. 24×24 · stroke 1.6 · `currentColor`
- 파비콘: 나비 마크 data URI
- 새 아이콘이 필요하면 스프라이트에 `<symbol id="i-이름">` 을 추가한다. 이모지는 쓰지 않는다 — 플랫폼마다 다르게 렌더링된다

### 4. 색은 토큰으로만 쓴다

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

## 구현 상태

### 동작하는 것

- 언어 온보딩 · 한국어 · 영어 · 베트남어 · 중국어(간체) 전환 (i18n 리소스 분리, 4개 언어 키 대칭)
- AI 상담 — 스트리밍 · 멀티턴 · 5단 구조 답변 · 근거 표기 · 면책
- 답변 기반 후속 질문 칩
- 응급 감지 → 119/1339 즉시 통화
- 에스컬레이션 (3턴 이상 · 오류 · 사용자 요청)
- 연결 요청서 — **대화 내용을 AI 가 요약해 자동 입력**
- 매칭 결과 (지원자는 시드 데이터, 기관은 실제 번호)
- 기관 목록 10곳 · 필터 · 운영시간 실시간 판정 · `tel:` 통화
- 대화 기록 — 저장 · 복원 후 이어쓰기 · 개별/전체 삭제 (최대 40개)
- 음성 입력 (Web Speech API, 서버 불필요)
- 위치 기반 장소 추천 → 네이버 · 카카오 · 구글 지도
- 라이트/다크 · 모바일 우선 · 오프라인 기관 목록

### 아직 아닌 것

| 항목 | 상태 |
|---|---|
| **답변 근거(RAG)** | ❌ 모델 기억에만 의존. **가장 값어치 큰 다음 작업** |
| 실제 지원자 매칭 | ❌ 시드 데이터 5명. 가입·검증 플로우 없음 |
| 요청서 실제 전송 | ❌ 접수처가 없어 결과 화면만 보여준다 |
| 용어 사전 (`S07`) | ❌ 미구현 |
| 취업 분야 | ❌ 의도적 제외 (`docs/prd.md` 5장) |

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

```bash
npx vercel deploy --prod --yes
```

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
node --check api/chat.js && node --check api/place.js

# 아이콘 참조 무결성
for id in $(grep -o 'href="#i-[a-z-]*"' index.html | sed 's/href="#//;s/"//' | sort -u); do
  grep -q "<symbol id=\"$id\"" index.html || echo "MISSING $id"; done

# DOM id 참조 무결성
for id in $(grep -oE "el\('[A-Za-z0-9]+'\)" index.html | sed "s/el('//;s/')//" | sort -u); do
  grep -q "id=\"$id\"" index.html || echo "MISSING #$id"; done
```

---

## 문서

| 문서 | 언제 보나 |
|---|---|
| [`docs/prd.md`](docs/prd.md) | 왜 이런 결정을 했는지. 안전 정책, MVP 범위, 성공 지표 |
| [`docs/screen.md`](docs/screen.md) | 화면별 요소·상태·접근성 요구사항 |

기능을 추가하기 전에 **PRD 6장(안전 정책)과 11장(개인정보)** 은 읽어두는 편이 좋다. 이 서비스에서 가장 쉽게 망가지는 부분이다.
