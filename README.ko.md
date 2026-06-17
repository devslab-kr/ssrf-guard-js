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

`safeFetch`는 URL을 검증하고, DNS 결과가 private/local IP인지 확인하고,
redirect hop마다 다시 검증합니다.

Node의 built-in `fetch`는 Java Apache HttpClient처럼 socket-level IP pinning API를
노출하지 않습니다. 위험도가 높은 임의 URL 크롤링은 strict allowlist나 별도 guarded
egress service를 사용하세요.

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
