/* 베니브릿지 — FCM 백그라운드 알림 서비스워커 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCSueePQfiHaRxUSZxoropiFjiq9arAaTs",
  authDomain: "benny-meeting.firebaseapp.com",
  projectId: "benny-meeting",
  storageBucket: "benny-meeting.firebasestorage.app",
  messagingSenderId: "925758544707",
  appId: "1:925758544707:web:a0c55e596ae0b15e7fadf6"
});

var messaging = firebase.messaging();
var APP_URL = 'https://benny3s.github.io/benny-meeting/';
var NOTIF_ICON = 'https://benny3s.github.io/benny-meeting/notif-icon.png';   /* 큰 아이콘(브랜드 로고) */
var NOTIF_BADGE = 'https://benny3s.github.io/benny-meeting/notif-badge.png'; /* 상태바 모노크롬 배지 */

/* 앱이 꺼져 있거나 백그라운드일 때 (data 메시지) */
messaging.onBackgroundMessage(function (payload) {
  var n = (payload && payload.notification) || (payload && payload.data) || {};
  var title = n.title || '베니브릿지';
  var options = {
    body: n.body || '',
    icon: n.icon || NOTIF_ICON,
    badge: NOTIF_BADGE,
    data: { url: (payload && payload.data && payload.data.url) || APP_URL }
  };
  self.registration.showNotification(title, options);
});

/* 알림 클릭 시 앱 열기/포커스 */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || APP_URL;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
