# 데이터베이스 스키마

## 테이블 관계도

```mermaid
erDiagram
    users ||--o{ sessions : "소유"
    users ||--o{ problem_solving_sessions : "소유"
    users ||--o{ ai_usage_logs : "소유"
    users ||--o{ profiles : "프로필"
    sessions ||--o{ generated_problems : "포함"
    sessions ||--o{ ai_usage_logs : "연관"
    generated_problems ||--o{ problem_solving_sessions : "풀이"
    generated_problems ||--o{ assignment_problems : "과제포함"

    users ||--o{ classes : "생성"
    users ||--o{ class_members : "소속"
    users ||--o{ parent_children : "부모/자녀"
    users ||--o{ shared_assignments : "출제"
    users ||--o{ assignment_targets : "대상"
    users ||--o{ assignment_responses : "응답"

    classes ||--o{ class_members : "멤버"
    classes ||--o{ shared_assignments : "과제"
    shared_assignments ||--o{ assignment_problems : "문제"
    shared_assignments ||--o{ assignment_targets : "대상"
    shared_assignments ||--o{ assignment_responses : "응답"

    profiles {
        uuid user_id PK_FK
        text email
        text grade
        text role "student|teacher|parent|director"
        timestamptz created_at
    }

    sessions {
        uuid id PK
        uuid user_id FK
        text image_url
        jsonb image_urls "다중 이미지 URL 배열"
        text analysis_model "분석에 사용된 AI 모델"
        timestamptz created_at
    }

    generated_problems {
        uuid id PK
        uuid session_id FK
        text question
        jsonb options
        text correct_answer
        text user_answer
        text explanation
        timestamptz created_at
    }

    problem_solving_sessions {
        uuid id PK
        uuid user_id FK
        uuid problem_id FK
        timestamptz started_at
        timestamptz completed_at
        integer time_spent_seconds
        boolean is_correct
        timestamptz created_at
    }

    ai_usage_logs {
        uuid id PK
        uuid user_id FK
        text function_name
        text model_used
        integer prompt_token_count
        integer candidates_token_count
        integer total_token_count
        uuid session_id FK
        jsonb metadata
        timestamptz created_at
    }

    classes {
        uuid id PK
        text name
        text description
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    class_members {
        uuid id PK
        uuid class_id FK
        uuid user_id FK
        text role "teacher|student"
        timestamptz joined_at
    }

    parent_children {
        uuid id PK
        uuid parent_id FK
        uuid child_id FK
        timestamptz created_at
    }

    shared_assignments {
        uuid id PK
        text title
        text description
        uuid created_by FK
        uuid class_id FK
        timestamptz due_date
        timestamptz created_at
    }

    assignment_problems {
        uuid id PK
        uuid assignment_id FK
        uuid problem_id FK
        integer order_index
    }

    assignment_targets {
        uuid id PK
        uuid assignment_id FK
        uuid student_id FK
    }

    assignment_responses {
        uuid id PK
        uuid assignment_id FK
        uuid problem_id FK
        uuid student_id FK
        text answer
        boolean is_correct
        integer time_spent_seconds
        timestamptz submitted_at
    }
```

## 주요 테이블

### 기본 테이블

#### `profiles`
사용자 프로필. 역할·학년 정보 저장.
- `role`: CHECK (`student | teacher | parent | director`), 기본값 `student`

#### `sessions`
분석 세션. 사용자가 이미지를 업로드하면 세션이 생성된다.
- `image_urls`: 다중 이미지 지원을 위해 jsonb 배열로 저장
- `analysis_model`: 분석에 사용된 AI 모델명 기록

#### `generated_problems`
AI가 추출/생성한 문제. 각 세션에 종속된다.

#### `problem_solving_sessions`
사용자의 문제 풀이 기록. 풀이 시간과 정답 여부를 추적한다.
- `UNIQUE(user_id, problem_id)`: 사용자당 문제별 하나의 풀이 기록만 존재
- 통계 집계 시 `completed_at IS NOT NULL` 조건 필수

#### `ai_usage_logs`
AI 호출별 토큰 사용량 로그. 비용 추적 목적.
- `function_name`: `analyze-image`, `generate-example`, `generate-similar-problems`, `generate-report`, `reclassify-problems`

### 역할 기반 테이블

#### `classes`
학급/반 관리.
- `created_by`: 학급 생성자 (선생님 또는 학원장)

#### `class_members`
학급 멤버십. 한 학급에 여러 선생님과 학생 소속 가능.
- `role`: `teacher` 또는 `student`
- `UNIQUE(class_id, user_id)`: 한 사용자는 한 학급에 한 번만 소속

#### `parent_children`
학부모-자녀 관계.
- `UNIQUE(parent_id, child_id)`: 중복 연결 방지

#### `shared_assignments`
선생님이 출제한 과제.
- `class_id`: 과제가 속한 학급 (NULL 가능)
- `created_by`: 과제 출제자

#### `assignment_problems`
과제에 포함된 문제 목록.
- `order_index`: 문제 순서
- `UNIQUE(assignment_id, problem_id)`: 과제당 문제 중복 방지

#### `assignment_targets`
과제 대상 학생.
- `UNIQUE(assignment_id, student_id)`: 과제당 학생 중복 방지

#### `assignment_responses`
학생의 과제 응답.
- `UNIQUE(assignment_id, problem_id, student_id)`: 과제·문제·학생당 하나의 응답

## 헬퍼 함수

| 함수 | 설명 |
|------|------|
| `get_user_role(uid)` | profiles에서 역할 조회 (기본값: `student`) |
| `is_class_admin(uid, cid)` | 해당 학급의 teacher 멤버이거나 생성자인지 확인 |
| `is_parent_of(parent_uid, child_uid)` | parent_children 테이블에서 부모-자녀 관계 확인 |
| `can_view_assignment(uid, aid)` | 과제 출제자, 대상 학생, 학원장, 부모(자녀가 대상인 경우) 확인 |

## RLS 정책

모든 테이블에 Row Level Security가 활성화되어 있다.

### `problem_solving_sessions`
- **본인**: `user_id = auth.uid()` → SELECT/INSERT/UPDATE/DELETE
- **학부모**: `is_parent_of(auth.uid(), user_id)` → SELECT
- **선생님**: 소속 학급의 학생 → SELECT
- **학원장**: `get_user_role(auth.uid()) = 'director'` → SELECT

### `assignment_responses`
- **본인**: `student_id = auth.uid()` → SELECT/INSERT/UPDATE
- **과제 관련자**: `can_view_assignment(auth.uid(), assignment_id)` → SELECT

### `classes`
- **생성자/멤버**: SELECT, 생성자만 UPDATE/DELETE
- **학원장**: 전체 SELECT
- **선생님/학원장**: INSERT 가능

### 기타 테이블
- 일반 사용자: 자신의 데이터만 접근
- 서비스 역할 (`ai_usage_logs`): Edge Function에서 INSERT 가능

## 마이그레이션 이력

| 파일 | 내용 |
|------|------|
| `20250101000000_create_problem_solving_sessions.sql` | problem_solving_sessions 테이블 + RLS |
| `20251217000000_add_sessions_analysis_model.sql` | sessions에 analysis_model 컬럼 추가 |
| `20251217000001_add_sessions_image_urls.sql` | sessions에 image_urls 컬럼 추가 + 기존 데이터 백필 |
| `20260127000000_add_token_usage_columns.sql` | ai_usage_logs 테이블 생성 |
| `20260328000000_add_roles_classes_assignments.sql` | 역할 기반 학급·과제 시스템 전체 |
| `20260328000001_fix_profiles_role_check.sql` | profiles role CHECK에 director 추가 |
| `20260328000002_add_solving_sessions_role_rls.sql` | problem_solving_sessions에 부모/선생/학원장 RLS 추가 |

마이그레이션 원본: `supabase/migrations/`
