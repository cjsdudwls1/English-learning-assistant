/**
 * 모델 시퀀스를 순서대로 시도하고 첫 성공 결과를 반환
 * @param {{ models: string[], callFn: (model: string) => Promise<any> }} opts
 * @returns {Promise<any>} 성공한 모델의 결과, 모두 실패 시 null 반환
 */
export async function runWithModelFallback({ models, callFn }) {
  for (const model of models) {
    try {
      return await callFn(model);
    } catch (err) {
      console.warn(`[passes:runWithModelFallback] ${model} 실패:`, err?.message);
    }
  }
  return null;
}
