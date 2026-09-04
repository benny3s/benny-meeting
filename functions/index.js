/* 소개상점 — 요청 이벤트 발생 시 상대에게 FCM 웹 푸시 발송 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SITE_URL = 'https://benny3s.github.io/benny-meeting/';

function reqStatus(r) {
  if (r.approved) return 'approved';
  if (r.rejected) return 'rejected';
  if (r.held) return 'held';
  if (r.userApproved) return 'user_approved';
  return 'pending';
}
function nameOf(entries, id) {
  const e = (entries || []).find((x) => x.id === id);
  return e ? e.nickname : '상대방';
}
async function tokensFor(id) {
  if (!id) return [];
  try {
    const doc = await db.collection('pushTokens').doc(id).get();
    if (!doc.exists) return [];
    const t = doc.data().tokens;
    if (Array.isArray(t)) return t;
    if (t && typeof t === 'object') return Object.keys(t);
    return [];
  } catch (e) { return []; }
}
async function sendToTokens(tokens, title, body, cleanupIds) {
  if (!tokens.length) return;
  try {
    /* data-only: 서비스워커가 직접 알림을 만들어 중복 표시를 막음 */
    const res = await admin.messaging().sendEachForMulticast({
      tokens: tokens,
      data: { title: title, body: body, url: SITE_URL },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } }
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const c = r.error && r.error.code;
        if (c === 'messaging/registration-token-not-registered' ||
            c === 'messaging/invalid-argument' ||
            c === 'messaging/invalid-registration-token') bad.push(tokens[i]);
      }
    });
    if (bad.length && cleanupIds && cleanupIds.length) {
      for (const cid of cleanupIds) {
        try {
          await db.collection('pushTokens').doc(cid)
            .set({ tokens: admin.firestore.FieldValue.arrayRemove.apply(null, bad) }, { merge: true });
        } catch (e) {}
      }
    }
  } catch (e) { console.error('push send failed', e); }
}
async function sendTo(id, title, body) {
  const tokens = await tokensFor(id);
  await sendToTokens(tokens, title, body, [id]);
}
/* 관리자에게: pushTokens/admin 에 등록된 기기들 (관리자 페이지의 알림 토글로 기기별 관리) */
async function sendToAdmin(title, body) {
  const tokens = await tokensFor('admin');
  await sendToTokens(tokens, title, body, ['admin']);
}

exports.onStateChange = functions
  .region('asia-northeast3')
  .runWith({ maxInstances: 10, timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('app/state')
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const entries = after.entries || [];
    const beforeMap = {};
    (before.dateRequests || []).forEach((r) => { beforeMap[r.id] = r; });

    const jobs = [];
    (after.dateRequests || []).forEach((r) => {
      const prev = beforeMap[r.id];
      const type = (r.type || 'contact') === 'photo' ? '사진' : '번호';
      if (!prev) {
        /* 새 요청 → 받는 사람에게 */
        jobs.push(sendTo(r.toId, '새 ' + type + ' 요청', nameOf(entries, r.fromId) + '님이 ' + type + ' 요청을 보냈어요'));
      } else {
        /* 요청자가 자기 사진을 공개함 → 받는 사람에게 */
        if (!prev.fromRevealed && r.fromRevealed) {
          jobs.push(sendTo(r.toId, '📷 사진 공개', nameOf(entries, r.fromId) + '님이 자기 사진을 공개했어요'));
        }
        const ps = reqStatus(prev), ns = reqStatus(r);
        if (ps === ns) return;
        /* approved 와 user_approved(당사자 승인·관리자 확정 대기) 를 하나의 "승인" 이벤트로 취급해 중복 알림 방지 */
        const wasApproved = (ps === 'approved' || ps === 'user_approved');
        const isApproved = (ns === 'approved' || ns === 'user_approved');
        if (isApproved && !wasApproved) jobs.push(sendTo(r.fromId, type + ' 요청 승인 🎉', nameOf(entries, r.toId) + '님이 요청을 승인했어요'));
        else if (ns === 'held' && ps !== 'held') jobs.push(sendTo(r.fromId, type + ' 요청 보류', nameOf(entries, r.toId) + '님이 요청을 보류했어요'));
        else if (ns === 'rejected' && ps !== 'rejected') jobs.push(sendTo(r.fromId, type + ' 요청 거절', nameOf(entries, r.toId) + '님이 요청을 거절했어요'));
        else if (ns === 'pending' && (ps === 'held' || ps === 'rejected')) jobs.push(sendTo(r.toId, type + ' 재요청', nameOf(entries, r.fromId) + '님이 정보를 담아 다시 요청했어요'));
      }
    });

    /* 새 신청서(승인 대기) → 관리자에게 */
    const beforePend = {};
    (before.pendingEntries || []).forEach((p) => { beforePend[p.id] = true; });
    (after.pendingEntries || []).forEach((p) => {
      if (!beforePend[p.id]) jobs.push(sendToAdmin('새 신청서 📝', (p.nickname || '누군가') + '님이 신청서를 냈어요 (승인 대기)'));
    });

    /* 새 메시지 → 상대에게 (회원→관리자 / 관리자→회원) */
    const nickAny = (id) => {
      const e = (after.entries || []).find((x) => x.id === id) || (after.pendingEntries || []).find((x) => x.id === id);
      return e ? e.nickname : '회원';
    };
    const beforeMsg = {};
    (before.messages || []).forEach((m) => { beforeMsg[m.id] = true; });
    (after.messages || []).forEach((m) => {
      if (beforeMsg[m.id]) return;
      const preview = (m.text || '').slice(0, 40);
      if (m.from === 'user') jobs.push(sendToAdmin('💬 새 Q&A/메시지', nickAny(m.entryId) + ': ' + preview));
      else if (m.from === 'admin') jobs.push(sendTo(m.entryId, '💬 관리자 메시지', preview));
    });

    await Promise.all(jobs);
    return null;
  });
