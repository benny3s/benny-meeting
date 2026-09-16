# 베니브릿지 (Benny Bridge)

지인 기반 소개팅 웹앱. "관리자(베니) 주변 사람들 중심으로 믿을 수 있는 소개팅"을 이어주는 작은 서비스.

- **레포**: `benny3s/benny-meeting` (이 폴더 `matchmaking/`가 git 루트)
- **라이브**: https://benny3s.github.io/benny-meeting/ (GitHub Pages, `master` push 시 자동 배포)

## 아키텍처 (한눈에)
- **클라이언트**: 단일 파일 **`index.html`** (~630KB, 바닐라 JS). 실제 로직은 `<script id="app-logic">` 인라인 블록 하나에 다 들어있음. (별도 `<script id="state-json" type="application/json">`은 시드용 JSON — JS 아님)
- **상태 저장**: Firestore 단일 문서 **`app/state`**. 주요 필드: `entries`(승인 회원), `pendingEntries`(승인 대기·보류), `dateRequests`(사진/대화 요청), `dm`(회원↔회원 채팅), `messages`(회원↔관리자 Q&A), `logs`(활동기록, LIMIT 1500), `joinRequests`(주선자 요청), `connLog`/`connEver`(누적 연결), `coupleReports`(커플 성사), `smsLog`, `deletedLog`, `adminAuth`, `adminSecOrder`, `announce`/`checkin`/`popup`.
- **인증**: Firebase **익명 로그인**(`signInAnonymously`). Firestore 규칙: `app/state`·`photos/{id}`·`pushTokens/{id}`는 `auth != null`일 때만 read/write, 그 외 전부 차단. → **익명 인증이 안 잡히면 쓰기 실패("Missing or insufficient permissions")**. 제출 전 인증 가드 있음.
- **관리자**: `adminAuth`에 RSA 키쌍(공개키 + PIN으로 감싼 개인키). 관리자 PIN 입력 시 개인키 unlock(`adminPrivateKey`). 민감정보(`realNameEnc`·`contactEnc`·`referrerEnc`)는 **관리자 공개키로 암호화(RSA-OAEP)**, 관리자만 client에서 복호화(`decryptWithAdmin`).
- **사진**: `photos/{entryId}` 컬렉션. **푸시 토큰**: `pushTokens/{entryId}`(+ `'admin'`).
- **Cloud Functions** (`functions/index.js`, region `asia-northeast3`, Node 22):
  - `onStateChange` — app/state 변경 감지 → 요청/승인/거절/DM/새신청 FCM 푸시
  - `remindPending` — 매시간 스케줄, pending 요청 1일/3일차 리마인더 푸시
  - `savePhone`/`setAcqFilter`/`clearAcqFilter`/`getHiddenIds` — 보안 번호 저장소(`sendContacts/{id}`, 서버키 AES) + 지인필터
  - `adminSendSms` — Solapi 문자(배포돼 있으나 **현재 수동 문자는 "내 폰 문자앱(sms: 링크)"** 사용, `openSmsNative`. Solapi는 070·자동/대량용으로 보류)

## 배포 워크플로 (모든 코드 변경 시 반드시)
1. `index.html` 편집 후 **`var APP_VERSION = 'YYYY-MM-DD-NNN';`** (파일 상단, ~907줄) **버전 올리기**. 새 버전 뜨면 열려있는 다른 탭에 새로고침 안내가 뜸.
2. **문법 검사** (인라인 app-logic 스크립트만 검사, state-json은 제외):
   ```bash
   cd /c/Users/1/Downloads/Claude-Benny/matchmaking && node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("index.html","utf8");const re=/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;while((m=re.exec(h))){i++;try{new vm.Script(m[1]);}catch(e){bad++;console.log("BLOCK "+i+" ERR: "+e.message);}}console.log("scanned "+i+" block(s), "+bad+" error(s)");'
   ```
   (functions 변경 시 `node --check functions/index.js`)
3. **커밋 + 푸시** (`master`). 커밋 메시지는 한국어로 무엇을 왜 바꿨는지 + 끝에 버전.
4. **라이브 확인** — Pages 반영에 1~2분. 새 버전 뜰 때까지 폴링:
   ```bash
   for i in 1 2 3 4 5 6; do v=$(curl -s "https://benny3s.github.io/benny-meeting/index.html?cb=$RANDOM" | grep -o "APP_VERSION = '[0-9-]*'" | head -1); echo "try $i: $v"; case "$v" in *NNN*) echo LIVE; break;; esac; sleep 15; done
   ```
- **커밋 attribution**: 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (세션 지침이 다르면 그걸 우선).

## 라이브 데이터 확인/수정 (Firestore)
- 인앱 브라우저로: **먼저 `navigate` 로 라이브 사이트 로드**(턴 사이에 탭이 비므로), 그다음 `javascript_tool`에서 `firebase.firestore().doc('app/state')` 로 읽기/쓰기.
- **읽기는 자유롭게. 쓰기는 프로덕션 데이터**라 신중히(가능하면 임시 필드→삭제, 실회원 건드리지 않기).
- firebase 시크릿/배포 명령은 Claude Code 자동모드에서 "Credential Materialization"으로 막힐 수 있음 → 사용자에게 안내.

## 주요 관례 · 함정
- **관리자 섹션**: `DEFAULT_SEC_ORDER` 배열 + `SEC_NAMES` 맵 + `secHtml` 객체 + `adminFold()` + `<details data-sec="...">` + `secOpenAttr`. 새 키를 배열·맵·객체에 추가하면 순서에 자동 편입됨(`adminSecOrder` 병합).
- **클라이언트 검색**: 행에 `data-*search` 속성 + `apply*Search()`가 `style.display`로 숨김/표시(리페인트 없이 → 포커스·한글 IME 유지). `paint()`에서 재적용.
- `modalNotice`는 메시지를 escape함(HTML 태그 넣지 말 것). `modalMessage`(입력)·`modalConfirm`(예/아니오) 패턴.
- **Firestore 문서 ID**: `__이름__`(양쪽 밑줄) 예약어 → `invalid-argument`. 쓰지 말 것.
- **PowerShell**: `firebase.ps1` 실행정책 차단됨 → `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` 후 실행하거나 `& "$env:APPDATA\npm\firebase.cmd" ...`.
- **테스트 계정**: `entry.testAccount = true` → 일반 명단/집계에서 숨김. 관리자 패널 스위치로만 노출. **닉네임이 `QA_`로 시작하면 가입 시 자동으로 testAccount 처리**(v347, handleFormSubmit·handleMatchmakerSubmit). QA는 `QA_` 접두어로 계정 생성 → 자동 숨김.
- **삭제 정책**: 일반 회원·주선자(프로필 포함) 모두 **"삭제 요청 → 관리자 승인"**. 주선자 껍데기(프로필·친구 없음)만 즉시 삭제. `handleApproveDelete`가 승인 시 오펀 주선자 껍데기까지 정리.
- **주선자(대리) 모델**: `managedBy`(주선자 id) + `ownerSelf`(주선자 본인 프로필) + `isMatchmaker`(매니저 계정). `viaMm`/`decidedViaMm` 플래그.

## 배경 지식 (제약)
- 카카오 **비즈니스 채널/알림톡**은 **"만남주선" 업종으로 반려**됨. 개인별 자동 알림은 카카오 불가 → **FCM 푸시(자동·무료) + SMS(수동)** 로.
- **유료 매칭**은 `결혼중개업법` 신고/등록 대상 소지 → 유료화 전 확인 필요(법무 자문 별도).

## 메모리
프로젝트 비자명한 사실·결정·상태는 Claude 메모리(이 프로젝트 경로에 스코프됨)에 축적됨. 세션 시작 시 자동 로드되니, 코드/깃 히스토리와 함께 참고할 것.
