# ssrf-guard-js

[English](README.md) | [문서 사이트](https://devslab-kr.github.io/ssrf-guard-js/)

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

JSON 전체를 재귀적으로 검사합니다. URL이 nested object, array, 설명 문장 안에 숨어 있어도
차단됩니다.

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
| `safeFetch` (DNS 검증, redirect 재검증) | ✅ | ❌ 런타임에서 throw |
| `undici` DNS pinning | ✅ optional | ❌ |

**Workers에서 `safeFetch`가 동작할 수 없는 이유.** `safeFetch`는 연결 전에
`node:dns/promises`의 `lookup`으로 대상을 resolve합니다. Workers의
`node:dns`(`nodejs_compat` flag)는 `resolve*` 계열을 DNS-over-HTTPS로
구현하지만 `lookup`은 `Not implemented`를 던집니다 — 설령 resolve가 되더라도
Workers의 `fetch`는 내부적으로 자체 resolution을 수행하므로, Node의 `undici`
connector처럼 검증한 IP를 socket에 고정하는 것이 userland에서 불가능합니다.
check-then-fetch 간극은 Worker 안에서는 닫을 수 없습니다.

**Workers에서는 이렇게 하세요.** URL-time 검증 + 모든 redirect hop 재검증을
직접 수행하고, strict allowlist를 1차 방어선으로 삼으세요:

```ts
import { validateUrl, type UrlPolicyOptions } from '@devslab/ssrf-guard-js';

const MAX_REDIRECTS = 5;

async function guardedWorkersFetch(input: string, policy: UrlPolicyOptions): Promise<Response> {
  let url = validateUrl(input, policy);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    url = validateUrl(new URL(location, url), policy); // 모든 hop이 같은 policy를 다시 통과
  }
  throw new Error(`too many redirects for ${input}`);
}
```

"고객이 제출한 자기 사이트 크롤링" 흐름이라면 allowlist를 하드코딩하지 말고
제출된 URL에서 유도하세요 — 한 번 검증한 뒤, redirect를 포함한 크롤링 전체를
그 도메인에 잠급니다:

```ts
const first = validateUrl(input, { rejectIpLiteralHosts: true, suffixes: [new URL(input).hostname] });
const policy = { allowedSchemes: ['https'], suffixes: [first.hostname.replace(/^www\./, '')] };
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

## License

Apache-2.0
