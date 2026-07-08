import type { Language, Translations } from './translations';

/**
 * 서비스 레이어(src/services 디렉터리)는 React 컨텍스트를 import할 수 없어 한국어 메시지를 throw한다.
 * 이 메시지가 en 모드 UI에 그대로 노출되는 것을 막기 위해, catch 지점에서 본 함수를 통해
 * 표시 문자열을 결정한다.
 *
 * 매핑 우선순위:
 *  1) 한글 원문이 매핑 테이블에 있으면 → 현재 언어의 번역값 반환
 *  2) 매핑에 없고 language === 'en' 이며 메시지에 한글이 포함되면 → fallback 반환(한글 노출 차단)
 *  3) 그 외(ko 모드 또는 한글 미포함 메시지) → 원문 메시지 반환(정보 보존)
 */

// 한글([가-힣]) 포함 여부 판정
function containsKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

/**
 * 서비스 레이어 throw 한글 원문 → translations.errors.* 키 매핑.
 * src/services 디렉터리 전수 수집 결과(11개 throw, 6개 고유 메시지)를 모두 커버한다.
 * 값 함수는 현재 언어의 Translations를 받아 번역 문자열을 반환한다.
 */
const ERROR_MESSAGE_MAP: Record<string, (t: Translations) => string> = {
  '이 세션에 접근할 권한이 없습니다.': (t) => t.errors.sessionAccessDenied,
  '이 문제에 대한 접근 권한이 없습니다.': (t) => t.errors.problemAccessDenied,
  '해당 이메일의 사용자를 찾을 수 없습니다.': (t) => t.errors.userNotFoundByEmail,
  '해당 이메일의 학생을 찾을 수 없습니다.': (t) => t.errors.studentNotFoundByEmail,
  '학생 계정만 자녀로 등록할 수 있습니다.': (t) => t.errors.onlyStudentCanBeChild,
  '로그인이 필요합니다.': (t) => t.errors.loginRequired,
  '이미 연결된 자녀입니다.': (t) => t.errors.childAlreadyLinked,
};

/**
 * 에러 객체에서 사용자에게 표시할 안전한 메시지를 산출한다.
 *
 * @param e        catch로 잡힌 알 수 없는 값(Error | PostgrestError | string 등)
 * @param language 현재 UI 언어
 * @param t        현재 언어의 Translations 사전
 * @param fallback 번역 불가/한글 누출 차단 시 사용할 기존 fallback 문자열
 * @returns        표시할 메시지 문자열
 */
export function translateError(
  e: unknown,
  language: Language,
  t: Translations,
  fallback: string
): string {
  // Error 인스턴스가 아니어도 message 프로퍼티가 있으면 추출(PostgrestError 등)
  let message: string;
  if (e instanceof Error) {
    message = e.message;
  } else if (e && typeof e === 'object' && 'message' in e) {
    message = String((e as { message: unknown }).message);
  } else {
    message = '';
  }

  // 1) 매핑된 한글 원문 → 현재 언어 번역값
  const mapped = ERROR_MESSAGE_MAP[message];
  if (mapped) {
    return mapped(t);
  }

  // 2) en 모드에서 매핑 안 된 한글 메시지는 fallback으로 대체(한글 노출 차단)
  if (language === 'en' && containsKorean(message)) {
    return fallback;
  }

  // 3) 그 외: 원문 메시지가 있으면 보존(ko 모드 정보 유지), 없으면 fallback
  return message || fallback;
}
