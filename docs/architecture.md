# 아키텍처 상세

## 시스템 전체 구조

```mermaid
graph TB
    subgraph "클라이언트"
        FE["React Frontend<br/>(Vite + TypeScript)"]
    end

    subgraph "Netlify"
        FE --> |배포| NET["Netlify CDN"]
    end

    subgraph "Supabase"
        AUTH["Auth<br/>(인증)"]
        DB["PostgreSQL<br/>(데이터베이스)"]
        STORAGE["Storage<br/>(이미지 저장)"]
        RT["Realtime<br/>(구독)"]
        subgraph "Edge Functions (Deno)"
            EF1["generate-similar-problems"]
            EF2["generate-example"]
            EF3["generate-report"]
            EF4["generate-problems-by-type"]
            EF5["reclassify-problems"]
            EF6["test-bbox"]
        end
    end

    subgraph "Google Cloud"
        CF["Cloud Function<br/>analyze-image<br/>(Node.js)"]
        VERTEX["Vertex AI<br/>(Gemini 모델)"]
    end

    FE --> AUTH
    FE --> DB
    FE --> STORAGE
    FE --> RT
    FE --> CF
    EF1 & EF2 & EF3 & EF4 & EF5 --> VERTEX
    CF --> VERTEX
```

## 데이터 흐름

```mermaid
sequenceDiagram
    participant U as 사용자
    participant FE as React App
    participant CF as Cloud Function
    participant EF as Edge Function
    participant DB as Supabase DB
    participant AI as Vertex AI

    U->>FE: 시험 이미지 업로드
    FE->>CF: analyze-image 호출
    CF->>AI: 이미지 OCR + 분석
    AI-->>CF: 분석 결과 (문제/답 추출)
    CF-->>FE: 분석 결과 반환
    FE->>DB: 세션 + 문제 데이터 저장

    U->>FE: 유사 문제 생성 요청
    FE->>EF: generate-similar-problems
    EF->>AI: 프롬프트 + 원본 문제
    AI-->>EF: 생성된 문제
    EF->>DB: Realtime으로 스트리밍 저장
    DB-->>FE: Realtime 구독으로 실시간 수신
```

## 레포 구조

```
English-learning-assistant/           ← 프로젝트 루트 (.git 위치)
├── English-learning-assistant/       ← React 프론트엔드 (빌드 대상)
│   └── src/
│       ├── pages/                    ← 라우트별 페이지 (8개)
│       ├── components/               ← 재사용 UI 컴포넌트 (30개+)
│       ├── services/db/              ← Supabase DB 접근 레이어
│       ├── hooks/                    ← 커스텀 훅
│       ├── contexts/                 ← ThemeContext, LanguageContext
│       ├── utils/                    ← 유틸리티 함수
│       └── types.ts                  ← 핵심 타입 정의
├── supabase/
│   ├── functions/                    ← Edge Functions (Deno 런타임)
│   │   ├── _shared/                  ← 공유 모듈
│   │   ├── generate-similar-problems/
│   │   ├── generate-example/
│   │   ├── generate-report/
│   │   ├── generate-problems-by-type/
│   │   └── reclassify-problems/
│   └── migrations/                   ← DB 마이그레이션 SQL
├── cloud-functions/
│   └── analyze-image/                ← Google Cloud Function (Node.js)
├── docs/                             ← 상세 기술 문서
└── .agents/workflows/                ← AI 에디터 워크플로
```

## AI 클라이언트 팩토리 패턴

```mermaid
graph LR
    EF["Edge Function"] --> FACTORY["aiClientFactory.ts"]
    FACTORY --> CHECK{"Vertex AI<br/>환경변수 존재?"}
    CHECK -->|"있음"| VERTEX["vertexClient.ts<br/>(Vertex AI)"]
    CHECK -->|"없음"| GEMINI["GoogleGenAI<br/>(API Key fallback)"]
    VERTEX --> MODELS["models.ts<br/>모델 시퀀스 + 재시도"]
    GEMINI --> MODELS
```

### 모델 우선순위

| 순위 | 모델 | 용도 |
|------|------|------|
| 1 | gemini-3-flash-preview | 필기 감지 정확도 우수 |
| 2 | gemini-3.1-flash-lite-preview | 경량 모델 |
| 3 | gemini-2.5-pro | 범용 고성능 |
| 4 | gemini-2.5-flash | 범용 빠른 처리 |

모델 시퀀스 상세: `supabase/functions/_shared/models.ts`
프롬프트 템플릿: `supabase/functions/_shared/prompts.ts`
