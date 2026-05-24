/**
 * Pub/Sub Publisher 헬퍼
 *
 * analyze-image (publisher) → analyze-worker (subscriber) 메시지 전달.
 * - topic: analyze-jobs
 * - 메시지 페이로드: { sessionId, userId, imagePaths, userLanguage }
 * - publishMessage 자체는 매우 가벼움 (수십 ms) — 200 응답 직전에 호출
 */
import { PubSub } from '@google-cloud/pubsub';

const TOPIC_NAME = process.env.ANALYZE_JOBS_TOPIC || 'analyze-jobs';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gen-lang-client-0516945872';

let _pubsubClient = null;
function getClient() {
  if (!_pubsubClient) {
    _pubsubClient = new PubSub({ projectId: PROJECT_ID });
  }
  return _pubsubClient;
}

/**
 * analyze-jobs topic에 분석 작업을 publish한다.
 * @returns {Promise<string>} messageId
 */
export async function publishAnalyzeJob(payload) {
  const { sessionId, userId, imagePaths, userLanguage } = payload;
  if (!sessionId || !userId || !Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('publishAnalyzeJob: sessionId, userId, imagePaths[] 필수');
  }
  const data = Buffer.from(JSON.stringify({
    sessionId,
    userId,
    imagePaths,
    userLanguage: userLanguage || 'ko',
    publishedAt: Date.now(),
  }), 'utf-8');

  const messageId = await getClient()
    .topic(TOPIC_NAME)
    .publishMessage({
      data,
      attributes: {
        sessionId: String(sessionId),
        userId: String(userId),
      },
    });

  console.log(`[pubsub] published analyze-job: sessionId=${sessionId}, messageId=${messageId}, images=${imagePaths.length}`);
  return messageId;
}

/**
 * CloudEvent.data.message에서 payload를 디코드한다.
 */
export function decodeAnalyzeJob(cloudEventDataMessage) {
  const dataBase64 = cloudEventDataMessage?.data || '';
  if (!dataBase64) {
    throw new Error('decodeAnalyzeJob: cloudEvent.data.message.data 없음');
  }
  const json = Buffer.from(dataBase64, 'base64').toString('utf-8');
  const parsed = JSON.parse(json);
  if (!parsed.sessionId || !parsed.userId || !Array.isArray(parsed.imagePaths)) {
    throw new Error('decodeAnalyzeJob: 필수 필드 누락');
  }
  return parsed;
}
