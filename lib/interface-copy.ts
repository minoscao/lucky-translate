import type { LanguageCode } from './translation';

type Copy = { idle: string; hold: string; continuous: string; permission: string; type: string; ready: string };
export const INTERFACE_COPY: Record<LanguageCode, Copy> = {
  'zh-CN': { idle: '按住说话 · 双击保持', hold: '松开结束', continuous: '点击停止', permission: '请允许使用麦克风', type: '输入文字', ready: '准备好，开始对话。' },
  'zh-TW': { idle: '按住說話 · 雙擊保持', hold: '鬆開結束', continuous: '點擊停止', permission: '請允許使用麥克風', type: '輸入文字', ready: '準備好，開始對話。' },
  en: { idle: 'Hold to talk · Double-tap to lock', hold: 'Release to stop', continuous: 'Tap to stop', permission: 'Allow microphone access', type: 'Type', ready: 'Ready to listen.' },
  ja: { idle: '長押しで話す · 2回タップで継続', hold: '離して終了', continuous: 'タップして停止', permission: 'マイクの使用を許可', type: '文字入力', ready: '会話を始めましょう。' },
  ko: { idle: '누르고 말하기 · 두 번 탭해 유지', hold: '손을 떼면 종료', continuous: '탭하여 중지', permission: '마이크 사용을 허용하세요', type: '직접 입력', ready: '대화를 시작하세요.' },
  fr: { idle: 'Maintenir pour parler · 2 taps pour continuer', hold: 'Relâcher pour arrêter', continuous: 'Toucher pour arrêter', permission: 'Autorisez le microphone', type: 'Écrire', ready: 'Prêt à écouter.' },
  de: { idle: 'Zum Sprechen halten · Doppeltippen zum Fortsetzen', hold: 'Loslassen zum Stoppen', continuous: 'Tippen zum Stoppen', permission: 'Mikrofon erlauben', type: 'Eingeben', ready: 'Bereit zum Zuhören.' },
  es: { idle: 'Mantén para hablar · Doble toque para continuar', hold: 'Suelta para detener', continuous: 'Toca para detener', permission: 'Permite el micrófono', type: 'Escribir', ready: 'Listo para escuchar.' },
  it: { idle: 'Tieni premuto per parlare · Tocca due volte per continuare', hold: 'Rilascia per fermare', continuous: 'Tocca per fermare', permission: 'Consenti il microfono', type: 'Scrivi', ready: 'Pronto ad ascoltare.' },
  pt: { idle: 'Segure para falar · Toque duas vezes para continuar', hold: 'Solte para parar', continuous: 'Toque para parar', permission: 'Permita o microfone', type: 'Digitar', ready: 'Pronto para ouvir.' },
  ru: { idle: 'Удерживайте, чтобы говорить · Двойное нажатие — непрерывно', hold: 'Отпустите для остановки', continuous: 'Нажмите для остановки', permission: 'Разрешите микрофон', type: 'Ввести текст', ready: 'Готов слушать.' },
  ar: { idle: 'اضغط مطولاً للتحدث · انقر مرتين للاستمرار', hold: 'ارفع إصبعك للإيقاف', continuous: 'انقر للإيقاف', permission: 'اسمح باستخدام الميكروفون', type: 'اكتب', ready: 'جاهز للاستماع.' },
  th: { idle: 'กดค้างเพื่อพูด · แตะสองครั้งเพื่อพูดต่อ', hold: 'ปล่อยเพื่อหยุด', continuous: 'แตะเพื่อหยุด', permission: 'อนุญาตใช้ไมโครโฟน', type: 'พิมพ์ข้อความ', ready: 'พร้อมฟังแล้ว' },
  vi: { idle: 'Giữ để nói · Chạm hai lần để tiếp tục', hold: 'Thả để dừng', continuous: 'Chạm để dừng', permission: 'Cho phép dùng micrô', type: 'Nhập chữ', ready: 'Sẵn sàng lắng nghe.' },
  id: { idle: 'Tahan untuk bicara · Ketuk dua kali untuk lanjut', hold: 'Lepaskan untuk berhenti', continuous: 'Ketuk untuk berhenti', permission: 'Izinkan mikrofon', type: 'Ketik', ready: 'Siap mendengarkan.' },
  hi: { idle: 'बोलने के लिए दबाएँ · जारी रखने के लिए दो बार टैप करें', hold: 'रोकने के लिए छोड़ें', continuous: 'रोकने के लिए टैप करें', permission: 'माइक्रोफ़ोन की अनुमति दें', type: 'लिखें', ready: 'सुनने के लिए तैयार।' },
};
