/**
 * The website: an information page in Kazakhstan's two languages (/ in Kazakh, /ru/ in Russian)
 * that explains Tapsyr and says the app is coming to Google Play and the App Store. Until then the
 * website has no app in it: website builds drop the web app, and /app/ redirects to the home page
 * (firebase.json).
 *
 * Only builds for the website do this (TAPSYR_SITE=1, set by the deploy and preview workflows).
 * The phone app is built from the same dist folder and must keep the app at index.html.
 *
 * Plain HTML and CSS, no framework. The site's content security policy allows scripts only from
 * the site itself, so the little behaviour there is (the remembered language) lives in /landing.js.
 */
import fs from 'fs';
import path from 'path';
import type { Plugin, ResolvedConfig } from 'vite';
import { LEGAL_OPERATOR, LEGAL_VERSION } from '../src/data/legalTexts';
import { APP_STORE_URL, INSTAGRAM_URL, MASTER_SIGNUP_URL, PLAY_STORE_URL, TIKTOK_URL } from '../src/config/site';
import { SIGNUP_CATEGORIES } from '../functions/src/masterSignupFields';

type Lang = 'kz' | 'ru';

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Key the app reads from localStorage (src/App.tsx) for the language; the website keeps using it
const APP_LANGUAGE_KEY = 'kerek_language_v1';

const CATEGORIES: { photo: string; kz: string; ru: string }[] = [
  { photo: 'g_plumbing', kz: 'Сантехник', ru: 'Сантехник' },
  { photo: 'g_electrician', kz: 'Электрик', ru: 'Электрик' },
  { photo: 'g_appliances', kz: 'Техника жөндеу', ru: 'Ремонт техники' },
  { photo: 'g_cleaning_moving', kz: 'Тазалау', ru: 'Уборка' },
  { photo: 'g_beauty', kz: 'Сұлулық', ru: 'Красота' },
  { photo: 'g_household', kz: 'Үй шебері', ru: 'Мастер на час' },
  { photo: 'g_tutoring', kz: 'Репетиторлар', ru: 'Репетиторы' },
  { photo: 'g_auto', kz: 'Автоқызметтер', ru: 'Автоуслуги' },
  { photo: 'g_construction', kz: 'Құрылыс', ru: 'Строительство' },
  { photo: 'g_moving', kz: 'Жүк тасымалы', ru: 'Грузоперевозки' },
  { photo: 'g_care', kz: 'Бала және қарт күтімі', ru: 'Няни и сиделки' },
  { photo: 'g_events', kz: 'Той және мерекелер', ru: 'Праздники' },
];

interface Copy {
  htmlLang: string;
  title: string;
  description: string;
  otherLangLabel: string;
  h1: string;
  lead: string;
  soon: string;
  notify: string;
  notifyText: string;
  playSoon: string;
  playGet: string;
  appStoreSoon: string;
  appStoreGet: string;
  exampleLabel: string;
  request: string;
  chips: string[];
  offersTitle: string;
  offers: { name: string; who: string; price: string; rating: string }[];
  howTitle: string;
  steps: { title: string; text: string }[];
  catsTitle: string;
  catsText: string;
  whyTitle: string;
  why: { title: string; text: string }[];
  mastersTitle: string;
  mastersText: string;
  mastersPoints: string[];
  mastersCta: string;
  mastersCtaText: string;
  heroMasters: string;
  form: {
    name: string;
    phone: string;
    category: string;
    choose: string;
    district: string;
    optional: string;
    email: string;
    emailHint: string;
    consent: string;
    sending: string;
    done: string;
    orWhatsapp: string;
    errors: { name: string; phone: string; category: string; email: string; consent: string; limit: string; server: string };
  };
  faqTitle: string;
  faq: { q: string; a: string }[];
  contactsTitle: string;
  docsLabel: string;
  legal: { privacy: string; terms: string; deletion: string };
}

const COPY: Record<Lang, Copy> = {
  kz: {
    htmlLang: 'kk',
    title: 'Tapsyr — Қызылордадағы шеберлер',
    description:
      'Не істеу керегін өз сөзіңізбен жазыңыз, Қызылорданың шеберлері ұсыныс жібереді. Сантехник, электрик, тазалау, жөндеу және басқа қызметтер.',
    otherLangLabel: 'Русский',
    h1: 'Не істеу керегін жазыңыз. Шеберлер өздері ұсыныс жібереді.',
    lead:
      'Tapsyr Қызылордадағы шеберлерді табуға көмектеседі: сантехник, электрик, тазалау, техника жөндеу, сұлулық және басқа қызметтер. Қосымша тегін.',
    soon: 'Tapsyr қосымшасы жақында Google Play мен App Store-да шығады. Шыққан күні хабарлауымызды қаласаңыз, WhatsApp-қа жазыңыз.',
    notify: 'Шыққанда хабарлау',
    notifyText: 'Сәлеметсіз бе! Tapsyr қосымшасы шыққанда хабарлаңызшы.',
    playSoon: 'Google Play-де жақында',
    playGet: 'Google Play-ден жүктеу',
    appStoreSoon: 'App Store-да жақында',
    appStoreGet: 'App Store-дан жүктеу',
    exampleLabel: 'Өтінім мысалы',
    request: 'Ас үйдегі кран ағып тұр. Ертең таңертең келіп жөндей аласыз ба?',
    chips: ['Сантехник', 'Ертең таңертең', 'Қызылорда'],
    offersTitle: '3 шебер ұсыныс жіберді',
    offers: [
      { name: 'Ерлан', who: 'Сантехник, 7 жыл', price: '5 000 ₸', rating: '4,9' },
      { name: 'Нұрлан', who: 'Сантехник, 4 жыл', price: '4 500 ₸', rating: '4,8' },
      { name: 'Асхат', who: 'Үй шебері, 10 жыл', price: '6 000 ₸', rating: '5,0' },
    ],
    howTitle: 'Қалай жұмыс істейді',
    steps: [
      { title: 'Жазыңыз', text: 'Мәселені өз сөзіңізбен жазыңыз немесе дауыспен айтыңыз. Фото қосуға болады.' },
      { title: 'Ұсыныстарды салыстырыңыз', text: 'Шеберлер өз бағасын жібереді. Олардың пікірлері мен рейтингін көресіз.' },
      { title: 'Шеберді таңдаңыз', text: 'Нөміріңізді тек таңдаған шеберіңіз көреді. Жұмыс ақысын оған тікелей төлейсіз.' },
    ],
    catsTitle: 'Қандай шебер керек?',
    catsText: 'Ең жиі сұралатын қызметтер. Керегі тізімде жоқ болса да, жай ғана жазыңыз: Tapsyr өзі түсінеді.',
    whyTitle: 'Неге Tapsyr',
    why: [
      { title: 'Тегін', text: 'Қазір тапсырыс берушілерге де, шеберлерге де тегін. Жұмыс ақысын шеберге тікелей төлейсіз.' },
      { title: 'Нөміріңіз қорғалған', text: 'Телефон нөміріңізді тек өзіңіз таңдаған шебер көреді.' },
      { title: 'Шынайы пікірлер', text: 'Әр пікірді жарияламас бұрын тексереміз. Бір тапсырыс берушінің бағасы бір рет қана есептеледі.' },
      { title: 'Қызылорданың шеберлері', text: 'Қазір тек Қызылорда қаласында жұмыс істейміз, сондықтан шеберлер жақын жерде.' },
    ],
    mastersTitle: 'Сіз шеберсіз бе?',
    mastersText:
      'Жаныңыздағы тапсырыстарды көріңіз, бағаңызды ұсыныңыз және клиентпен тікелей келісіңіз. Тіркелу тегін, комиссия жоқ.',
    mastersPoints: [
      'Өз қызметтеріңізді және жұмыс уақытыңызды таңдайсыз',
      'Жұмыстарыңыздың фотосын профильге қосасыз',
      'Әр жұмыстан кейін пікір жинап, рейтингіңізді көтересіз',
    ],
    mastersCta: 'Алдын ала тіркелу',
    mastersCtaText: 'Сәлеметсіз бе! Мен шебермін, Tapsyr-ға қосылғым келеді.',
    heroMasters: 'Мен шебермін',
    form: {
      name: 'Атыңыз',
      phone: 'Телефон (WhatsApp)',
      category: 'Мамандығыңыз',
      choose: 'Таңдаңыз',
      district: 'Ауданыңыз',
      optional: 'міндетті емес',
      email: 'Gmail поштаңыз',
      emailHint: 'Қосымшаны бәрінен бұрын сынап көргіңіз келсе жазыңыз: Google Play-дегі сынаққа шақырамыз.',
      consent: 'Деректерімді <a href="/privacy/">құпиялылық саясатына</a> сәйкес өңдеуге келісемін',
      sending: 'Жіберілуде…',
      done: 'Рақмет, тіркелдіңіз! Қосымша шыққанда WhatsApp арқылы немесе қоңырау шалып хабарласамыз.',
      orWhatsapp: 'Немесе WhatsApp-қа жазыңыз',
      errors: {
        name: 'Атыңызды жазыңыз.',
        phone: 'Қазақстандық ұялы нөмір жазыңыз, мысалы +7 701 123 45 67.',
        category: 'Мамандығыңызды таңдаңыз.',
        email: 'Поштаны тексеріңіз немесе бос қалдырыңыз.',
        consent: 'Тіркелу үшін келісім белгісін қойыңыз.',
        limit: 'Әрекет тым көп. Біраздан кейін қайталаңыз немесе WhatsApp-қа жазыңыз.',
        server: 'Жіберілмеді. Интернетті тексеріп, қайталаңыз немесе WhatsApp-қа жазыңыз.',
      },
    },
    faqTitle: 'Жиі қойылатын сұрақтар',
    faq: [
      {
        q: 'Tapsyr ақылы ма?',
        a: 'Жоқ. Қазір қосымша тапсырыс берушілерге де, шеберлерге де тегін. Жұмыс ақысын шебермен өзіңіз келісіп, оған тікелей төлейсіз.',
      },
      { q: 'Қай қалада жұмыс істейді?', a: 'Қазір Қызылордада. Басқа қалаларға кейінірек шығамыз.' },
      { q: 'Қалай кіремін?', a: 'Телефон нөміріңіз арқылы: WhatsApp-қа келген кодты енгізесіз. Құпиясөз керек емес.' },
      {
        q: 'Қосымша қашан шығады?',
        a: 'Жақында: Android үшін Google Play-де, iPhone үшін App Store-да. Шыққан күні хабарлауымызды қаласаңыз, WhatsApp-қа немесе поштаға жазыңыз.',
      },
      { q: 'Аккаунтымды қалай жоямын?', a: 'Қосымшадағы «Профиль» бөлімінен немесе <a href="/delete-account/">осы бет</a> арқылы.' },
    ],
    contactsTitle: 'Байланыс',
    docsLabel: 'Құжаттар',
    legal: { privacy: 'Құпиялылық саясаты', terms: 'Пайдалану шарттары', deletion: 'Аккаунтты жою' },
  },
  ru: {
    htmlLang: 'ru',
    title: 'Tapsyr — мастера в Кызылорде',
    description:
      'Опишите задачу своими словами, и мастера Кызылорды пришлют предложения. Сантехник, электрик, уборка, ремонт и другие услуги.',
    otherLangLabel: 'Қазақша',
    h1: 'Опишите, что нужно сделать. Мастера сами пришлют предложения.',
    lead:
      'Tapsyr помогает найти мастера в Кызылорде: сантехника, электрика, уборка, ремонт техники, красота и другие услуги. Приложение бесплатное.',
    soon: 'Приложение Tapsyr скоро выйдет в Google Play и App Store. Если хотите узнать о запуске первыми, напишите нам в WhatsApp.',
    notify: 'Сообщить о запуске',
    notifyText: 'Здравствуйте! Сообщите, пожалуйста, когда выйдет приложение Tapsyr.',
    playSoon: 'Скоро в Google Play',
    playGet: 'Скачать в Google Play',
    appStoreSoon: 'Скоро в App Store',
    appStoreGet: 'Скачать в App Store',
    exampleLabel: 'Пример заявки',
    request: 'На кухне течёт кран. Сможете прийти завтра утром и починить?',
    chips: ['Сантехник', 'Завтра утром', 'Кызылорда'],
    offersTitle: '3 мастера прислали предложения',
    offers: [
      { name: 'Ерлан', who: 'Сантехник, 7 лет', price: '5 000 ₸', rating: '4,9' },
      { name: 'Нурлан', who: 'Сантехник, 4 года', price: '4 500 ₸', rating: '4,8' },
      { name: 'Асхат', who: 'Мастер на час, 10 лет', price: '6 000 ₸', rating: '5,0' },
    ],
    howTitle: 'Как это работает',
    steps: [
      { title: 'Опишите задачу', text: 'Своими словами или голосом. Можно приложить фото.' },
      { title: 'Сравните предложения', text: 'Мастера присылают свою цену. Видны их отзывы и рейтинг.' },
      { title: 'Выберите мастера', text: 'Ваш номер увидит только выбранный мастер. За работу платите ему напрямую.' },
    ],
    catsTitle: 'Какой мастер нужен?',
    catsText: 'Самые частые услуги. Если нужной нет в списке, просто напишите: Tapsyr поймёт сам.',
    whyTitle: 'Почему Tapsyr',
    why: [
      { title: 'Бесплатно', text: 'Сейчас бесплатно и для заказчиков, и для мастеров. За работу платите мастеру напрямую.' },
      { title: 'Ваш номер защищён', text: 'Номер телефона видит только мастер, которого вы выбрали.' },
      { title: 'Честные отзывы', text: 'Каждый отзыв проверяем перед публикацией. Оценка одного заказчика учитывается один раз.' },
      { title: 'Мастера из Кызылорды', text: 'Сейчас работаем только в Кызылорде, поэтому мастера рядом.' },
    ],
    mastersTitle: 'Вы мастер?',
    mastersText:
      'Смотрите заказы рядом, предлагайте свою цену и договаривайтесь с клиентом напрямую. Регистрация бесплатная, без комиссии.',
    mastersPoints: [
      'Сами выбираете услуги и рабочее время',
      'Добавляете фото своих работ в профиль',
      'Собираете отзывы после каждого заказа и поднимаете рейтинг',
    ],
    mastersCta: 'Записаться',
    mastersCtaText: 'Здравствуйте! Я мастер, хочу подключиться к Tapsyr.',
    heroMasters: 'Я мастер',
    form: {
      name: 'Ваше имя',
      phone: 'Телефон (WhatsApp)',
      category: 'Вид работ',
      choose: 'Выберите',
      district: 'Район',
      optional: 'необязательно',
      email: 'Ваш Gmail',
      emailHint: 'Укажите, если хотите попробовать приложение раньше всех: пригласим в тест в Google Play.',
      consent: 'Согласен на обработку моих данных в соответствии с <a href="/privacy/">политикой конфиденциальности</a>',
      sending: 'Отправляем…',
      done: 'Спасибо, вы записаны! Когда приложение выйдет, мы напишем вам в WhatsApp или позвоним.',
      orWhatsapp: 'Или напишите нам в WhatsApp',
      errors: {
        name: 'Напишите ваше имя.',
        phone: 'Укажите казахстанский мобильный номер, например +7 701 123 45 67.',
        category: 'Выберите вид работ.',
        email: 'Проверьте почту или оставьте поле пустым.',
        consent: 'Чтобы записаться, отметьте согласие.',
        limit: 'Слишком много попыток. Повторите позже или напишите в WhatsApp.',
        server: 'Не отправилось. Проверьте интернет и повторите или напишите в WhatsApp.',
      },
    },
    faqTitle: 'Частые вопросы',
    faq: [
      {
        q: 'Tapsyr платный?',
        a: 'Нет. Сейчас приложение бесплатное и для заказчиков, и для мастеров. Цену работы вы согласуете с мастером и платите ему напрямую.',
      },
      { q: 'В каких городах работает?', a: 'Сейчас в Кызылорде. В другие города выйдем позже.' },
      { q: 'Как войти?', a: 'По номеру телефона: введите код, который придёт в WhatsApp. Пароль не нужен.' },
      {
        q: 'Когда выйдет приложение?',
        a: 'Скоро: в Google Play для Android и в App Store для iPhone. Если хотите узнать о запуске первыми, напишите нам в WhatsApp или на почту.',
      },
      { q: 'Как удалить аккаунт?', a: 'В приложении в разделе «Профиль» или на <a href="/delete-account/">этой странице</a>.' },
    ],
    contactsTitle: 'Контакты',
    docsLabel: 'Документы',
    legal: { privacy: 'Политика конфиденциальности', terms: 'Условия использования', deletion: 'Удаление аккаунта' },
  },
};

const STYLE = `
:root{
  --sky:#0284c7;--sky-deep:#075985;--ink:#0b2e44;--text:#16384d;--muted:#557083;
  --paper:#f4f8fa;--card:#ffffff;--line:#d6e2ea;--gold:#f2b705;--gold-soft:#fdf3cf;
  --band:#0b2e44;--band-text:#e6f1f7;--band-muted:#9cc0d6;
  --display:"Onest",system-ui,sans-serif;--body:"Onest",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mark:"Unbounded",system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --sky:#38bdf8;--sky-deep:#7dd3fc;--ink:#e6f1f7;--text:#c9dce8;--muted:#8fb0c4;
  --paper:#08202f;--card:#0e2c40;--line:#1d4258;--gold:#f5c33b;--gold-soft:#3a3214;
  --band:#0e2c40;--band-text:#e6f1f7;--band-muted:#8fb0c4;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--text);font:17px/1.6 var(--body)}
img{max-width:100%;display:block}
a{color:var(--sky)}
:focus-visible{outline:3px solid var(--gold);outline-offset:3px;border-radius:6px}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font:700 21px/1 var(--mark);letter-spacing:-.01em}
.brand img{width:38px;height:38px;border-radius:11px}
.lang{font-weight:600;font-size:15px;text-decoration:none;padding:8px 12px;border:1.5px solid var(--line);border-radius:999px;color:var(--ink)}
.lang:hover{border-color:var(--sky)}

.hero{display:grid;gap:36px;padding:20px 0 64px}
.hero h1{font:800 clamp(32px,7.6vw,62px)/1.04 var(--display);letter-spacing:-.035em;color:var(--ink);margin:0 0 20px;max-width:14ch}
.hero h1 span{display:block}
.lead{font-size:clamp(17px,2.2vw,19px);max-width:46ch;margin:0 0 28px;color:var(--text)}
.ctas{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border-radius:14px;font:600 17px/1 var(--body);text-decoration:none}
.btn-main{background:var(--sky);color:#fff}
.btn-main:hover{background:var(--sky-deep)}
@media (prefers-color-scheme:dark){.btn-main{color:#04202f}}
.play{display:inline-flex;align-items:center;gap:10px;min-height:52px;padding:0 18px;border-radius:14px;border:1.5px solid var(--line);color:var(--muted);font-weight:600;font-size:15px;text-decoration:none}
a.play{color:var(--ink)}
a.play:hover{border-color:var(--sky)}
.play svg{width:20px;height:20px;flex:none}
.soon{max-width:46ch;margin:0 0 20px;padding:12px 16px;border-radius:14px;background:var(--gold-soft);color:var(--ink);font-size:16px}
.stores{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}

.scene{position:relative;max-width:520px}
.scene .photo{border-radius:28px;aspect-ratio:1/1;object-fit:cover;width:100%}
.ask{position:relative;margin:-96px 16px 0;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px 18px 8px;box-shadow:0 18px 40px -18px rgba(11,46,68,.35)}
.ask .label{font-size:13px;color:var(--muted);margin:0 0 8px}
.ask blockquote{margin:0 0 12px;font:500 18px/1.45 var(--body);color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;padding:0;list-style:none}
.chips li{font-size:14px;font-weight:600;padding:5px 11px;border-radius:999px;background:var(--gold-soft);color:var(--ink)}
.offers{border-top:1px solid var(--line);padding:12px 0 4px}
.offers h2{font:600 14px/1.3 var(--body);color:var(--muted);margin:0 0 6px}
.offers ul{list-style:none;margin:0;padding:0}
.offers li{display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:center;padding:8px 0}
.offers li+li{border-top:1px dashed var(--line)}
.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--sky);color:#fff;font:700 15px/1 var(--body)}
.who b{display:block;color:var(--ink);font-size:16px}
.who small{color:var(--muted);font-size:13px}
.price{text-align:right;font-weight:700;color:var(--ink);font-size:16px}
.price small{display:block;font-weight:500;color:var(--muted);font-size:13px}

section{padding:56px 0}
h2.title{font:800 clamp(26px,4.8vw,42px)/1.1 var(--display);letter-spacing:-.03em;color:var(--ink);margin:0 0 12px;max-width:22ch}
.sub{max-width:52ch;margin:0 0 28px;color:var(--muted)}

.steps{list-style:none;margin:28px 0 0;padding:0;display:grid;gap:28px;counter-reset:step}
.steps li{counter-increment:step;display:grid;grid-template-columns:auto 1fr;gap:4px 18px}
.steps li::before{content:counter(step);grid-row:span 2;font:800 48px/1 var(--display);color:var(--sky);min-width:40px}
.steps h3{margin:4px 0 0;font:700 19px/1.3 var(--body);color:var(--ink)}
.steps p{margin:0;color:var(--text)}

.cats{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.cats li{position:relative;border-radius:18px;overflow:hidden;aspect-ratio:4/5;background:var(--line)}
.cats img{width:100%;height:100%;object-fit:cover}
.cats span{position:absolute;left:0;right:0;bottom:0;padding:28px 12px 12px;color:#fff;font:600 16px/1.25 var(--body);background:linear-gradient(transparent,rgba(5,25,38,.82))}

.why{list-style:none;margin:28px 0 0;padding:0;display:grid;gap:0}
.why li{padding:20px 0;border-top:1px solid var(--line)}
.why h3{margin:0 0 4px;font:700 19px/1.3 var(--body);color:var(--ink)}
.why p{margin:0;max-width:52ch}

.masters{background:var(--band);color:var(--band-text);border-radius:32px;padding:0;overflow:hidden;display:grid}
.masters .text{padding:36px 24px}
.masters h2.title{color:var(--band-text)}
.masters p{color:var(--band-text);max-width:46ch;margin:0 0 20px}
.masters ul{margin:0 0 28px;padding:0;list-style:none}
.masters li{padding:8px 0 8px 30px;position:relative;color:var(--band-text)}
.masters li::before{content:"";position:absolute;left:4px;top:15px;width:12px;height:12px;border-radius:50%;background:var(--gold)}
.masters .btn-main{background:var(--gold);color:#1d2a12}
.masters .btn-main:hover{background:#ffd23a}
.masters img{width:100%;height:100%;object-fit:cover;min-height:280px}
.btn-ghost{border:1.5px solid var(--line);color:var(--ink)}
.btn-ghost:hover{border-color:var(--sky)}
.join{display:grid;gap:14px;margin:0 0 18px}
.join .row{display:grid;gap:14px}
.join label{display:block;font-weight:600;font-size:15px;color:var(--band-text);margin:0 0 6px}
.join label small{font-weight:400;color:var(--band-muted)}
.join input[type=text],.join input[type=tel],.join input[type=email],.join select{width:100%;min-height:50px;padding:0 14px;border-radius:12px;border:1.5px solid var(--band-muted);background:rgba(255,255,255,.07);color:var(--band-text);font:16px/1.3 var(--body);appearance:none}
.join select{background-image:linear-gradient(45deg,transparent 50%,var(--band-muted) 50%),linear-gradient(135deg,var(--band-muted) 50%,transparent 50%);background-position:calc(100% - 20px) 22px,calc(100% - 14px) 22px;background-size:6px 6px;background-repeat:no-repeat;padding-right:36px}
.join select option{color:#0b2e44}
.join input:focus,.join select:focus{outline:none;border-color:var(--gold)}
.join [aria-invalid=true]{border-color:#ff9a8a}
.join .hint{margin:6px 0 0;font-size:14px;color:var(--band-muted)}
.join .check{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:15px;margin:0}
.join .check input{width:22px;height:22px;flex:none;margin:1px 0 0;accent-color:var(--gold)}
.join .check a{color:var(--gold)}
.join .trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.join button{border:0;cursor:pointer;justify-self:start}
.join button:disabled{opacity:.6;cursor:progress}
.join [hidden]{display:none}
.join .status{margin:0;min-height:1.6em;font-size:15px}
.join .status.err{color:#ffb3a7}
.join .status.ok{color:var(--band-text);background:rgba(242,183,5,.16);border-radius:12px;padding:12px 14px}
.masters .wa{color:var(--band-muted);font-size:15px}
.masters .wa a{color:var(--band-text)}

.faq{max-width:760px}
.faq details{border-top:1px solid var(--line);padding:4px 0}
.faq details:last-child{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;padding:16px 36px 16px 0;position:relative;font-weight:600;font-size:18px;color:var(--ink)}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:4px;top:12px;font:400 26px/1 var(--display);color:var(--sky)}
.faq details[open] summary::after{content:"\\2212"}
.faq details p{margin:0 0 16px;max-width:60ch}

footer{border-top:1px solid var(--line);margin-top:40px;padding:36px 0 48px;color:var(--muted);font-size:15px}
footer .cols{display:grid;gap:24px}
footer h2{font:700 15px/1.3 var(--body);color:var(--ink);margin:0 0 8px}
footer p{margin:0 0 6px}
.social{display:flex;gap:10px;margin-top:12px}
.social a{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1.5px solid var(--line);color:var(--ink)}
.social a:hover{border-color:var(--sky);color:var(--sky)}
.social svg{width:22px;height:22px}
footer .op{margin-top:14px;color:var(--ink);font-weight:600}
footer nav a{display:block;padding:3px 0}

@media (min-width:900px){
  .hero{grid-template-columns:1.05fr .95fr;align-items:center;padding:40px 0 88px}
  .scene{justify-self:end}
  .ask{margin:-120px -24px 0 24px}
  .steps{grid-template-columns:repeat(3,1fr);gap:40px}
  .cats{grid-template-columns:repeat(4,1fr);gap:16px}
  .why{grid-template-columns:1fr 1fr;column-gap:48px}
  .masters{grid-template-columns:1.1fr .9fr}
  .masters .text{padding:56px}
  .join .row{grid-template-columns:1fr 1fr}
  footer .cols{grid-template-columns:1.4fr 1fr 1fr}
}

@media (prefers-reduced-motion:no-preference){
  .ask{animation:rise .6s cubic-bezier(.2,.7,.2,1) .15s both}
  .chips li{animation:pop .4s ease-out both}
  .chips li:nth-child(1){animation-delay:.7s}.chips li:nth-child(2){animation-delay:.85s}.chips li:nth-child(3){animation-delay:1s}
  .offers li{animation:rise .5s ease-out both}
  .offers li:nth-child(1){animation-delay:1.3s}.offers li:nth-child(2){animation-delay:1.5s}.offers li:nth-child(3){animation-delay:1.7s}
}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
`;

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.6 2.3c-.3.3-.5.8-.5 1.4v16.6c0 .6.2 1.1.5 1.4l9.3-9.7-9.3-9.7Zm10.7 8.2 2.8-2.9-11-6.4c-.4-.2-.8-.3-1.1-.2l9.3 9.5Zm0 3-9.3 9.5c.3.1.7 0 1.1-.2l11-6.4-2.8-2.9Zm4.3-4.6-3 1.8 3.1 3.2 3-1.8c.9-.5.9-1.9 0-2.4l-3.1-.8Z"/></svg>';

const APPLE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9ZM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4Z"/></svg>';

const INSTAGRAM_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';

const TIKTOK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.9 7.9 0 0 0 4.4 1.4V6.7a4.5 4.5 0 0 1-4.4-4.7Z"/></svg>';

const MAIL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>';

const store = (url: string, icon: string, get: string, soon: string) =>
  url
    ? `<a class="play" href="${url}" rel="noopener">${icon}${esc(get)}</a>`
    : `<span class="play" aria-disabled="true">${icon}${esc(soon)}</span>`;

/** Masters' pre-registration; landing.js sends it to the masterSignup function (functions/src/masterSignup.ts) */
function joinForm(c: Copy, lang: Lang): string {
  const f = c.form;
  const opt = `<small>(${esc(f.optional)})</small>`;
  const errors = Object.entries(f.errors)
    .map(([k, v]) => ` data-err-${k}="${esc(v)}"`)
    .join('');
  return `<form class="join" id="join" novalidate data-endpoint="${esc(MASTER_SIGNUP_URL)}" data-lang="${lang}" data-consent-version="${esc(LEGAL_VERSION)}" data-sending="${esc(f.sending)}" data-done="${esc(f.done)}"${errors}>
<div class="row">
<div><label for="join-name">${esc(f.name)}</label><input id="join-name" name="name" type="text" autocomplete="name" maxlength="60" required></div>
<div><label for="join-phone">${esc(f.phone)}</label><input id="join-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 7__ ___ __ __" maxlength="20" required></div>
</div>
<div class="row">
<div><label for="join-category">${esc(f.category)}</label><select id="join-category" name="category" required><option value="">${esc(f.choose)}</option>${SIGNUP_CATEGORIES.map((g) => `<option value="${g.id}">${esc(g[lang])}</option>`).join('')}</select></div>
<div><label for="join-district">${esc(f.district)} ${opt}</label><input id="join-district" name="district" type="text" maxlength="60" autocomplete="address-level3"></div>
</div>
<div><label for="join-email">${esc(f.email)} ${opt}</label><input id="join-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="100" placeholder="name@gmail.com" aria-describedby="join-email-hint"><p class="hint" id="join-email-hint">${esc(f.emailHint)}</p></div>
<div class="trap" aria-hidden="true"><label for="join-website">Website</label><input id="join-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
<label class="check"><input type="checkbox" name="consent" required><span>${f.consent}</span></label>
<button class="btn btn-main" type="submit">${esc(c.mastersCta)}</button>
<p class="status" role="status" aria-live="polite"></p>
</form>`;
}

export function renderLandingPage(lang: Lang): string {
  const c = COPY[lang];
  const other: Lang = lang === 'kz' ? 'ru' : 'kz';
  const home = lang === 'kz' ? '/' : '/ru/';
  const otherHref = other === 'kz' ? '/' : '/ru/';
  const [h1First, ...h1Rest] = c.h1.split('. ');
  const h1 = h1Rest.length ? `${esc(h1First)}.<span>${esc(h1Rest.join('. '))}</span>` : esc(c.h1);
  const stores = `${store(PLAY_STORE_URL, PLAY_ICON, c.playGet, c.playSoon)}\n${store(APP_STORE_URL, APPLE_ICON, c.appStoreGet, c.appStoreSoon)}`;
  const wa = LEGAL_OPERATOR.whatsapp.replace(/\D/g, '');
  const waText = (text: string) => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;

  return `<!doctype html>
<html lang="${c.htmlLang}" data-page-lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Meta business verification of tapsyrapp.com -->
<meta name="facebook-domain-verification" content="cljgjykqsk05vo2lurkp6whel2yc1o">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.description)}">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="/img/photo/role_customer.webp">
<meta name="theme-color" content="#f4f8fa">
<link rel="canonical" href="https://tapsyrapp.com${home}">
<link rel="alternate" hreflang="kk" href="https://tapsyrapp.com/">
<link rel="alternate" hreflang="ru" href="https://tapsyrapp.com/ru/">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&family=Unbounded:wght@700&display=swap" rel="stylesheet">
<style>${STYLE}</style>
<script src="/landing.js" defer></script>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="brand" href="${home}"><img src="/icon.svg" alt="" width="38" height="38">Tapsyr</a>
<a class="lang" href="${otherHref}" hreflang="${COPY[other].htmlLang}" lang="${COPY[other].htmlLang}" data-lang="${other}">${esc(c.otherLangLabel)}</a>
</header>

<main>
<div class="hero">
<div>
<h1>${h1}</h1>
<p class="lead">${esc(c.lead)}</p>
<p class="soon">${esc(c.soon)}</p>
<div class="ctas">
<a class="btn btn-main" href="${waText(c.notifyText)}" rel="noopener">${esc(c.notify)}</a>
<a class="btn btn-ghost" href="#join">${esc(c.heroMasters)}</a>
</div>
<div class="stores">
${stores}
</div>
</div>
<div class="scene">
<img class="photo" src="/img/photo/role_customer.webp" alt="" width="768" height="768">
<div class="ask">
<p class="label">${esc(c.exampleLabel)}</p>
<blockquote>${esc(c.request)}</blockquote>
<ul class="chips">${c.chips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
<div class="offers">
<h2>${esc(c.offersTitle)}</h2>
<ul>${c.offers
    .map(
      (o) =>
        `<li><span class="avatar" aria-hidden="true">${esc(o.name.charAt(0))}</span><span class="who"><b>${esc(o.name)}</b><small>${esc(o.who)}</small></span><span class="price">${esc(o.price)}<small>★ ${esc(o.rating)}</small></span></li>`,
    )
    .join('')}</ul>
</div>
</div>
</div>
</div>

<section aria-labelledby="how">
<h2 class="title" id="how">${esc(c.howTitle)}</h2>
<ol class="steps">${c.steps.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>
</section>

<section aria-labelledby="cats">
<h2 class="title" id="cats">${esc(c.catsTitle)}</h2>
<p class="sub">${esc(c.catsText)}</p>
<ul class="cats">${CATEGORIES.map(
    (g) =>
      `<li><img src="/img/photo/${g.photo}.webp" alt="" width="768" height="768" loading="lazy" decoding="async"><span>${esc(g[lang])}</span></li>`,
  ).join('')}</ul>
</section>

<section aria-labelledby="why">
<h2 class="title" id="why">${esc(c.whyTitle)}</h2>
<ul class="why">${c.why.map((w) => `<li><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></li>`).join('')}</ul>
</section>

<section aria-labelledby="masters">
<div class="masters">
<div class="text">
<h2 class="title" id="masters">${esc(c.mastersTitle)}</h2>
<p>${esc(c.mastersText)}</p>
<ul>${c.mastersPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
${joinForm(c, lang)}
<p class="wa"><a href="${waText(c.mastersCtaText)}" rel="noopener">${esc(c.form.orWhatsapp)}</a></p>
</div>
<img src="/img/photo/role_master.webp" alt="" width="768" height="768" loading="lazy" decoding="async">
</div>
</section>

<section aria-labelledby="faq" class="faq">
<h2 class="title" id="faq">${esc(c.faqTitle)}</h2>
${c.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join('\n')}
</section>
</main>

<footer>
<div class="cols">
<div>
<a class="brand" href="${home}"><img src="/icon.svg" alt="" width="38" height="38">Tapsyr</a>
<p class="op">${esc(LEGAL_OPERATOR.shortName)}</p>
<div class="stores">
${stores}
</div>
</div>
<div>
<h2>${esc(c.contactsTitle)}</h2>
<p>WhatsApp: <a href="https://wa.me/${wa}">${esc(LEGAL_OPERATOR.whatsapp)}</a></p>
<div class="social">
<a href="${INSTAGRAM_URL}" rel="noopener" target="_blank" aria-label="Instagram @tapsyrapp" title="Instagram">${INSTAGRAM_ICON}</a>
<a href="${TIKTOK_URL}" rel="noopener" target="_blank" aria-label="TikTok @tapsyrapp" title="TikTok">${TIKTOK_ICON}</a>
<a href="mailto:${LEGAL_OPERATOR.email}" aria-label="${esc(LEGAL_OPERATOR.email)}" title="${esc(LEGAL_OPERATOR.email)}">${MAIL_ICON}</a>
</div>
</div>
<nav aria-label="${esc(c.docsLabel)}">
<a href="/privacy/">${esc(c.legal.privacy)}</a>
<a href="/terms/">${esc(c.legal.terms)}</a>
<a href="/delete-account/">${esc(c.legal.deletion)}</a>
</nav>
</div>
</footer>
</div>
</body>
</html>
`;
}

/** Behaviour of the landing pages; a separate file because the site's policy forbids inline scripts */
export const LANDING_SCRIPT = `(function () {
  var page = document.documentElement.getAttribute('data-page-lang');
  try {
    // Someone who chose Russian in the app or here before sees the Russian page
    if (page === 'kz' && localStorage.getItem('${APP_LANGUAGE_KEY}') === 'ru') { location.replace('/ru/' + location.hash); return; }
  } catch (e) {}
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[data-lang]') : null;
    if (!link) return;
    try {
      localStorage.setItem('${APP_LANGUAGE_KEY}', link.getAttribute('data-lang'));
    } catch (e) {}
  });

  // Masters' pre-registration form
  var form = document.getElementById('join');
  if (!form || !window.fetch) return;
  var status = form.querySelector('.status');
  var button = form.querySelector('button[type=submit]');
  var label = button.textContent;
  var field = function (name) { return form.elements[name]; };
  var show = function (text, kind) { status.textContent = text; status.className = 'status' + (kind ? ' ' + kind : ''); };
  var mark = function (name) {
    ['name', 'phone', 'category', 'email', 'consent'].forEach(function (n) { field(n).removeAttribute('aria-invalid'); });
    if (name && field(name)) { field(name).setAttribute('aria-invalid', 'true'); field(name).focus(); }
  };
  var fail = function (name) { mark(name); show(form.getAttribute('data-err-' + name) || form.getAttribute('data-err-server'), 'err'); };
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var digits = field('phone').value.replace(/\\D/g, '');
    if (field('name').value.trim().length < 2) return fail('name');
    if (digits.length < 10 || digits.length > 11) return fail('phone');
    if (!field('category').value) return fail('category');
    var email = field('email').value.trim();
    if (email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return fail('email');
    if (!field('consent').checked) return fail('consent');
    mark(null);
    button.disabled = true;
    button.textContent = form.getAttribute('data-sending');
    show('');
    fetch(form.getAttribute('data-endpoint'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: field('name').value,
        phone: field('phone').value,
        category: field('category').value,
        district: field('district').value,
        email: email,
        website: field('website').value,
        lang: form.getAttribute('data-lang'),
        consent: true,
        consentVersion: form.getAttribute('data-consent-version')
      })
    })
      .then(function (res) { return res.json().catch(function () { return { ok: false, error: 'server' }; }); })
      .then(function (answer) {
        if (answer && answer.ok) {
          form.reset();
          Array.prototype.forEach.call(form.querySelectorAll('.row, .row + div, .check, button'), function (el) { el.hidden = true; });
          show(form.getAttribute('data-done'), 'ok');
          return;
        }
        if (answer && answer.error === 'invalid' && answer.field) return fail(answer.field);
        fail(answer && answer.error === 'limit' ? 'limit' : 'server');
      })
      .catch(function () { fail('server'); })
      .then(function () { button.disabled = false; button.textContent = label; });
  });
})();
`;

/** Files of the web app that a website build leaves out, so the site holds no app at all */
const APP_ONLY = ['index.html', 'assets', 'manifest.webmanifest', 'sounds'];

/** Vite plugin: for website builds, put the information pages at / and /ru/ and leave the app out */
export function sitePages(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'tapsyr-site-pages',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      if (process.env.TAPSYR_SITE !== '1') return;
      const out = path.resolve(config.root, config.build.outDir);
      if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('site pages: the app build has no index.html');
      for (const name of APP_ONLY) fs.rmSync(path.join(out, name), { recursive: true, force: true });
      fs.writeFileSync(path.join(out, 'index.html'), renderLandingPage('kz'));
      fs.mkdirSync(path.join(out, 'ru'), { recursive: true });
      fs.writeFileSync(path.join(out, 'ru', 'index.html'), renderLandingPage('ru'));
      fs.writeFileSync(path.join(out, 'landing.js'), LANDING_SCRIPT);
    },
  };
}
