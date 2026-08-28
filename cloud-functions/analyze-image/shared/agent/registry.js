/**
 * 에이전트 도구 레지스트리
 *
 * 도구는 세 겹으로 분리된다:
 *   - 선언(name/description/params) → 프롬프트로 모델에 노출
 *   - 검증(validateArgs)            → 모델 출력은 신뢰하지 않는다. 통과한 값만 핸들러로
 *   - 핸들러(handler)               → 실제 DB 조회. ctx.db는 **호출자 JWT** 클라이언트다
 *
 * 왜 JSON Schema 라이브러리를 안 쓰나: 도구 파라미터는 스칼라 몇 개뿐이고,
 * GCF 콜드스타트에 의존성을 추가할 이유가 없다. 표현력이 부족해지면 그때 바꾼다.
 */

const SUPPORTED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'string[]']);

/**
 * @param {object}   spec
 * @param {string}   spec.name         모델이 부르는 이름. 'stats.drilldown' 같은 점 표기
 * @param {string}   spec.description  모델이 읽는 유일한 설명 — 여기가 부실하면 엉뚱한 도구를 부른다
 * @param {object}   [spec.params]     { argName: { type, required, description, enum, min, max, default } }
 * @param {boolean}  [spec.readOnly]   기본 true. false면 런타임이 명시 허용을 요구한다
 * @param {number}   [spec.timeoutMs]  이 도구만의 실행 상한. 없으면 런타임 기본값(조회 기준)
 * @param {Function} spec.handler      async (args, ctx) => any. ctx = { db, userId, input, signal, log }
 */
export function defineTool({ name, description, params = {}, readOnly = true, timeoutMs, handler }) {
  if (!name || typeof name !== 'string') throw new Error('defineTool: name 필수');
  if (!description) throw new Error(`defineTool(${name}): description 필수 — 모델이 읽는 유일한 설명이다`);
  if (typeof handler !== 'function') throw new Error(`defineTool(${name}): handler 필수`);
  if (timeoutMs !== undefined && !(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new Error(`defineTool(${name}): timeoutMs는 양수여야 합니다`);
  }

  for (const [key, spec] of Object.entries(params)) {
    if (!SUPPORTED_TYPES.has(spec.type)) {
      throw new Error(`defineTool(${name}): 지원하지 않는 파라미터 타입 ${key}:${spec.type}`);
    }
  }

  return { name, description, params, readOnly, timeoutMs, handler };
}

/** 도구 배열 → 이름으로 찾는 Map. 이름 중복은 조용히 덮어쓰지 말고 터뜨린다. */
export function buildRegistry(tools) {
  const map = new Map();
  for (const tool of tools) {
    if (map.has(tool.name)) throw new Error(`도구 이름 중복: ${tool.name}`);
    map.set(tool.name, tool);
  }
  return map;
}

export function findTool(registry, name) {
  if (typeof name !== 'string') return null;
  return registry.get(name) ?? null;
}

/** 화이트리스트 밖 도구를 불렀을 때 모델에게 돌려줄 후보 목록 */
export function toolNames(registry) {
  return [...registry.keys()];
}

/**
 * 프롬프트에 넣을 도구 카탈로그.
 * JSON Schema를 그대로 덤프하지 않고 한 줄 시그니처로 압축한다 — 스텝마다 재전송되는
 * 텍스트라 토큰이 그대로 비용이다.
 */
export function toolCatalogForPrompt(registry) {
  const lines = [];
  for (const tool of registry.values()) {
    const sig = Object.entries(tool.params)
      .map(([key, spec]) => `${key}${spec.required ? '' : '?'}: ${spec.type}`)
      .join(', ');
    lines.push(`- ${tool.name}(${sig})`);
    lines.push(`    ${tool.description}`);
    for (const [key, spec] of Object.entries(tool.params)) {
      const notes = [];
      if (spec.description) notes.push(spec.description);
      if (spec.enum) notes.push(`허용값: ${spec.enum.join(' | ')}`);
      if (spec.default !== undefined) notes.push(`기본값 ${JSON.stringify(spec.default)}`);
      if (spec.min !== undefined || spec.max !== undefined) {
        notes.push(`범위 ${spec.min ?? '-'}~${spec.max ?? '-'}`);
      }
      if (notes.length) lines.push(`    · ${key}: ${notes.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * 모델이 준 args를 검증·강제변환한다.
 * 실패는 throw가 아니라 { ok:false, error }로 돌려준다 — 런타임이 이 문자열을
 * **관측**으로 되먹여 모델이 스스로 고치게 하기 위해서다(치명적 오류가 아니다).
 *
 * @returns {{ ok: true, args: object } | { ok: false, error: string }}
 */
export function validateArgs(tool, rawArgs) {
  const source = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  const out = {};

  const unknown = Object.keys(source).filter((k) => !(k in tool.params));
  if (unknown.length) {
    return { ok: false, error: `알 수 없는 파라미터: ${unknown.join(', ')}. 허용: ${Object.keys(tool.params).join(', ') || '(없음)'}` };
  }

  for (const [key, spec] of Object.entries(tool.params)) {
    let value = source[key];

    if (value === undefined || value === null || value === '') {
      if (spec.required) return { ok: false, error: `필수 파라미터 누락: ${key} (${spec.type})` };
      if (spec.default !== undefined) out[key] = spec.default;
      continue;
    }

    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') return { ok: false, error: `${key}는 문자열이어야 합니다` };
        value = value.trim();
        break;
      case 'number':
      case 'integer': {
        // 모델이 숫자를 문자열로 주는 일이 잦다. 되먹임 한 턴을 아끼려고 여기서 흡수한다.
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num)) return { ok: false, error: `${key}는 숫자여야 합니다` };
        value = spec.type === 'integer' ? Math.trunc(num) : num;
        if (spec.min !== undefined && value < spec.min) value = spec.min;
        if (spec.max !== undefined && value > spec.max) value = spec.max;
        break;
      }
      case 'boolean':
        value = value === true || value === 'true';
        break;
      case 'string[]':
        if (typeof value === 'string') value = [value];
        if (!Array.isArray(value)) return { ok: false, error: `${key}는 문자열 배열이어야 합니다` };
        value = value.map((v) => String(v).trim()).filter(Boolean);
        break;
      default:
        return { ok: false, error: `${key}: 내부 오류 — 알 수 없는 타입` };
    }

    if (spec.enum && !spec.enum.includes(value)) {
      return { ok: false, error: `${key}의 허용값은 ${spec.enum.join(' | ')} 입니다 (받은 값: ${JSON.stringify(value)})` };
    }

    out[key] = value;
  }

  return { ok: true, args: out };
}
