/* ══════════════════════════════════════════════════════════════
   _kb.js — 근거 지식베이스 (PRD 6.2)

   레포의 AI 는 모델 기억에만 의존해 답해 왔다. PRD 6.2 가 금지한 것이다.
   이 파일은 공공기관 정보를 손으로 정제한 카드 모음이고, api/chat.js 가
   질문에 맞는 카드를 찾아 프롬프트에 근거로 주입한다.

   파일명이 `_` 로 시작하는 이유 — Vercel 은 api/ 안의 `_` 접두사 파일을
   라우트로 취급하지 않고, scripts/dev.mjs 도 /api/{name} 만 매핑한다.
   lib/ 에 두면 정적 파일로 그대로 노출된다.

   카드 스키마 — api/chat.js 의 "Answer shape" 5단과 1:1 로 맞춰 두었다
     verdict → 1. 결론      docs → 2. 필요한 것    where → 3. 어디서 어떻게
     warn    → 4. 주의할 점  sources → 5. 근거
     chips   → <<<NEXT>>> 후속 질문
     match   → 검색 키 (정규식. 임베딩·벡터DB 없이 이것만 쓴다)
               4개 언어 전부 넣는다. 한국어·영어만 넣으면 vi/zh 사용자는
               근거 없는 답변을 받는데, 화면상으로는 구분이 안 된다.
               UI 의 STRINGS.*.ex 에 실제로 노출되는 문구를 기준으로 잡았다.
     asOf    → 수집 시점 (PRD 14장 · 공공 정보 최신성 리스크 대응)

   { en, ko, term } 항목의 term 은 창구에서 보여주거나 붙여넣을 한국어
   원문이다. PRD 7장의 "한국어 원문 병기"는 문장이 아니라 이 용어 단위다.

   규칙
   · sources 가 빈 카드는 만들지 않는다. 근거 없는 카드는 존재 이유가 없다.
   · 면책 문구는 여기 쓰지 않는다. index.html 의 addAi().finish() 가 항상 붙인다.
   · 전화번호·수수료는 확인된 것만. 추측해서 넣지 않는다 (README 안전 정책).
   · chips.next 는 반드시 존재하는 카드 id 여야 한다. 아니면 대화가 끊긴다.
   ══════════════════════════════════════════════════════════════ */

export const SOURCES = {
  klac:    { label: { en: 'Korea Legal Aid Corporation',            ko: '대한법률구조공단' },        url: 'https://www.klac.or.kr' },
  hug:     { label: { en: 'Korea Housing & Urban Guarantee',        ko: '주택도시보증공사(HUG)' },   url: 'https://www.khug.or.kr' },
  hikorea: { label: { en: 'HiKorea Immigration Portal',             ko: '하이코리아' },              url: 'https://www.hikorea.go.kr' },
  gov24:   { label: { en: 'Gov24',                                  ko: '정부24' },                  url: 'https://www.gov.kr' },
  nhis:    { label: { en: 'National Health Insurance Service',      ko: '국민건강보험공단' },        url: 'https://www.nhis.or.kr' },
  egen:    { label: { en: 'E-Gen Emergency Medical Portal',         ko: '응급의료포털 E-Gen' },      url: 'https://www.e-gen.or.kr' },
  iros:    { label: { en: 'Internet Registry Office',               ko: '인터넷등기소' },            url: 'https://www.iros.go.kr' },
  moj:     { label: { en: 'Korea Immigration Service',              ko: '법무부 출입국·외국인정책본부' }, url: 'https://www.immigration.go.kr' },
  molit:   { label: { en: 'Ministry of Land, Infrastructure and Transport', ko: '국토교통부' },      url: 'https://www.molit.go.kr' },
};

export const CARDS = {

  /* ══ 부동산 ══════════════════════════════════════════════ */

  'jeonse-can-i': {
    topic: 'housing',
    asOf: '2026-08',
    match: [/jeonse/i, /전세/, /lease .*(contract|sign)/i, /sign .*(lease|contract)/i],
    q: { en: 'Can foreigners sign a jeonse contract?', ko: '외국인도 전세 계약을 할 수 있나요?' },
    verdict: {
      tone: 'yes',
      en: 'Yes. Foreigners can sign a jeonse contract, with no nationality restriction.',
      ko: '네. 외국인도 국적 제한 없이 전세 계약을 할 수 있습니다.',
    },
    docs: [
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
      { en: 'Certificate of Alien Registration — the foreigner version of a resident registration certificate',
        ko: '외국인등록 사실증명 — 주민등록등본에 해당하는 서류', term: '외국인등록 사실증명' },
      { en: 'Certified copy of the property register, for the flat you are renting',
        ko: '임차할 집의 등기부등본', term: '등기부등본' },
    ],
    where: [
      { en: 'Certificate of Alien Registration — Gov24 online, or any community service center',
        ko: '외국인등록 사실증명 — 정부24 온라인 또는 주민센터', term: '정부24' },
      { en: 'Property register — Internet Registry Office, online, about 700 won',
        ko: '등기부등본 — 인터넷등기소 온라인, 약 700원', term: '인터넷등기소' },
      { en: 'The 확정일자 stamp — community service center for the new address',
        ko: '확정일자 — 새 주소지 주민센터', term: '주민센터' },
    ],
    warn: {
      en: 'Your deposit is only protected once you (1) actually move in, (2) report your address, and (3) get a 확정일자 stamp on the contract. Do all three as soon as you get the keys — not weeks later.',
      ko: '보증금은 ① 실제 입주 ② 전입신고 ③ 계약서에 확정일자를 받은 뒤에야 보호됩니다. 열쇠를 받으면 몇 주 뒤가 아니라 바로 세 가지를 모두 처리하세요.',
    },
    sources: ['klac', 'hug'],
    chips: [
      { next: 'confirmed-date' },
      { next: 'alien-reg-cert', en: 'Where do I get these documents?', ko: '이 서류는 어디서 받나요?' },
      { next: 'jeonse-check-before' },
    ],
    faceToFace: true,
  },

  'confirmed-date': {
    topic: 'housing',
    asOf: '2026-08',
    match: [/확정일자/, /fixed date/i, /date stamp/i],
    q: { en: 'What is 확정일자?', ko: '확정일자가 무엇인가요?' },
    verdict: {
      tone: 'caution',
      en: 'It is an official date stamp on your lease. Without it, you can lose priority over your deposit if the building is auctioned.',
      ko: '임대차계약서에 받는 공적인 날짜 증명입니다. 이것이 없으면 건물이 경매로 넘어갈 때 보증금 우선변제 순위를 잃을 수 있습니다.',
    },
    docs: [
      { en: 'The original signed lease contract', ko: '서명된 임대차계약서 원본', term: '임대차계약서' },
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
    ],
    where: [
      { en: 'Community service center — do it in the same visit as your address report',
        ko: '주민센터 — 전입신고와 같은 방문에서 함께 처리', term: '주민센터' },
      { en: 'District court registry office', ko: '등기소', term: '등기소' },
      { en: 'Internet Registry Office — online', ko: '인터넷등기소 — 온라인', term: '인터넷등기소' },
    ],
    warn: {
      en: 'The stamp alone is not enough. You also need to report your address and actually live there. Protection against a new owner starts at midnight on the day AFTER your address report — so never hand over the deposit and then delay the report.',
      ko: '확정일자만으로는 부족합니다. 전입신고와 실제 거주가 함께 있어야 합니다. 새 집주인에 대한 대항력은 전입신고 다음 날 0시부터 생기므로, 보증금을 주고 신고를 미루면 안 됩니다.',
    },
    sources: ['klac', 'iros'],
    chips: [
      { next: 'address-change', en: 'How do I report my address?', ko: '전입신고는 어떻게 하나요?' },
      { next: 'deposit-not-returned' },
    ],
  },

  'jeonse-check-before': {
    topic: 'housing',
    asOf: '2026-08',
    match: [
      /before .*(sign|contract|pay)/i, /what .*(should|to) check/i,
      /계약 ?전/, /확인.*할/,
      /trước khi ký/i,                      // vi
      /合同前|签约前|簽約前/,                 // zh
    ],
    q: { en: 'What should I check before signing a lease?', ko: '계약 전에 무엇을 확인해야 하나요?' },
    verdict: {
      tone: 'caution',
      en: 'Check the property register and the landlord’s identity before you pay anything.',
      ko: '돈을 보내기 전에 등기부등본과 임대인 신분을 반드시 확인하세요.',
    },
    docs: [
      { en: 'Certified copy of the property register', ko: '등기부등본', term: '등기부등본' },
      { en: 'The landlord’s ID — the name must match the owner on the register',
        ko: '임대인 신분증 — 등기부상 소유자와 이름이 일치해야 합니다', term: '임대인' },
      { en: 'Building use approval ledger, to confirm the unit is legal housing',
        ko: '건축물대장 — 합법 주거용인지 확인', term: '건축물대장' },
    ],
    where: [
      { en: 'Property register — Internet Registry Office, online', ko: '등기부등본 — 인터넷등기소 온라인', term: '인터넷등기소' },
      { en: 'Deposit guarantee eligibility — HUG', ko: '전세보증금반환보증 가입 가능 여부 — HUG', term: '전세보증금반환보증' },
    ],
    warn: {
      en: 'If the register shows a mortgage (근저당) or a seizure (가압류), your deposit ranks behind that debt. Also check that your deposit plus the existing debt stays well below the value of the property.',
      ko: '등기부에 근저당이나 가압류가 있으면 보증금 순위가 그 채무보다 뒤로 밀립니다. 보증금과 기존 채무의 합이 집값보다 충분히 낮은지도 확인하세요.',
    },
    sources: ['klac', 'hug'],
    chips: [
      { next: 'confirmed-date' },
      { next: 'wolse-gwanlibi', en: 'What do wolse and gwanlibi mean?', ko: '월세와 관리비는 무슨 뜻인가요?' },
      { next: 'deposit-not-returned' },
    ],
    faceToFace: true,
  },

  /* 신규 — UI 의 "월세와 관리비가 무슨 뜻인가요?" 에 대응하는 카드가 없었다.
     정의형 카드이므로 docs 는 두지 않는다 (english-hospital 과 같은 형태).
     관리비 근거는 국토교통부의 중개대상물 확인·설명 의무로 뒷받침된다. */
  'wolse-gwanlibi': {
    topic: 'housing',
    asOf: '2026-08',
    match: [
      /wolse/i, /gwanlibi/i, /gwanribi/i,
      /월세/, /관리비/,
      /monthly rent/i, /(maintenance|management) fee/i,
    ],
    q: { en: 'What do wolse and gwanlibi mean?', ko: '월세와 관리비가 무슨 뜻인가요?' },
    verdict: {
      tone: 'caution',
      en: 'Wolse (월세) is monthly rent paid on top of a smaller deposit. Gwanlibi (관리비) is a separate maintenance fee — it is not part of the rent, and it is where unexpected costs usually appear.',
      ko: '월세는 보증금과 별도로 매달 내는 임대료입니다. 관리비는 월세에 포함되지 않는 별도 비용이며, 예상하지 못한 지출이 대개 여기서 생깁니다.',
    },
    where: [
      { en: 'The lease contract — the monthly rent, the deposit, and the payment date must all be written in it',
        ko: '임대차계약서 — 월세·보증금·납부일이 모두 적혀 있어야 합니다', term: '임대차계약서' },
      { en: 'The agent’s property disclosure form — since the rules were tightened, the agent must break the maintenance fee down by item and explain it to you',
        ko: '중개대상물 확인·설명서 — 제도가 강화되어 중개사가 관리비를 항목별로 나누어 설명해야 합니다', term: '중개대상물 확인·설명서' },
      { en: 'Korea Legal Aid Corporation, 132 — free consultation if the landlord and you disagree about what the fee covers',
        ko: '대한법률구조공단 132 — 관리비 범위를 두고 다툼이 생기면 무료 상담', term: '대한법률구조공단' },
    ],
    warn: {
      en: 'Ask which items the maintenance fee covers, and get the answer written into the contract. A flat fee that covers nothing you can verify is the common trap: water, electricity, gas and internet are often billed separately on top of it. If the amount is not itemised in the contract, you have little to argue with later.',
      ko: '관리비에 어떤 항목이 포함되는지 물어보고, 그 내용을 계약서에 적어 두세요. 확인할 수 없는 정액 관리비가 가장 흔한 함정입니다 — 수도·전기·가스·인터넷은 별도로 청구되는 경우가 많습니다. 계약서에 항목이 적혀 있지 않으면 나중에 다툴 근거가 거의 없습니다.',
    },
    sources: ['molit', 'klac'],
    chips: [
      { next: 'jeonse-check-before' },
      { next: 'jeonse-can-i' },
    ],
  },

  'deposit-not-returned': {
    topic: 'housing',
    asOf: '2026-08',
    /* 레포 UI 의 영어 문구가 "My landlord won't return my deposit." 이라
       deposit 이 return 보다 뒤에 온다. 아포스트로피 종류도 갈리므로
       landlord+deposit 동시 등장을 별도 패턴으로 잡는다. */
    match: [
      /deposit.*(back|return|refus)/i,
      /landlord.*deposit/i, /deposit.*landlord/i,
      /보증금.*(안|못).*(돌려|반환|주)/, /집주인.*보증금/, /보증금.*집주인/,
      /landlord.*(won.?t|not|refus)/i,
      /tiền cọc/i, /chủ nhà/i,              // vi
      /押金/, /房东|房東/,                    // zh
    ],
    q: { en: 'My landlord won’t return my deposit.', ko: '집주인이 보증금을 안 돌려줘요.' },
    verdict: {
      tone: 'caution',
      en: 'There are formal steps you can take, and they work best in this order. Start with written notice.',
      ko: '정해진 절차가 있고 이 순서대로 밟는 것이 가장 효과적입니다. 서면 통지부터 시작하세요.',
    },
    docs: [
      { en: 'Your lease contract with the 확정일자 stamp on it',
        ko: '확정일자를 받은 임대차계약서', term: '임대차계약서' },
      { en: 'Certified mail proving you formally asked for the deposit back',
        ko: '보증금 반환을 정식으로 요구했음을 증명하는 내용증명', term: '내용증명' },
      { en: 'Certificate of Alien Registration, showing your reported address',
        ko: '전입 사실이 확인되는 외국인등록 사실증명', term: '외국인등록 사실증명' },
    ],
    where: [
      { en: 'Post office — send the certified mail from here', ko: '우체국 — 내용증명 발송', term: '우체국' },
      { en: 'Korea Legal Aid Corporation, 132 — free consultation, interpretation available',
        ko: '대한법률구조공단 132 — 무료 상담, 통역 지원', term: '대한법률구조공단' },
      { en: 'District court — for a lease registration order or a payment order',
        ko: '법원 — 임차권등기명령 또는 지급명령 신청', term: '임차권등기명령' },
    ],
    warn: {
      en: 'Do not move out and cancel your address report before you obtain a lease registration order (임차권등기명령). If you do, you lose the protection that keeps your claim ahead of the landlord’s other creditors.',
      ko: '임차권등기명령을 받기 전에 이사하고 전출신고를 하면 안 됩니다. 그러면 임대인의 다른 채권자보다 앞서던 대항력을 잃습니다.',
    },
    sources: ['klac', 'hug'],
    chips: [
      { next: 'confirmed-date' },
      { next: 'jeonse-check-before' },
    ],
    /* PRD 6.4 — 개별 사건의 법적 판단은 하지 않는다.
       절차만 안내하고 판단은 기관으로 넘긴다. */
    legalAdjacent: true,
    faceToFace: true,
  },

  /* ══ 행정 ════════════════════════════════════════════════ */

  'alien-reg-cert': {
    topic: 'admin',
    asOf: '2026-08',
    match: [/certificate of alien/i, /외국인등록 ?사실증명/, /proof of (registration|residence)/i, /어디서 받/],
    q: { en: 'How do I get a Certificate of Alien Registration?', ko: '외국인등록 사실증명은 어떻게 받나요?' },
    verdict: {
      tone: 'yes',
      en: 'You can get it online in a few minutes, or at any community service center.',
      ko: '온라인에서 몇 분 안에 발급받을 수 있고, 주민센터에서도 받을 수 있습니다.',
    },
    docs: [
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
    ],
    where: [
      { en: 'Gov24 — online, with an English interface', ko: '정부24 — 온라인, 영어 화면 제공', term: '정부24' },
      { en: 'Any community service center', ko: '가까운 주민센터', term: '주민센터' },
      { en: 'Immigration office', ko: '출입국·외국인청', term: '출입국·외국인청' },
    ],
    warn: {
      en: 'This document is the foreigner version of the resident registration certificate. When a landlord or a bank asks you for 주민등록등본, hand them this instead.',
      ko: '이 서류가 외국인용 주민등록등본입니다. 집주인이나 은행이 주민등록등본을 요구하면 이 서류를 제출하면 됩니다.',
    },
    sources: ['gov24', 'hikorea'],
    chips: [
      { next: 'address-change' },
      { next: 'arc-reissue' },
    ],
  },

  'address-change': {
    topic: 'admin',
    asOf: '2026-08',
    /* 레포 UI 문구가 "이사했는데 주소는 어디에 신고하나요?" / "I moved. Where do
       I report my new address?" 다. 원래 패턴은 둘 다 놓쳤다 — 한국어에는
       "변경/바뀌"가 없고, 영어는 "moved." 뒤가 공백이 아니라 마침표다. */
    match: [
      /address change/i, /changed? .*address/i,
      /moved?\b.*(house|address|flat)/i, /report.*address/i, /new address/i,
      /주소.*(변경|바뀌)/, /이사.*주소/, /주소.*신고/, /전입신고/, /체류지 ?변경/,
      /chuyển nhà/i, /địa chỉ/i,            // vi
      /搬家/, /地址/,                         // zh
    ],
    q: { en: 'I moved. Where do I report my new address?', ko: '이사했는데 주소는 어디에 신고하나요?' },
    verdict: {
      tone: 'caution',
      en: 'Report it within 15 days of moving in. It is free, and reporting late brings a fine.',
      ko: '전입한 날부터 15일 이내에 신고해야 합니다. 수수료는 없고, 늦게 신고하면 과태료가 부과됩니다.',
    },
    docs: [
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
      { en: 'Proof of your new home — usually the lease contract',
        ko: '새 거주지 증빙 — 보통 임대차계약서', term: '임대차계약서' },
    ],
    where: [
      { en: 'Community service center for the new address', ko: '새 주소지 주민센터', term: '주민센터' },
      { en: 'Immigration office', ko: '출입국·외국인청', term: '출입국·외국인청' },
      { en: 'HiKorea — report online without visiting', ko: '하이코리아 — 방문 없이 온라인 신고', term: '하이코리아' },
    ],
    warn: {
      en: 'If you are renting, do this in the same visit as your 확정일자 stamp. The address report is what makes your deposit claim hold up against a new owner of the building.',
      ko: '세입자라면 확정일자와 같은 방문에서 함께 처리하세요. 전입신고가 있어야 건물의 새 소유자에게도 보증금을 주장할 수 있습니다.',
    },
    sources: ['hikorea', 'moj'],
    chips: [
      { next: 'confirmed-date' },
      { next: 'alien-reg-cert' },
    ],
  },

  'arc-reissue': {
    topic: 'admin',
    asOf: '2026-08',
    /* UI 영어 문구가 "How do I renew my alien registration card?" 라
       renew 패턴이 없으면 놓친다. */
    match: [
      /reissue/i, /(lost|replace|renew).*(card|arc|registration)/i,
      /외국인등록증.*(재발급|분실|잃|다시)/,
      /cấp lại.*thẻ/i, /thẻ đăng ký.*(mất|lại)/i,   // vi
      /登录证|登錄證/,                                // zh
    ],
    q: { en: 'How do I renew my alien registration card?', ko: '외국인등록증을 재발급받고 싶어요.' },
    verdict: {
      tone: 'yes',
      en: 'Apply for a reissue at an immigration office. Book the visit online first — walk-ins are usually not accepted.',
      ko: '출입국·외국인청에서 재발급을 신청합니다. 먼저 온라인으로 방문 예약을 하세요 — 예약 없이는 접수가 어렵습니다.',
    },
    docs: [
      { en: 'Passport', ko: '여권', term: '여권' },
      { en: 'Application form for reissue', ko: '외국인등록증 재발급 신청서', term: '외국인등록증 재발급 신청서' },
      { en: 'One colour photo, 3.5 × 4.5 cm', ko: '컬러 사진 1장, 3.5 × 4.5 cm', term: '증명사진' },
      { en: 'Fee — about 30,000 won', ko: '수수료 약 30,000원', term: '수수료' },
    ],
    where: [
      { en: 'Immigration office — reserve your visit on HiKorea first',
        ko: '출입국·외국인청 — 하이코리아에서 방문 예약', term: '출입국·외국인청' },
      { en: 'Foreigner helpline 1345 — 20 languages, free', ko: '외국인종합안내센터 1345 — 20개 언어, 무료', term: '외국인종합안내센터' },
    ],
    warn: {
      en: 'Apply as soon as you notice the card is missing. Without a valid card you cannot open a bank account or sign a contract, and long gaps can affect your residency record.',
      ko: '분실을 확인하면 바로 신청하세요. 유효한 등록증이 없으면 계좌 개설이나 계약을 할 수 없고, 오래 방치하면 체류 기록에 불이익이 생길 수 있습니다.',
    },
    sources: ['hikorea', 'moj'],
    chips: [
      { next: 'visa-extension' },
      { next: 'alien-reg-cert' },
      { next: 'address-change' },
    ],
  },

  /* 신규 — UI 의 "비자 연장에 필요한 서류가 뭔가요?" 에 대응하는 카드가 없었다.

     경계 주의: api/chat.js 의 systemChat 은 비자 심사 결과 예측을 금지하고
     1345 로 넘긴다. 이 카드는 "필요 서류"만 다루고 허가 여부·소요 기간은
     예측하지 않는다. warn 이 그 선을 명시하고 legalAdjacent 로 기관 연결을
     유도한다. 서류가 체류자격마다 다르다는 점이 이 답변의 핵심이다. */
  'visa-extension': {
    topic: 'admin',
    asOf: '2026-08',
    match: [
      /visa.*(extend|extension|renew)/i, /extend.*(visa|stay|residence)/i,
      /비자.*(연장|갱신)/, /체류기간.*연장/, /연장.*(서류|신청)/,
      /gia hạn.*(visa|thị thực)/i,                              // vi
      /(延长|延長).*(签证|簽證)|(签证|簽證).*(延长|延長)/,          // zh
    ],
    q: { en: 'What documents do I need to extend my visa?', ko: '비자 연장에 필요한 서류가 뭔가요?' },
    verdict: {
      tone: 'caution',
      en: 'The documents depend on your visa type, so check the list for your own status before you go. Four things are always needed; the rest changes by status.',
      ko: '필요 서류는 체류자격마다 다르므로 방문 전에 본인 자격에 맞는 목록을 확인해야 합니다. 공통으로 필요한 네 가지가 있고, 나머지는 자격에 따라 달라집니다.',
    },
    docs: [
      { en: 'Passport', ko: '여권', term: '여권' },
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
      { en: 'Integrated application form — for extension of stay',
        ko: '통합신청서 — 체류기간 연장 허가 신청용', term: '통합신청서' },
      { en: 'Fee — the amount depends on your status, so check it on HiKorea before you go',
        ko: '수수료 — 체류자격에 따라 다르므로 하이코리아에서 미리 확인', term: '수수료' },
      { en: 'Documents specific to your status — for a student, proof of enrolment; for a worker, proof of employment. Check your own status on HiKorea.',
        ko: '체류자격별 추가 서류 — 유학은 재학증명, 취업은 재직증명 등. 본인 자격을 하이코리아에서 확인하세요.', term: '체류자격별 서류' },
    ],
    where: [
      { en: 'HiKorea — apply online, or check the document list for your status',
        ko: '하이코리아 — 온라인 신청 또는 자격별 서류 목록 확인', term: '하이코리아' },
      { en: 'Immigration office — reserve your visit on HiKorea first',
        ko: '출입국·외국인청 — 하이코리아에서 방문 예약', term: '출입국·외국인청' },
      { en: 'Foreigner helpline 1345 — 20 languages, free. Ask them which documents your status needs.',
        ko: '외국인종합안내센터 1345 — 20개 언어, 무료. 본인 자격에 필요한 서류를 물어보세요.', term: '외국인종합안내센터' },
    ],
    warn: {
      en: 'Apply before your current permission expires. Overstaying even by a short period is a separate violation with its own penalty, and it stays on your record. Whether an extension is granted, and how long it takes, depends on your individual case — nobody can tell you the outcome in advance, so confirm with 1345 or the immigration office rather than relying on a general answer.',
      ko: '현재 체류기간이 끝나기 전에 신청하세요. 짧게라도 초과 체류하면 그 자체가 별도의 위반이고 기록에 남습니다. 연장 허가 여부와 소요 기간은 개인 사정에 따라 달라 누구도 미리 알려줄 수 없으므로, 일반적인 답변에 의존하지 말고 1345 또는 출입국·외국인청에서 확인하세요.',
    },
    sources: ['hikorea', 'moj'],
    chips: [
      { next: 'arc-reissue' },
      { next: 'address-change' },
      { next: 'health-insurance', en: 'Do unpaid insurance premiums matter?', ko: '건강보험료 체납이 영향을 주나요?' },
    ],
    legalAdjacent: true,
    faceToFace: true,
  },

  /* ══ 의료 ════════════════════════════════════════════════ */

  'health-insurance': {
    topic: 'medical',
    asOf: '2026-08',
    match: [
      /health insurance/i, /insurance.*foreigner/i, /insurance.*available/i,
      /건강보험/, /보험.*가입/,
      /bảo hiểm y tế/i,                            // vi
      /健康保险|健康保險|医疗保险|醫療保險/,          // zh
    ],
    q: { en: 'Is health insurance available to foreigners?', ko: '외국인도 건강보험이 적용되나요?' },
    verdict: {
      tone: 'yes',
      en: 'Yes. If you stay in Korea for six months or more, national health insurance is mandatory, not optional.',
      ko: '네. 6개월 이상 국내에 체류하면 건강보험 가입은 선택이 아니라 의무입니다.',
    },
    docs: [
      { en: 'Alien Registration Card', ko: '외국인등록증', term: '외국인등록증' },
      { en: 'Passport', ko: '여권', term: '여권' },
    ],
    where: [
      { en: 'If you are employed, your workplace enrols you as an employee subscriber',
        ko: '직장에 다니면 회사가 직장가입자로 가입 처리합니다', term: '직장가입자' },
      { en: 'Otherwise, enrol yourself at a National Health Insurance Service branch',
        ko: '그 외에는 국민건강보험공단 지사에서 지역가입자로 가입', term: '지역가입자' },
      { en: 'NHIS helpline 1577-1000 — several languages', ko: '건강보험공단 1577-1000 — 다국어 상담', term: '국민건강보험공단' },
    ],
    warn: {
      en: 'Unpaid premiums can count against you when you extend your visa or change your status. If the premium is hard to pay, ask the branch about instalments before the arrears build up.',
      ko: '보험료를 내지 않으면 비자 연장이나 체류자격 변경에서 불이익을 받을 수 있습니다. 부담이 되면 체납이 쌓이기 전에 지사에 분할납부를 문의하세요.',
    },
    sources: ['nhis', 'hikorea'],
    chips: [
      { next: 'where-to-go-cold' },
      { next: 'english-hospital' },
    ],
  },

  'where-to-go-cold': {
    topic: 'medical',
    asOf: '2026-08',
    match: [
      /(cold|flu|fever|cough)/i, /감기|열이 ?나|기침|열 ?나/,
      /where .*(go|hospital).*(sick|ill)/i, /어디로 ?가/,
      /sốt/i,                               // vi
      /发烧|發燒|感冒/,                       // zh
    ],
    q: { en: 'I have a fever — where should I go?', ko: '열이 나는데 어디로 가야 하나요?' },
    verdict: {
      tone: 'yes',
      en: 'Go to a neighbourhood clinic, not a large hospital and not the emergency room.',
      ko: '큰 병원이나 응급실이 아니라 동네 의원으로 가세요.',
    },
    docs: [
      { en: 'Alien Registration Card, or your passport', ko: '외국인등록증 또는 여권', term: '외국인등록증' },
      { en: 'Health insurance card, if you have one', ko: '건강보험증이 있으면 함께', term: '건강보험증' },
    ],
    where: [
      { en: 'A neighbourhood clinic — internal medicine, or ear-nose-throat',
        ko: '동네 의원 — 내과 또는 이비인후과', term: '의원' },
      { en: 'A pharmacy, with the prescription the clinic gives you',
        ko: '약국 — 의원에서 받은 처방전 지참', term: '처방전' },
      { en: 'To find one open now — E-Gen portal, or call 1339',
        ko: '지금 문을 연 곳 찾기 — 응급의료포털 E-Gen 또는 1339', term: '응급의료포털' },
    ],
    warn: {
      en: 'Prescription medicine is only sold at a pharmacy with a doctor’s prescription, so the clinic visit comes first. Without health insurance you pay the full cost yourself. If breathing is hard, the chest hurts, or the person is not responding, that is not a clinic visit — call 119.',
      ko: '처방약은 의사 처방전이 있어야 약국에서 살 수 있으므로 의원 방문이 먼저입니다. 건강보험이 없으면 전액 본인이 부담합니다. 숨쉬기 어렵거나 가슴이 아프거나 의식이 없으면 의원이 아니라 119입니다.',
    },
    sources: ['egen', 'nhis'],
    chips: [
      { next: 'english-hospital' },
      { next: 'health-insurance' },
    ],
  },

  'english-hospital': {
    topic: 'medical',
    asOf: '2026-08',
    match: [
      /english.*(hospital|doctor|clinic|speaking|speaks)/i, /hospital.*english/i,
      /영어.*(병원|의사|가능|되는)/,
      /(bệnh viện|bác sĩ).*tiếng anh|tiếng anh.*(bệnh viện|bác sĩ)/i,   // vi
      /(英语|英語).*(医院|醫院|医生|醫生)|(医院|醫院).*(英语|英語)/,      // zh
    ],
    q: { en: 'How do I find a hospital that speaks English?', ko: '영어가 되는 병원을 찾고 싶어요.' },
    verdict: {
      tone: 'yes',
      en: 'Call 1339 and ask them to find one near you. The line runs in several languages and can call the hospital ahead for you.',
      ko: '1339에 전화해 근처 병원을 찾아달라고 하세요. 다국어로 운영되며 병원에 미리 연락해 주기도 합니다.',
    },
    where: [
      { en: 'Emergency Medical Information Centre 1339 — 24 hours, several languages',
        ko: '응급의료정보센터 1339 — 24시간, 다국어', term: '응급의료정보센터' },
      { en: 'E-Gen portal — search by department and by language',
        ko: '응급의료포털 E-Gen — 진료과·언어로 검색', term: '응급의료포털 E-Gen' },
      { en: 'Foreigner helpline 1345 — 20 languages, free', ko: '외국인종합안내센터 1345 — 20개 언어, 무료', term: '외국인종합안내센터' },
      { en: 'Your local global centre, for someone to come with you',
        ko: '지자체 외국인주민지원센터 — 동행 지원 문의', term: '외국인주민지원센터' },
    ],
    warn: {
      en: '“English available” often means one staff member on certain days only. Call the hospital before you travel and confirm both the department and the time.',
      ko: '“영어 가능”은 특정 요일에 담당자 한 명만 있는 경우가 많습니다. 출발하기 전에 병원에 전화해 진료과와 시간을 함께 확인하세요.',
    },
    sources: ['egen', 'hikorea'],
    chips: [
      { next: 'where-to-go-cold' },
      { next: 'health-insurance' },
    ],
    faceToFace: true,
  },
};

/* ══ 검색 ═══════════════════════════════════════════════════
   정규식 히트 수로 점수를 내고 같은 분야면 가산한다. 임베딩도 벡터DB도
   쓰지 않는다 — README 의 "빌드 단계 없음 / 의존성 0" 을 지키기 위해서다.
   카드 12장 규모에서는 이 정도로 충분하고, 무엇이 왜 매칭됐는지 읽을 수 있다. */
export function findCard(text, topic) {
  if (!text) return null;
  let bestId = null;
  let bestScore = 0;

  for (const [id, card] of Object.entries(CARDS)) {
    let score = 0;
    for (const re of card.match || []) if (re.test(text)) score += 1;
    if (!score) continue;
    if (topic && topic !== 'auto' && card.topic === topic) score += 0.5;
    if (score > bestScore) { bestScore = score; bestId = id; }
  }

  return bestId ? { id: bestId, card: CARDS[bestId] } : null;
}

/* ══ 프롬프트 주입 ═══════════════════════════════════════════
   카드를 systemChat 이 그대로 이어붙일 수 있는 텍스트로 만든다.
   한국어 UI 에서는 ko 본문을, 그 외에는 en 본문을 준다 — 모델이 en 을
   대상 언어로 옮기는 편이 ko 를 거치는 것보다 자연스럽다. */
const pick = (obj, lang) => (lang === 'ko' ? obj.ko : obj.en) || obj.en;

const line = (item, lang) => {
  const body = pick(item, lang);
  /* 한국어 UI 는 본문이 이미 한국어이므로 term 을 병기하지 않는다. */
  return lang === 'ko' || !item.term || body.includes(item.term)
    ? `- ${body}`
    : `- ${body} (${item.term})`;
};

export function groundingFor(card, lang) {
  const out = [
    '# Verified reference data',
    '',
    'A human checked the following against the institutions listed under Basis.',
    'Build your answer on it. Do not contradict it, and do not add documents, offices,',
    'fees or deadlines that are not here. If the question goes past this data, answer',
    'from what is here and say plainly which part you cannot confirm.',
    '',
    `Collected: ${card.asOf}`,
    '',
    `## Conclusion (${card.verdict.tone})`,
    pick(card.verdict, lang),
  ];

  if (card.docs?.length) {
    out.push('', '## What they need', ...card.docs.map(d => line(d, lang)));
  }
  if (card.where?.length) {
    out.push('', '## Where and how', ...card.where.map(w => line(w, lang)));
  }
  if (card.warn) {
    out.push('', '## What can go wrong', pick(card.warn, lang));
  }

  out.push('', '## Basis — name these in your answer');
  for (const key of card.sources) {
    const s = SOURCES[key];
    if (s) out.push(`- ${pick(s.label, lang)}`);
  }

  if (card.legalAdjacent) {
    out.push('', 'This topic sits next to a legal or immigration decision. Explain the',
      'procedure only. Do not predict an outcome, a timeline, or who is at fault.');
  }

  return out.join('\n');
}

/* ══ 후속 질문 ══════════════════════════════════════════════
   chips 는 이미 사람이 고른 다음 질문이다. 모델이 새로 지어내게 하지 않고
   이 문구를 쓰게 한다 — 대화 그래프가 유지되고 답변 품질이 예측 가능해진다. */
export function followupsFor(card, lang) {
  return (card.chips || [])
    .map(c => {
      if (c.en || c.ko) return pick(c, lang);
      const target = CARDS[c.next];
      return target ? pick(target.q, lang) : '';
    })
    .filter(Boolean)
    .slice(0, 3);
}

/* ══ 출처 블록 ══════════════════════════════════════════════
   <<<SRC>>> 뒤에 붙는 페이로드. 첫 줄이 수집 시점, 그 뒤는 `라벨|URL`.
   마커 이름이 3글자인 이유는 index.html 의 꼬리 절단 정규식이
   [A-Z]{0,6} 까지만 잘라내기 때문이다 — SOURCES(7자) 는 스트리밍 중
   S 한 글자가 화면에 새어나온다. */
export function sourceBlockFor(card, lang) {
  const lines = [card.asOf];
  for (const key of card.sources) {
    const s = SOURCES[key];
    if (s) lines.push(`${pick(s.label, lang)}|${s.url}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}
