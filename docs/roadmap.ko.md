# 로드맵

[English](roadmap.md)

무엇이 끝났고, 무엇이 대기 중이며, 무엇을 의도적으로 하지 않기로 했는지.
2026-08-08 신설 — "다음" 섹션 위쪽은 CHANGELOG와 머지된 PR에서 소급 정리한
내용이다.

자매 라이브러리: [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)
(JVM). 둘은 보안 모델을 공유하지만 릴리스 라인은 공유하지 않는다 —
[JS-010](decisions.ko.md#js-010--jvm-자매와-독립된-버전-라인) 참조.

## 현재 상태

- **배포:** `@devslab/ssrf-guard-js` **0.7.2** (npm, 2026-08-17)
- **테스트:** 15개 파일 223개, 2026-08-17 기준 전부 통과
- **런타임:** Node 22+·Bun·Deno를 배포된 패키지를 실제 설치해 확인, Workers는
  DNS를 뺀 절반
- **엔트리 포인트:** 루트(`.`)·`./vite`·`./hono`
- **선택 peer:** `undici ^6.28.0 || >=7.29.0` (`safeFetch`의 DNS 피닝 활성화)
- **프로덕션 소비자:** AskLinq (`devslab-kr/asklinq`) — URL 인제스트,
  브랜드 컬러 탐지, LLM 툴 입력 가드, API 브리지 실행기
- **문서 사이트:** <https://devslab-kr.github.io/ssrf-guard-js/> — 영어,
  한국어는 `/ko/`

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
| 0.7.0 | 2026-08-08 | ✅ `singleHostPolicy`(origin 잠금, 포트 포함)과 `./hono`의 `createHonoUrlGuard` ([JS-018](decisions.ko.md#js-018--singlehostpolicy는-포트까지-포함해-origin을-잠근다), [JS-019](decisions.ko.md#js-019--hono-어댑터는-구조적-타이핑으로-쓰고-실제-hono로-검증한다)) |
| 0.7.1 | 2026-08-09 | ✅ **보안:** `::`와 `fec0::/10`을 공인으로 분류하고 있었음 — 첫 [JVM ↔ JS 정합성 감사](parity.ko.md)에서 발견, 같은 감사가 자바 쪽 [ssrf-guard#20](https://github.com/devslab-kr/ssrf-guard/pull/20)도 열었다 |
| 0.7.2 | 2026-08-17 | ✅ **보안 유지보수:** 취약한 undici 7.0.0–7.28.x peer 해석을 제외하고, 검증 도구를 undici 8.10.0과 Hono 4.13.2로 갱신 |
| — | 2026-08-09 | ✅ 문서 사이트: 영어 `/`, 한국어 `/ko/` ([JS-017](decisions.ko.md#js-017--랜딩-페이지도-repo의-짝-파일-규약을-따른다)) — 릴리스 아님, 사이트는 `main`에서 배포 |
| — | 2026-08-09 | ✅ 첫 JVM ↔ JS 정합성 감사 ([parity.ko.md](parity.ko.md)) — 양쪽 라이브러리에서 4건 수정, 1건 미해결 |
| — | 2026-08-09 | ✅ [devslab-examples](https://github.com/devslab-kr/devslab-examples)의 `ssrf-guard-js-workers-demo` — 그 repo의 첫 Node 데모 |

두 릴리스는 소비자 통합 피드백에서 직접 나왔다 — 0.4.0(AskLinq가 리다이렉트
루프를 손으로 짜고 있었다)과 0.5.0(두 옵션 모두 같은 통합에서 요청).

## 다음

**로드맵이 처음으로 비었다.** P1·P2·P3 항목이 전부 출시됐거나 의도적 비목표다:

| 항목 | 결과 |
| --- | --- |
| P1 — 예외 없는 판정, `maxBytes` | 0.6.0 |
| P2 — `singleHostPolicy`, Hono 미들웨어 | 0.7.0 |
| P2 — 문서 사이트 이중 언어 | 2026-08-09, 영어 `/`·한국어 `/ko/` |
| P2 — 지원 런타임별 CI 잡 | Node + Bun + Deno 매트릭스, 전 엔트리 포인트 커버 |
| P3 — JVM ↔ JS 정합성 감사 | 1회차 실행. 양쪽 라이브러리에서 4건 수정, 1건은 근거와 함께 미해결 |
| P3 — `devslab-examples`의 JS 데모 | `ssrf-guard-js-workers-demo`, 그 repo의 첫 Node 데모 |
| P3 — HTTP 클라이언트 어댑터 | 의도적으로 하지 않음 |

**이름이 붙은 남은 작업 하나**는 [parity.ko.md](parity.ko.md)에 있다: OkHttp가
리다이렉트 홉에서 자기 `Dns` 계층이 보는 것만 재검사한다 — 호스트 허용 목록과
사설 IP. 그래서 스킴·포트·userinfo·IP-리터럴이 재적용되지 않는다. 잔여 위험은
들리는 것보다 좁다. 호스트 허용 목록과 사설 IP 필터는 홉마다 여전히 작동하므로,
빠져나가는 건 **허용된 같은 호스트**의 다른 포트·스킴이거나 userinfo가 붙은
경우다. 닫으려면 JVM 3.3.0에서 `jdkhttp`가 받은 처리가 필요하다 — 클라이언트
자신의 추적을 끄고 루프를 직접 돌리기 — 그건 그 어댑터의 계약을 바꾸므로, 이미
파괴적 변경을 하나 실은 릴리스에 얹지 말고 자기 릴리스로 낸다.

이 repo 밖의 상시 후속: AskLinq는 D-034에서 `singleHostPolicy`는 채택했지만
`createHonoUrlGuard`는 **일부러** 안 했다 — 그 제품이 받는 모든 URL은 곧 거기에
잠가야 할 URL이라, 미들웨어가 강제할 정적 허용 목록이 없다. 이건 갭이 아니라
발견이다.

## 후보

대기 중인 것은 없다. 남은 건 의도적으로 하지 않기로 한 하나뿐이고, 같은 질문을
매번 처음부터 다시 하지 않도록 적어둔다.

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
