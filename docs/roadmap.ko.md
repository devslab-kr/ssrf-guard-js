# 로드맵

[English](roadmap.md)

무엇이 끝났고, 무엇이 대기 중이며, 무엇을 의도적으로 하지 않기로 했는지.
2026-08-08 신설 — "다음" 섹션 위쪽은 CHANGELOG와 머지된 PR에서 소급 정리한
내용이다.

자매 라이브러리: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). 둘은 보안 모델을 공유하지만 릴리스 라인은 공유하지 않는다 —
[JS-010](decisions.ko.md#js-010--jvm-자매와-독립된-버전-라인) 참조.

## 현재 상태

- **배포:** `@devslab/ssrf-guard-js` **0.6.1** (npm, 2026-08-08)
- **테스트:** 12개 파일 191개, 2026-08-08 기준 전부 통과
- **런타임:** Node 22+·Bun·Deno를 배포된 패키지를 실제 설치해 확인, Workers는
  DNS를 뺀 절반
- **엔트리 포인트:** 루트(`.`)와 `./vite`
- **선택 peer:** `undici >=6` (`safeFetch`의 DNS 피닝 활성화)
- **프로덕션 소비자:** AskLinq (`devslab-kr/asklinq`) — URL 인제스트,
  브랜드 컬러 탐지, LLM 툴 입력 가드, API 브리지 실행기
- **문서 사이트:** <https://devslab-kr.github.io/ssrf-guard-js/> (한국어만)

## 출시 완료

| 버전 | 날짜 | 내용 |
| --- | --- | --- |
| 0.1.0 | 2026-06-18 | ✅ `UrlPolicy` / `validateUrl`, 사설 IP 분류, `safeFetch`, LLM 툴 입력 가드, Express 미들웨어, Vite 플러그인 |
| 0.1.1 | 2026-06-18 | ✅ `@devslab` npm 스코프로 배포, 릴리스 워크플로가 태그 ↔ `package.json` 일치 검증 |
| 0.1.2 | 2026-07-05 | ✅ **보안:** 툴 입력 스캐너의 대문자/혼합 대소문자 스킴 우회 |
| 0.2.0 | 2026-07-05 | ✅ **보안:** 공인+사설 혼합 DNS 응답 fail-closed, 교차 출처 자격증명 제거, fetch 스펙 리다이렉트 시맨틱, 비-`http` 스킴 및 프로토콜 상대 `//host` 스캔, 스킴 기본 포트 |
| 0.3.0 | 2026-07-05 | ✅ `undici` 기반 선택적 DNS 피닝(`pinDns`) — DNS 리바인딩 TOCTOU 창 차단 |
| 0.4.0 | 2026-07-13 | ✅ Workers/브라우저/엣지용 `guardedFetch` + `sameSitePolicy`, `node:dns` 지연 임포트, 리다이렉트 재검증 루프 공유 |
| 0.5.0 | 2026-07-30 | ✅ `scanEmbedded`(옵트인 문자열 중간 URL 추출), `onFinalUrl` 콜백, `GuardToolInputOptions` / `SafeFetchOptions` 공개 |
| 0.5.1 | 2026-08-08 | ✅ 유지보수: TypeScript 7 빌드 툴체인, `action-gh-release` v3, 버전 범프 머지 = 릴리스([JS-013](decisions.ko.md#js-013--머지가-곧-릴리스)), 이 로드맵과 결정 로그 |
| 0.6.0 | 2026-08-08 | ✅ `checkUrl` / `isUrlAllowed`(예외 없는 정책 판정), `maxBytes` 응답 상한과 신규 `blocked_response_size` 사유 |
| 0.6.1 | 2026-08-08 | ✅ **보안:** 피닝이 켜진 Bun에서 `safeFetch`가 DNS 검사를 전혀 하지 않던 문제(`undici` 설치 시 기본 동작) — 연결 전 검사를 모든 모드에서 실행([JS-016](decisions.ko.md#js-016--가드는-호스트가-훅을-존중해-주는-데-기대면-안-된다)) |

두 릴리스는 소비자 통합 피드백에서 직접 나왔다 — 0.4.0(AskLinq가 리다이렉트
루프를 손으로 짜고 있었다)과 0.5.0(두 옵션 모두 같은 통합에서 요청).

## 다음

**대기 중인 작업 없음.** 두 P1이 2026-08-08에 0.6.0으로 나갔다
([JS-014](decisions.ko.md#js-014--예외-없는-판정은-validate를-다시-구현하지-않고-잡는다),
[JS-015](decisions.ko.md#js-015--maxbytes는-자르지-않고-차단한다)). `[Unreleased]`는
비어 있고 `main`과 npm이 일치한다.

다음 실질 변경은 P2 중 무엇을 집느냐다. 그리고 이번 릴리스가 닫은 게 아니라
**만들어낸** 후속 작업이 있다: AskLinq가 손으로 쓴 `hostname !==` 링크 필터와
사후 크기 상한을 `isUrlAllowed`·`maxBytes`로 갈아야 한다. 그 전까지는 라이브러리만
API를 얻었고 소비자는 여전히 우회를 짊어지고 있다.

## 후보

확정이 아니라 제안이며, 우선순위는 소유자 확인을 기다리는 권고다. 각 항목은
실제 소비자에서 관측된 사실이거나 JVM 자매와의 격차에 근거한다.

### P2 — `singleHostPolicy(baseUrl)`

`sameSitePolicy`가 앞의 `www.`를 떼는 것은 "고객 자기 사이트 크롤"이라는 용도
때문이다. 등록된 정확한 호스트만 원하는 호출부는 정책을 손으로 다시 만든다
(`bridge/execute.ts`의 `policyFor`). `www.` 특례가 없는 형제 헬퍼면 충분하고,
호출부에서 두 의도가 눈으로 구분된다.

### P2 — Hono 미들웨어

프레임워크 어댑터는 Express와 Vite뿐인데, 유일한 프로덕션 소비자는 Cloudflare
Workers 위 Hono에서 `guardedFetch`를 직접 부른다. 이 패키지의 Workers-safe
절반이 자연스럽게 도착하는 곳도 Hono다. `./vite`처럼 별도 엔트리
포인트(`./hono`)로 내보내 루트 번들 밖에 둘 것.

### P2 — 문서 사이트 이중 언어

`README.md`에는 `README.ko.md`가 있고 JVM 자매의 mkdocs 사이트는 완전한 이중
언어인데, `site/index.html`은 한국어뿐이다. 랜딩 페이지의 영어 짝 — 이 격차는
repo의 나머지와 방향이 반대다. 다른 곳은 영어가 원본이고 `.ko.md`가 번역인데
여기만 거꾸로다. 랜딩 페이지는 npm 방문자가 가장 먼저 보는 화면이고, 한국어를
읽지 못하는 사람이 물러설 곳이 없는 유일한 표면이다.

### P2 — 지원 런타임별 CI 잡

*0.6.1로 대부분 닫힘.* Bun과 Deno를 실제로 설치해 돌렸고 README 지원 표에도
올렸다. 그리고 이 질문을 던진 결과 추측이 확인된 게 아니라 **보안 버그가
나왔다** — 핀 모드가 Bun에서 DNS 검사를 전부 없애고 있었다
([JS-016](decisions.ko.md#js-016--가드는-호스트가-훅을-존중해-주는-데-기대면-안-된다)).

남은 것은 그 상태를 **유지**하는 부분이다. CI는 여전히 Node 22 단일 잡이라,
Bun·Deno 결과는 한 번 잰 측정치일 뿐 유지되는 보장이 아니다. 런타임마다 잡을
추가한다. 단, JS-016 회귀 테스트가 `undici`를 목킹해 적대적 런타임 케이스를
**Node 스위트 안에서** 재현하므로, 런타임 매트릭스는 유일한 그물이 아니라
심층 방어다.

README에 이미 문서화됐고 이 항목이 계속 시야에 둘 것 두 가지:

- **`node:url`은 지연 import가 아니라 정적 import다.** `src/net.ts`의
  `normalizeHost`가 `domainToASCII`를 부르므로, 패키지의 "어디서나 도는"
  절반(`validateUrl`, `guardedFetch`, 툴 입력 가드)이 모듈 로드 시점에 Node
  빌트인을 끌어온다. 따라서 Workers는 README가 암시하는 `safeFetch`뿐 아니라
  `validateUrl`에도 `nodejs_compat`가 필요하고, 브라우저 번들은 번들러가
  이걸 공급해줘야 한다.
- **그렇다고 WHATWG URL 파서로 갈아끼워 "고치지" 말 것.** 드롭인처럼
  보인다 — `new URL('https://' + host).hostname`은 시도한 정상 케이스 17개에서
  `domainToASCII`와 전부 일치했다. 퓨니코드·혼동 문자(`ⓔxample.com` →
  `example.com`)·후행 점·IP 리터럴까지 포함해서다. 그런데 적대적 입력
  15개 중 4개에서 갈라졌고, **매번 안전하지 않은 방향**이었다.
  `domainToASCII`가 `''`를 돌려주는데 URL 파서는 호스트를 돌려준다:
  `api.example.com:443@evil.com` → `evil.com`, `user@evil.com` →
  `evil.com`, `127.0.0.1:80` → `127.0.0.1`. userinfo 트릭을 맨 호스트로
  풀어주는 정규화기는 0.1.2 우회와 같은 모양이다 — 하나의 필터를 두 번
  구현해 서로 어긋나는 것(아래 정합성 점검 항목 참조). 정적 import를 언젠가
  걷어내야 한다면, 찾아 바꾸기가 아니라 제대로 된 차분 테스트가 필요하다.

### P3 — JVM ↔ JS 정합성 정기 점검

0.1.2의 대문자 스킴 우회는 **양쪽 모두**에 있었다. 같은 URL 수집 필터를 각각
독립적으로 작성했기 때문이다. 두 모델이 여전히 일치하는지 확인하는 절차는
지금 없다. 스캐너 수집 규칙·IP 분류·리다이렉트 시맨틱·차단 사유를 담은 체크
리스트를, 어느 쪽이든 코어 로직이 바뀔 때 훑는다.

### P3 — `devslab-examples`의 JS 데모

`devslab-kr/devslab-examples`에는 `ssrf-guard-*` 데모가 8개 있고 전부 JVM이다.
JS 패키지를 보여주는 것은 없다. Workers 기반 데모라면 `guardedFetch` 쪽 절반의
런타임 검증도 겸한다.

### P3 — HTTP 클라이언트 어댑터 (의도적 보류)

JVM 자매가 클라이언트 어댑터 6종(RestTemplate·WebClient·Feign·OkHttp·JdkHttp·
HttpClient5)을 내는 이유는 그 클라이언트들이 요청 실행을 소유하기 때문이다. JS
에서는 `fetch`가 기반이고 `guardedFetch`/`safeFetch`가 이미 그것을 감싼다.
`axios`·`got`·`undici` 인터셉터 어댑터는 실제 요청이 나온 뒤에 만든다 — JVM의
모듈 개수는 맞춰야 할 목표가 아니다.

## 하지 않기로 한 것

- **"모든 호스트 허용" 모드.** fail-closed 기본값이 곧 제품이고, 허용 목록
  항목이 감사 가능한 유일한 우회다
  ([JS-001](decisions.ko.md#js-001--기본값은-fail-closed-호스트-허용-목록)).
- **Cloudflare Workers의 `safeFetch`.** 빠진 기능이 아니다 — check-then-fetch
  간극은 Worker 안에서 닫을 수 없다
  ([JS-006](decisions.ko.md#js-006--degraded-safefetch-대신-guardedfetch-분리)).
- **브라우저에서의 DNS 검사.** 같은 이유에, DNS API 자체가 없다.
- **JVM 자매와 버전 번호 맞추기.** 성숙도도 릴리스 주기도 다르다
  ([JS-010](decisions.ko.md#js-010--jvm-자매와-독립된-버전-라인)).

## 이 파일의 관리

변경을 머지하는 **같은 작업 흐름 안에서** 갱신한다 — 완료 항목은 날짜와 함께
체크하고, 계획 밖에 출시된 것도 그대로 기록한다. 유의미한 제품/아키텍처 결정은
나중이 아니라 그때 [decisions.ko.md](decisions.ko.md)에 남긴다. 두 문서 모두
`.ko.md` 짝이 있으니 항상 함께 갱신한다.
