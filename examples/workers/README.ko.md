# ssrf-guard-js-workers-demo

[English](README.md)

**Cloudflare Workers**에서의 SSRF 방어를
[`@devslab/ssrf-guard-js`](https://github.com/devslab-kr/ssrf-guard-js)로 —
`kr.devslab:ssrf-guard`의 JS/TS 자매 라이브러리입니다.

이 repo의 다른 ssrf-guard 데모는 전부 Spring HTTP 클라이언트를 가드합니다. 이건
엣지 이야기이고, **다른 이야기**입니다: Workers에는 쓸 수 있는 `dns.lookup`이
없고, 설령 있어도 `fetch`가 호스트를 자체적으로 해석하므로 유저랜드 DNS 검사를
실제 연결되는 소켓에 고정할 수 없습니다.

라이브러리의 답은 **아닌 척하지 않는 것**입니다. `safeFetch`는 여기서 실행을
거부하고 `guardedFetch`를 가리키는 타입 있는 에러를 던집니다 — 같은 호출처럼
보이는 더 약한 검사로 슬그머니 격하되는 대신에요. 여전히 유효한 것: URL 시점
검증, 홉별 리다이렉트 재검증, 자격증명 제거, 응답 크기 상한, 툴 입력 스캐너 —
그리고 **허용 목록이 하중을 받습니다.**

## 실행

```bash
pnpm install
pnpm verify        # typecheck + 테스트. 네트워크도, Cloudflare 계정도 불필요
pnpm dev           # curl 해보고 싶으면 wrangler dev
```

## 엔드포인트

| 엔드포인트 | 보여주는 것 |
| --- | --- |
| `POST /crawl` | `guardedFetch` + `sameSitePolicy` — **사용자가 제출한** 사이트의 페이지 가져오기 |
| `POST /api-call` | `createHonoUrlGuard` 미들웨어 + `singleHostPolicy` — 등록된 엔드포인트 하나, 그 외 아무 데도 |
| `POST /tool-input` | `guardToolInputJson` + `scanEmbedded` — LLM 툴 인자 어디에 숨었든 |
| `GET /attack-matrix` | 알려진 SSRF 페이로드 17종을 `checkUrl`로 — 던지지 않고 **보고** |
| `GET /why-no-safe-fetch` | 위의 거부를 실물로 |

## 정책 두 개, 왜 둘 다 있나

일부러 둘 다 보여줍니다. **잘못 고르는 것**이 이 API 표면이 막으려는 실수라서요.

**`/api-call`은 미들웨어를 씁니다.** 엔드포인트가 미리 정해져 있으니 고정
허용 목록을 **핸들러가 돌기 전에** 강제할 수 있습니다 — request body의 어느
필드에 URL을 숨겨 넣어도 당신 코드에 닿지 않습니다.

**`/crawl`은 미들웨어를 쓸 수 없고**, 그건 빠뜨린 게 아닙니다. 이 정책은
*사용자가 제출한 것에서 파생*됩니다 — `sameSitePolicy(url)`이 리다이렉트를
포함한 fetch 전체를 그 도메인에 잠급니다. 고정 허용 목록이면 모든 제출을
거부하고, 느슨하게 두면 갖지도 않은 안전 속성을 주장하게 됩니다. **가드는 fetch
시점에 있어야 합니다.**

## `singleHostPolicy`는 포트도 잠급니다

이 데모의 등록된 API는 `https://api.example.com:8443/v1`이고, 공격 매트릭스에
읽어볼 값어치가 있는 행이 있습니다:

```
https://api.example.com/v1/ok      blocked_port
https://api.example.com:8443/v1/ok allowed
```

같은 호스트, 같은 스킴인데 **포트 하나로 차단**됩니다. 이걸 손으로
`{ exactHosts: [u.hostname] }`라고 쓰면 그 정책은 **자기 base URL을 거부합니다**
— 패키지 기본 `allowedPorts`가 `[-1, 80, 443]`이기 때문입니다. 조용히, 그리고
비표준 포트를 쓰는 배포에서만.

## 테스트가 증명하는 것과 못 하는 것

`pnpm test`는 Hono의 request 헬퍼로 Worker를 구동하고 `fetch`를 주입하므로,
네트워크 없이 가드의 **동작**을 단언합니다: 어떤 페이로드가 거부되는지, 어떤
사유가 발동하는지, 차단된 리다이렉트가 두 번째 홉을 **발행하지 않는지**.

다만 **Node에서 돕니다.** Workers 런타임이 아닙니다. 그래서
`GET /why-no-safe-fetch`는 응답 **모양**만 단언합니다 — Node에는 `node:dns`가
있어서 `safeFetch`가 실제 조회까지 가고, Worker에서와는 **다른 이유로** 실패합니다.
거기서 Workers 전용 메시지를 단언하면 **엉뚱한 이유로 통과하는 테스트**가 됩니다.

## 버전

- `@devslab/ssrf-guard-js` 0.7.1 — `checkUrl`/`isUrlAllowed`(0.6.0),
  `maxBytes`(0.6.0), `singleHostPolicy`과 Hono 미들웨어(0.7.0)
- `hono` 4.x
