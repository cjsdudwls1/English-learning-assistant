// 에러 파싱 함수 (개선: JSON 문자열 파싱 및 중첩 에러 처리)
export function parseApiError(error: unknown): { message: string; code: number; status: string } {
  // Error 객체인 경우
  if (error instanceof Error) {
    const message = error.message;
    
    // JSON 문자열인 경우 파싱 시도
    if (message.includes('{') && message.includes('}')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.error) {
          const errorObj = parsed.error;
          return {
            message: errorObj.message || message,
            code: errorObj.code || errorObj.status || 500,
            status: String(errorObj.status || 'UNAVAILABLE')
          };
        }
      } catch {
        // JSON 파싱 실패 시 원본 메시지 사용
      }
    }
    
    // 타임아웃 에러 확인
    if (message.includes('timeout') || message.includes('Timeout') || message.includes('TIMEOUT')) {
      return {
        message: 'Request timeout: The AI service took too long to respond. Please try generating fewer problems at once.',
        code: 504,
        status: 'TIMEOUT'
      };
    }
    
    return {
      message,
      code: 500,
      status: 'ERROR'
    };
  }
  
  // 객체 형태의 에러 처리
  const err = error as any;
  
  // 중첩된 error 객체 처리
  let errorMessage = 'Unknown error';
  let errorCode = 500;
  let errorStatus = 'UNAVAILABLE';
  
  // 다양한 에러 구조 지원
  if (err?.error) {
    const errorObj = err.error;
    errorMessage = errorObj.message || errorObj.error?.message || errorMessage;
    errorCode = errorObj.code || errorObj.status || errorCode;
    errorStatus = errorObj.status || errorStatus;
  } else {
    errorMessage = err?.message || err?.error?.message || err?.error?.error?.message || err?.details?.[0]?.message || errorMessage;
    errorCode = err?.code || err?.status || err?.error?.code || err?.error?.status || errorCode;
    errorStatus = err?.status || err?.error?.status || errorStatus;
  }
  
  // 숫자가 아닌 경우 파싱 시도
  if (typeof errorCode !== 'number') {
    const parsedCode = parseInt(String(errorCode));
    if (!isNaN(parsedCode)) {
      errorCode = parsedCode;
    }
  }
  
  return {
    message: errorMessage,
    code: errorCode,
    status: String(errorStatus)
  };
}

