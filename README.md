# Cloudflare Product & Solution Explorer

Cloudflare의 공식 제품군과 solution을 학습하기 위한 정적 visualization project입니다.
TypeScript crawler가 공식 web source를 수집해 JSON으로 구조화하고, Angular web application이
생성된 JSON을 읽어 제품과 관계를 보여줍니다.

> 현재 repository는 documentation 및 planning 단계입니다. 아래 폴더와 command는 구현할
> interface이며 아직 실행할 수 없습니다.

## 목표

이 project는 다음 질문에 답할 수 있는 탐색 화면을 만드는 것을 목표로 합니다.

- Cloudflare에는 어떤 공식 product family와 product가 있는가?
- 각 product는 어떤 solution과 use case에 연결되는가?
- 수집된 정보의 공식 출처는 어디인가?

MVP는 product family 탐색, 검색과 filter, 상세 정보, 출처가 포함된 관계 보기를 제공합니다.
로그인, browser 편집, backend API, database, scheduled crawling은 포함하지 않습니다.

## 동작 방식

```text
Cloudflare official sources
           |
           v
      pnpm crawl
  fetch -> normalize -> validate
           |
           v
   web/public/data/*.json
           |
           v
       pnpm dev
   Angular visualization
```

Crawler 실행 한 번으로 수집, 구조화, schema validation, web data 갱신을 완료합니다. 각 record는
공식 source URL과 수집 시각을 포함합니다. 수집이나 validation이 실패하면 기존 정상 data
file을 변경하지 않습니다.

## 프로젝트 구조

```text
.
├── web/                         # Angular 정적 visualization web
│   └── public/data/             # Crawler가 생성하는 JSON data
├── crawler/                     # 수집을 시작하는 Node.js TypeScript script
│   └── config/                  # 수집 대상과 허용 source 설정
└── packages/                    # 공통 library, schema, TypeScript type
    └── catalog/                 # Crawler와 web이 공유하는 data contract
```

### `web`

Cloudflare 제품군과 관계를 시각화하는 Angular application입니다. `public/data`의 검증된 JSON만
읽으며 crawler 내부 code에는 의존하지 않습니다.

### `crawler`

공식 source를 수집하고 구조화하는 실행 script입니다. 생성 결과를 schema로 검증한 뒤
`web/public/data`를 갱신합니다.

### `packages`

Crawler와 web이 함께 사용하는 code를 둡니다. 첫 package인 `catalog`은 runtime schema,
TypeScript type, validator를 제공하며 data 구조의 single source of truth입니다.

세부 dependency 규칙과 품질 기준은 [`AGENTS.md`](./AGENTS.md)를 참조하세요.

## 기술 구성

- Angular CLI와 standalone Angular component
- strict TypeScript
- Node.js LTS
- `pnpm` workspace
- Cloudflare Pages static hosting

초기 범위에는 Nx, SSR, NgRx를 사용하지 않습니다.

## 설정과 실행

Workspace 구현 후 사용할 planned command입니다.

```bash
corepack enable
pnpm install

# 공식 source를 수집해 web/public/data를 갱신
pnpm crawl

# 갱신된 data를 시각화
pnpm dev

# 품질 검증과 production build
pnpm lint
pnpm test
pnpm build
```

일반적인 사용 순서는 `pnpm crawl` 후 `pnpm dev`입니다. 이미 생성된 JSON이 있다면 crawler를
다시 실행하지 않고 `pnpm dev`만 실행할 수 있습니다.

## 공식 Source

- `cloudflare.com`의 공식 product 및 solution page
- `developers.cloudflare.com`의 공식 documentation

정보가 충돌하면 현재 `cloudflare.com` product taxonomy를 우선하고 Developer Docs를 세부
설명과 관계의 보조 source로 사용합니다.

## 배포

Target hosting은 Cloudflare Pages입니다. `pnpm build`가 만든 Angular static output과
`web/public/data`의 JSON을 함께 배포합니다. Server-side runtime은 필요하지 않습니다.

## License

[MIT](./LICENSE)
