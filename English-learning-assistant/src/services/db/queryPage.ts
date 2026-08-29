/**
 * PostgREST 조회의 두 가지 조용한 실패를 막는 공용 헬퍼.
 *
 * (1) `.in()` 목록은 **URL 쿼리스트링**에 실린다. UUID 하나가 36자라 수백~수천 개를 한 번에
 *     넣으면 요청 URL이 서버 상한을 넘겨 414(URI Too Long)로 죽는다. 에러가 아니라 화면이
 *     통째로 안 뜨는 형태로 나타난다.
 *     → `problems.ts`가 이미 쓰던 ID_CHUNK=500 관례를 그대로 옮겨 담았다.
 *
 * (2) PostgREST는 `max_rows`(이 저장소 supabase/config.toml 기준 1000)에서 결과를 **에러 없이**
 *     잘라 돌려준다. 통계처럼 "전량"이 전제인 조회가 오래 쓴 계정일수록 조용히 축소된다.
 *     → `.range()` 페이지네이션으로 전량을 받는다.
 *
 * 불변식 — PAGE_SIZE ≤ 서버 max_rows:
 *   마지막 페이지 판정은 "요청한 만큼 못 받았다"로 한다. 그래서 서버 max_rows가 PAGE_SIZE보다
 *   **작으면** 가득 찬 첫 페이지도 PAGE_SIZE 미만으로 와서 루프가 거기서 끝난다 — 고치려던
 *   조용한 절단이 그대로 남고, 응답만 봐서는 "다 받았다"와 구별되지 않는다(구별하려면 조회마다
 *   빈 페이지 확인 요청이 한 번씩 더 든다. 호출 대부분이 소량 조회라 그 비용이 더 크다).
 *   그래서 PAGE_SIZE를 max_rows(supabase/config.toml:18 = 1000)보다 **낮게** 잡아 조건을 성립시킨다.
 *   max_rows를 PAGE_SIZE 아래로 내릴 일이 생기면 PAGE_SIZE도 함께 내릴 것.
 *
 * 불변식 — 페이지 사이 정렬 안정성:
 *   `.range()`는 페이지마다 **별개 요청**이라 그 사이에 쓰기가 끼면 행이 밀려 중복·누락이 난다.
 *   그래서 모든 호출부에 PK 기준 `.order('id')`(profiles만 `.order('user_id')`)를 붙였다.
 *   새 호출부에도 반드시 붙일 것 — 없으면 다중 페이지에서만, 그것도 조용히 틀린다.
 */

/** `.in()` 한 번에 실어 보낼 id 최대 개수 — problems.ts/stats.ts의 기존 ID_CHUNK와 같은 값 */
export const ID_CHUNK = 500;

/**
 * `.range()` 한 페이지 크기. max_rows(1000)와 **같게 잡으면 안 된다** — 위 불변식 참조.
 * 절반으로 두면 max_rows가 1000이든 500이든 "가득 찬 페이지 = 정확히 PAGE_SIZE"가 성립해
 * 마지막 페이지 판정이 옳다. 요청 수는 2배가 되지만 다중 페이지가 되는 조회 자체가 드물다.
 */
export const PAGE_SIZE = 500;

/**
 * 페이지네이션 무한 루프 가드. 500페이지 = 50만 행으로, 정상 데이터에서는 절대 닿지 않는다.
 * 여기 걸린다는 건 서버가 `.range()`를 무시하고 같은 페이지를 계속 주고 있다는 뜻이므로
 * 조용히 자르지 않고 던진다 — 조용한 절단이 바로 이 파일이 고치려는 문제다.
 */
const MAX_PAGES = 500;

/** supabase-js 응답 중 이 헬퍼가 실제로 보는 부분만 추린 모양 */
export interface RowsResult<T> {
  data: T[] | null;
  error: unknown;
}

/** id 배열을 size 개씩 끊는다. 원본 순서를 유지한다. */
export function chunkIds<T>(ids: readonly T[], size: number = ID_CHUNK): T[][] {
  if (size < 1) throw new Error(`chunkIds: size는 1 이상이어야 한다 (받은 값 ${size})`);
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * id 목록을 청크로 나눠 조회하고 **요청 청크 순서대로** 이어 붙인다.
 *
 * 정렬·limit이 붙은 쿼리에 그대로 쓰면 안 된다 — 청크마다 따로 정렬/절단되므로
 * 합친 결과의 의미가 달라진다. 그런 쿼리는 합친 뒤 호출부에서 다시 정렬/절단할 것.
 */
export async function fetchByIdChunks<T>(
  ids: readonly string[],
  runChunk: (chunk: string[]) => PromiseLike<RowsResult<T>>,
  chunkSize: number = ID_CHUNK,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (const chunk of chunkIds(ids, chunkSize)) {
    const { data, error } = await runChunk(chunk);
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}

/**
 * `.range()`로 전량을 받는다. 한 페이지가 PAGE_SIZE 미만이면 마지막 페이지로 보고 끝낸다.
 *
 * @param runPage (from, to)를 받아 `.range(from, to)`를 건 쿼리를 실행하는 함수
 */
export async function fetchAllPages<T>(
  runPage: (from: number, to: number) => PromiseLike<RowsResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await runPage(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    // 받은 행이 페이지 크기 미만이면 더 없다. 0행이어도 여기서 끝난다(전진 없이 재요청 금지).
    if (batch.length < pageSize) return out;
    from += batch.length;
  }
  throw new Error(
    `fetchAllPages: ${MAX_PAGES}페이지(${MAX_PAGES * pageSize}행)를 넘겼다. ` +
    '서버가 range를 무시하고 있을 수 있다 — 조용히 자르지 않고 중단한다.',
  );
}

/** id 청킹과 `.range()` 페이지네이션을 함께 건다. 청크당 전량을 받아 청크 순서대로 잇는다. */
export async function fetchByIdChunksPaged<T>(
  ids: readonly string[],
  runPage: (chunk: string[], from: number, to: number) => PromiseLike<RowsResult<T>>,
  chunkSize: number = ID_CHUNK,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (const chunk of chunkIds(ids, chunkSize)) {
    const rows = await fetchAllPages<T>((from, to) => runPage(chunk, from, to), pageSize);
    out.push(...rows);
  }
  return out;
}

/**
 * 쓰기(삭제·수정)가 **0행**에 걸렸을 때 던진다.
 *
 * 왜 필요한가: PostgREST는 RLS로 대상 행이 전부 걸러져도 `error: null`을 준다. 그래서
 * `if (error) throw`만 있는 코드는 "아무 것도 안 바뀐 성공"을 성공으로 통과시키고,
 * 화면만 낙관적으로 갱신됐다가 새로고침하면 원래대로 돌아온다.
 * 호출부가 `.select('id')`로 반환 행을 받아 이 함수로 검사할 것.
 *
 * 0행은 "권한 없음"과 "이미 사라짐"을 구별하지 못한다(구별하려면 조회 1회가 더 든다).
 * 어느 쪽이든 화면을 낙관적으로 바꾸면 안 되므로 메시지에 두 가능성을 함께 적는다.
 */
export function assertAffected(rows: { length: number } | null | undefined, message: string): void {
  if (!rows || rows.length === 0) throw new Error(message);
}
