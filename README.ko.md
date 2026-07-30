# ssrf-guard-js

[![npm](https://img.shields.io/npm/v/%40devslab%2Fssrf-guard-js)](https://www.npmjs.com/package/@devslab/ssrf-guard-js)
[![CI](https://github.com/devslab-kr/ssrf-guard-js/actions/workflows/ci.yml/badge.svg)](https://github.com/devslab-kr/ssrf-guard-js/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?logo=typescript&logoColor=white)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue)](./LICENSE)

**[문서 사이트](https://devslab-kr.github.io/ssrf-guard-js/)** · [English](README.md)

JavaScript / TypeScript용 SSRF 방어 라이브러리입니다.

Java/JVM용 [`devslab-kr/ssrf-guard`](https://github.com/devslab-kr/ssrf-guard)의
핵심 보안 모델을 JS/TS로 옮깁니다.

- URL 검증: scheme, host allowlist, port, userinfo, IP literal 차단
- private/local network IP 분류
- LLM tool-call JSON 안에 숨어 있는 URL 검사
- URL, DNS, redirect를 재검증하는 guarded fetch

## 설치

```bash
pnpm add @devslab/ssrf-guard-js
```

복붙해서 바로 따라 하는 튜토리얼은 문서 사이트를 보세요.

https://devslab-kr.github.io/ssrf-guard-js/

## URL 검증

```ts
import { validateUrl } from '@devslab/ssrf-guard-js';

validateUrl('https://api.example.com/v1', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
  allowedPorts: [-1, 443],
});
```

`exactHosts`와 `suffixes`가 비어 있으면 아무 host도 허용하지 않습니다.
기본 동작은 fail-closed입니다.

## LLM Tool Input Guard

```ts
import { guardToolInputJson } from '@devslab/ssrf-guard-js';

const violation = guardToolInputJson(
  JSON.stringify({ request: { target: 'http://169.254.169.254/latest/meta-data/' } }),
  { exactHosts: ['api.example.com'] },
);

if (violation) {
  return violation;
}
```

JSON 전체를 재귀적으로 검사합니다. URL이 nested object나 array 어디에 숨어 있어도
차단됩니다. `scheme://` URL 전부(정책의 `allowedSchemes`가 결과를 결정하므로
`file://`, `gopher://`는 기본 차단)와 protocol-relative `//host` 문자열을
수집해 host policy로 검증합니다.

기본 동작은 문자열의 (trim된) 전체 값이 URL인 경우만 잡습니다. 긴 문장 한가운데
묻힌 URL — `"summarize http://169.254.169.254/ please"` — 까지 잡으려면
embedded 스캔을 opt-in 하세요:

```ts
guardToolInputJson(toolInput, policy, { scanEmbedded: true });
```

`scanEmbedded`는 엄격히 additive입니다(기본 스캐너가 잡던 것은 전부 그대로
잡습니다). 그리고 의도적으로 공격적입니다: 산문이나 코드 스니펫 안의 URL 모양
텍스트도 policy로 검증하므로, allowlist 밖의 host는 그 자리에서 위반으로
처리됩니다. URL 꼬리에 붙은 문장 부호(`…see https://spec.example/docs,`)는
검증 전에 잘라냅니다.

## Guarded Fetch

```ts
import { safeFetch } from '@devslab/ssrf-guard-js';

const response = await safeFetch('https://api.example.com/data', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
});
```

`safeFetch`는 URL을 검증하고, DNS 결과가 private/local IP인지 확인하고
(resolve된 주소 중 하나라도 private이면 fail-closed), redirect hop마다 다시
검증합니다. Cross-origin redirect에서는 `Authorization` / `Proxy-Authorization` /
`Cookie` 헤더를 제거하고, `303`(그리고 `POST`의 `301`/`302`)은 body 재전송 없이
`GET`으로 다운그레이드합니다.

`safeFetch`와 `guardedFetch` 모두 `onFinalUrl` 콜백을 받습니다 — 모든 redirect
hop을 따라간 뒤의 최종 검증 URL로 호출됩니다. 가져온 콘텐츠의 실제 출처를
라벨링할 때 쓰세요. 일부 fetch 구현(커스텀 `fetchImpl` 포함)은 `Response.url`을
비워 두므로 그보다 신뢰할 수 있습니다. fetch가 throw하면 호출되지 않습니다.

```ts
let finalUrl: URL | undefined;
const response = await safeFetch(input, policy, {
  onFinalUrl: (url) => {
    finalUrl = url;
  },
});
```

### DNS pinning (optional)

기본 동작은 DNS 검증과 실제 연결이 hostname을 따로 resolve하므로 작은
DNS-rebinding 창이 남습니다. optional [`undici`](https://www.npmjs.com/package/undici)
의존성을 설치하면 이 창이 닫힙니다:

```bash
pnpm add undici
```

`undici`가 있으면 `safeFetch`는 resolve된 주소를 **socket connector 안에서**
검증합니다 — 검증과 연결이 하나의 DNS resolution을 공유하는, Java Apache
HttpClient adapter와 같은 socket-level pinning입니다. `pinDns` 옵션으로 명시적
제어가 가능합니다:

```ts
await safeFetch(url, policy, { pinDns: true }); // pinning 필수 (undici 없으면 throw)
await safeFetch(url, policy, { pinDns: false }); // check-then-fetch 강제
```

`undici` 없이는 check-then-fetch로 동작합니다. 그것도 강한 가드레일이지만,
위험도가 높은 임의 URL 크롤링은 strict allowlist나 별도 guarded egress
service를 사용하세요.

## Runtime 지원: Node vs Cloudflare Workers

모든 보장이 모든 runtime에서 살아남는 건 아닙니다. 어느 절반을 쓰게 되는지
알고 시작하세요:

| Surface | Node | Cloudflare Workers |
| --- | --- | --- |
| `validateUrl` / `UrlPolicy` / `HostPolicy` | ✅ | ✅ (순수 URL/문자열 검증) |
| `guardToolInput` / `guardToolInputJson` / `createGuardedToolHandler` | ✅ | ✅ |
| `guardedFetch` + `sameSitePolicy` (URL-time + redirect 재검증) | ✅ | ✅ |
| `safeFetch` (DNS 검증 추가) | ✅ | ❌ 런타임에서 throw |
| `undici` DNS pinning | ✅ optional | ❌ |

**Workers에서 `safeFetch`가 동작할 수 없는 이유.** `safeFetch`는 연결 전에
`node:dns/promises`의 `lookup`으로 대상을 resolve합니다. Workers의
`node:dns`(`nodejs_compat` flag)는 `resolve*` 계열을 DNS-over-HTTPS로
구현하지만 `lookup`은 `Not implemented`를 던집니다 — 설령 resolve가 되더라도
Workers의 `fetch`는 내부적으로 자체 resolution을 수행하므로, Node의 `undici`
connector처럼 검증한 IP를 socket에 고정하는 것이 userland에서 불가능합니다.
check-then-fetch 간극은 Worker 안에서는 닫을 수 없습니다. (패키지 import는
항상 안전합니다 — `node:dns`는 lazy load되고, 없는 환경에서 `safeFetch`를
호출하면 여기를 가리키는 typed `SsrfGuardError`가 던져집니다.)

**Workers에서는 `guardedFetch`를 쓰세요.** `safeFetch`와 같은 redirect
재검증·credential 스트리핑·method 다운그레이드 의미론에서 DNS 검증만 뺀
것입니다 — 따라서 policy allowlist가 1차 방어선이고, fail-closed 기본값
(빈 allowlist는 아무것도 허용하지 않음)이 실질적인 역할을 합니다:

```ts
import { guardedFetch } from '@devslab/ssrf-guard-js';

const res = await guardedFetch('https://api.example.com/data', {
  exactHosts: ['api.example.com'],
  allowedSchemes: ['https'],
});
```

특정 host를 열고 싶으면 allowlist에 넣으세요 — 그것이 곧 bypass 메커니즘이고,
한 곳에서 감사 가능하게 유지됩니다. "고객이 제출한 자기 사이트 크롤링"
흐름이라면 `sameSitePolicy`로 제출된 URL에서 allowlist를 유도하세요 —
redirect를 포함한 fetch 전체가 그 도메인에 잠깁니다 (`www.`는 벗겨서
apex ↔ www redirect가 살아남음):

```ts
import { guardedFetch, sameSitePolicy } from '@devslab/ssrf-guard-js';

const input = 'https://www.customer-site.example/about';
const res = await guardedFetch(input, sameSitePolicy(input, { allowedSchemes: ['https'] }));
```

Workers에서 진짜 임의 URL fetch가 필요하면, `pinDns: true`로 `safeFetch`를
호출하는 작은 Node 기반 egress service를 거치세요 — Worker는 egress service와만
통신하고, 사용자 제공 URL에는 직접 닿지 않습니다.

## Express

```ts
import express from 'express';
import { createExpressUrlGuard } from '@devslab/ssrf-guard-js';

const app = express();
app.use(express.json());

app.post(
  '/crawl',
  createExpressUrlGuard({
    exactHosts: ['example.com'],
    suffixes: ['example.com'],
    allowedSchemes: ['https'],
  }),
  async (req, res) => {
    res.json({ ok: true });
  },
);
```

기본으로 `req.body`와 `req.query`를 검사합니다. 차단해야 할 URL이 있으면 구조화된
`400` 응답을 반환합니다.

## Vite

Vite dev server의 SSR/proxy endpoint가 URL을 받아 server-side fetch를 하는 경우에 사용합니다.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { ssrfGuardVitePlugin } from '@devslab/ssrf-guard-js/vite';

export default defineConfig({
  plugins: [
    ssrfGuardVitePlugin({
      routes: ['/api/crawl'],
      policy: {
        suffixes: ['example.com'],
        allowedSchemes: ['https'],
      },
    }),
  ],
});
```

기본으로 `url`, `target`, `uri`, `href` query param을 검사합니다.
예를 들어 아래 요청은 차단됩니다.

```text
/api/crawl?url=http://169.254.169.254/latest/meta-data/
```

## LangChain / Agent Tool

`createGuardedToolHandler`는 LangChain에 직접 의존하지 않고 object-input tool 함수를 감쌉니다.

```ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { createGuardedToolHandler, safeFetch } from '@devslab/ssrf-guard-js';

const policy = {
  suffixes: ['example.com'],
  allowedSchemes: ['https'],
};

export const fetchUrlTool = new DynamicStructuredTool({
  name: 'fetch_url',
  description: 'Fetch an allowed URL',
  schema: z.object({ url: z.string().url() }),
  func: createGuardedToolHandler(policy, async ({ url }) => {
    const response = await safeFetch(url, policy);
    return await response.text();
  }),
});
```

모델이 private IP, metadata URL, 허용되지 않은 host를 넘기면 실제 fetch를 하지 않고
`ssrf_blocked` JSON 문자열을 tool 결과로 반환합니다.

## Family

- [ssrf-guard](https://github.com/devslab-kr/ssrf-guard) — JVM 자매 라이브러리: 같은 보안 모델을 Spring Boot의 9개 HTTP 클라이언트 모듈에 적용, LLM 에이전트 툴 URL 검증용 `-springai` / `-langchain4j` 포함
- [devslab](https://github.com/devslab-kr)의 다른 오픈소스

## License

[Apache-2.0](./LICENSE)
