---
description: Veo API (영상 생성) 관련 코딩 시 반드시 참조해야 하는 공식 문서 기반 규칙
---

# Veo API 코딩 규칙

> Veo 관련 코드를 작성하거나 수정할 때 반드시 이 워크플로우를 따른다.

## 반드시 공식 문서를 참조하라

Veo 관련 코딩 시 **항상** 아래 공식 문서를 기준으로 코딩한다:
- **공식 문서 URL**: https://ai.google.dev/gemini-api/docs/video?hl=ko&example=dialogue(확인 불가시 크롬브라우져 켜서 보라)
- 코딩 전 `read_url_content` 도구로 해당 URL을 읽어 최신 API 사양을 확인한다.
- 문서의 **자바스크립트** 탭 코드를 기준으로 한다 (프로젝트가 Next.js/TypeScript 기반).

---

## SDK 및 모델

| 항목 | 값 |
|---|---|
| SDK | `@google/genai` (`GoogleGenAI`) |
| 고품질 모델 | `veo-3.1-generate-preview` |
| 빠른 모델 | `veo-3.1-fast-generate-preview` |
| API 키 환경변수 | `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` |

---

## 텍스트 → 영상 생성 (공식 패턴)

```javascript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});
const prompt = `프롬프트 내용`;

let operation = await ai.models.generateVideos({
  model: "veo-3.1-generate-preview",
  prompt: prompt,
});

// 폴링
while (!operation.done) {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  operation = await ai.operations.getVideosOperation({ operation });
}

// 다운로드
ai.files.download({
  file: operation.response.generatedVideos[0].video,
  downloadPath: "output.mp4",
});
```

---

## 참조 이미지 사용 (referenceImages)

참조 이미지로 피사체(옷, 인물 등)의 외형을 보존하려면 `referenceImages`를 사용한다.

```javascript
const reference = {
  image: { imageBytes: base64Data, mimeType: "image/png" },
  referenceType: "asset",
};

let operation = await ai.models.generateVideos({
  model: "veo-3.1-generate-preview",
  prompt: prompt,
  config: {
    referenceImages: [reference],
  },
});
```

- `referenceType`: `"asset"` (피사체 외형 보존)
- 최대 3개의 참조 이미지 전달 가능
- 이미지는 `{ imageBytes, mimeType }` 형식

---

## 첫 프레임 이미지 사용 (image)

이미지를 영상의 첫 프레임으로 사용하려면 `image` 파라미터를 사용한다.

```javascript
let operation = await ai.models.generateVideos({
  model: "veo-3.1-generate-preview",
  prompt: prompt,
  image: { imageBytes: base64Data, mimeType: "image/png" },
});
```

---

## API 파라미터 (config)

| 파라미터 | 값 | 설명 |
|---|---|---|
| `aspectRatio` | `"16:9"`, `"9:16"` | 가로세로 비율 |
| `resolution` | `"720p"`, `"1080p"`, `"4k"` | 해상도 (Veo 3.1 Fast는 720p만) |
| `durationSeconds` | `"4"`, `"6"`, `"8"` | 영상 길이 |
| `personGeneration` | `"allow_all"`, `"allow_adult"` | 인물 생성 허용 |
| `negativePrompt` | 문자열 | 제외할 요소 |
| `seed` | 숫자 | 재현성 (완전 보장은 아님) |

```javascript
config: {
  aspectRatio: "16:9",
  resolution: "720p",
  durationSeconds: "8",
  personGeneration: "allow_all",
  negativePrompt: "cartoon, drawing, low quality",
}
```

---

## 비동기 작업 처리 (폴링)

- `generateVideos()`는 **즉시 operation 객체를 반환**한다.
- `operation.done`이 `true`가 될 때까지 **폴링**해야 한다.
- 폴링 간격: 최소 10초 권장
- `ai.operations.getVideosOperation({ operation })`으로 상태 조회

---

## 프롬프트 작성 가이드

프롬프트에 포함해야 할 요소:
1. **주제**: 사물, 사람, 동물, 풍경
2. **동작**: 피사체가 하는 행동 (걷기, 포즈 등)
3. **스타일**: 영화 스타일 키워드 (cinematic, fashion commercial 등)
4. **카메라**: 공중 촬영, 눈높이, 돌리 샷 등 (선택)
5. **구도**: 와이드 샷, 클로즈업 등 (선택)
6. **분위기**: 색상/조명 (선택)

### 오디오/대화 프롬프트 (Veo 3.1)
- **대화**: 따옴표 사용 → `The narrator says, 'Hello World'`
- **음향 효과**: 명시적 서술 → `Tires screeching loudly`
- **주변 소음**: 환경 서술 → `Soft ambient music plays`

---

## 제한사항

| 항목 | 내용 |
|---|---|
| 요청 지연 | 최소 11초 ~ 최대 6분 (피크 시) |
| 영상 보관 | 서버에 2일간 저장 후 삭제 → 즉시 다운로드 필수 |
| 워터마크 | SynthID 워터마크 자동 삽입 |
| 안전 필터 | 개인정보/저작권/편향 필터링 적용 |

---

## 체크리스트

Veo 관련 코드 작성 시 아래를 반드시 확인한다:

- [ ] 공식 문서 URL을 `read_url_content`로 읽어 최신 사양을 확인했는가?
- [ ] SDK는 `@google/genai`의 `GoogleGenAI`를 사용하는가?
- [ ] 모델명은 `veo-3.1-generate-preview` 또는 `veo-3.1-fast-generate-preview`인가?
- [ ] 비동기 폴링 로직이 `operation.done` 기반으로 구현되었는가?
- [ ] 참조 이미지 사용 시 `referenceImages` + `referenceType: "asset"` 패턴을 따르는가?
- [ ] 영상 다운로드는 즉시(2일 내) 수행하는가?
- [ ] `personGeneration: "allow_all"` 설정이 되어 있는가?