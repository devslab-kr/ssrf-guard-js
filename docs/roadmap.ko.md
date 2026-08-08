# 로드맵

[English](roadmap.md)

무엇이 끝났고, 무엇이 대기 중이며, 무엇을 의도적으로 하지 않기로 했는지.
2026-08-08 신설 — "다음" 섹션 위쪽은 CHANGELOG와 머지된 PR에서 소급 정리한
내용이다.

자매 라이브러리: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). 둘은 보안 모델을 공유하지만 릴리스 라인은 공유하지 않는다 —
[JS-010](decisions.ko.md#js-010--jvm-자매와-독립된-버전-라인) 참조.

## 현재 상태

- **배포:** `@devslab/ssrf-guard-js` **0.5.0** (npm, 2026-07-30)
- **테스트:** 9개 파일 153개, 2026-08-08 기준 전부 통과
- **엔트리 포인트:** 루트(`.`)와 `./vite`
- **선택 peer:** `undici >=6` (`safeFetch`의 DNS 피닝 활성화)
- **프로덕션 소비자:** AskLinq (`devslab-kr/asklinq`) — URL 인제스트,
  브랜드 컬러 탐지, LLM 툴 입력 가드, API 브리지 실행기
- **문서 사이트:** <https://devslab-kr.github.io/ssrf-guard-js/> (영어만)

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

두 릴리스는 소비자 통합 피드백에서 직접 나왔다 — 0.4.0(AskLinq가 리다이렉트
루프를 손으로 짜고 있었다)과 0.5.0(두 옵션 모두 같은 통합에서 요청).

## 다음

### `[Unreleased]` 변경분 릴리스 — **결정 필요**

머지됐지만 미출시인 변경 2건이 `main`에 있다:

- TypeScript 7 빌드 툴체인 (PR #15) — 소비자 영향 없음
- `action-gh-release` v2 → v3, Node 20 deprecation (PR #16) — CI 전용,
  **아직 CHANGELOG에 기재되지 않음**

둘 다 배포 동작을 바꾸지 않아서 릴리스를 강제하는 요인은 없다. 선택지:
툴체인 이전을 npm 히스토리에 남기려면 **0.5.1** 태그, 아니면 실질 변경이
처음 들어올 때 함께 출시. 어느 쪽이든 PR #16 항목을 `[Unreleased]`에
먼저 추가할 것.

## 후보

확정이 아니라 제안이며, 우선순위는 소유자 확인을 기다리는 권고다. 각 항목은
실제 소비자에서 관측된 사실이거나 JVM 자매와의 격차에 근거한다.

### P1 — 예외를 던지지 않는 URL 판정 API

`validateUrl`은 예외를 던지고 `HostPolicy.allows()`는 호스트만 본다. 그래서
"이 링크를 큐에 넣어도 되나"를 판단하려는 소비자가 부를 수 있는, 정책 모양의
API가 없다. AskLinq 크롤러는 결국 `target.hostname !== base.hostname`을 손으로
쓴다(`ingest/url.ts`의 `extractSameSiteLinks`) — 이는 `sameSitePolicy`와 조용히
어긋난다. `www.` 제거 규칙 때문에, **fetch 가드였다면 허용했을** apex ↔ `www`
링크가 시도조차 되기 전에 버려진다. 실제 가드와 어긋나는 정책 로직 중복은
0.1.2 우회를 만들어낸 바로 그 실패 형태다.

형태: `isUrlAllowed(url, policy): boolean` 또는 던지지 않고 결과를 돌려주는
`checkUrl(url, policy)` — `validateUrl`과 같은 코드 경로, 다른 반환 규약.

### P1 — 가드 fetch의 응답 크기 상한

AskLinq의 두 호출부 모두 응답 크기를 **본문을 전부 읽은 뒤** 스스로 자른다
(`bridge/execute.ts`의 `BRIDGE_RESPONSE_MAX_CHARS`, `ingest/url.ts`의
`MAX_BODY_CHARS`). 다운로드가 끝난 뒤의 상한은 보호가 아니라 편의다 — 바이트는
이미 전선을 건넜다. `guardedFetch` / `safeFetch`에 스트림을 중간에 끊는
`maxBytes` 옵션이 있으면 보호가 되고, 무한히 흘려보내는 SSRF 표적은 실재하는
부류다.

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
언어인데, `site/index.html`은 영어뿐이다. 랜딩 페이지의 한국어 짝.

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
