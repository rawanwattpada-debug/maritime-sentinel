// All the intro text lives here, so it can be edited without touching the code.
// Every number has its source in SOURCES below.

export const SLIDES = [
  {
    id: 'title',
    media: 'video',
    video: 'videos/01-sea-night.mp4',
    kicker: '',
    title: 'Maritime Sentinel',
    subtitle: 'منصة الإنذار المبكر للمخاطر البحرية',
    lines: ['رصد السلوكيات غير الاعتيادية. تقييم المخاطر. تمكين الاستجابة البشرية السريعة.'],
  },
  {
    id: 'importance',
    media: 'video',
    video: 'videos/02-cargo-ship.mp4',
    kicker: 'أهمية الملاحة البحرية',
    stat: { value: '80%+', label: 'من حجم التجارة العالمية يُنقل بحرًا' },
    lines: ['وأي تهديد لأمن الملاحة ينعكس مباشرة على سلاسل الإمداد العالمية.'],
    source: 'UNCTAD',
  },
  {
    id: 'problem',
    media: 'globe',
    kicker: 'تحديات أمن الملاحة والتجارة البحرية',
    stats: [
      { value: '137', label: 'حادثة قرصنة وسطو مسلح على السفن في 2025، الأعلى منذ خمس سنوات', source: 'IMB' },
      { value: '42', label: 'حادثة باستخدام أسلحة نارية، مقابل 26 في 2024', source: 'IMB' },
      { value: '+100', label: 'هجوم على سفن تجارية في ممر ملاحي واحد منذ 2023، غرقت فيها 4 سفن', source: 'JMIC' },
    ],
    lines: ['وانخفضت حركة الشحن في ذلك الممر إلى أقل من الثلث.'],
  },
  {
    id: 'gap',
    media: 'map',
    kicker: 'من تتبع المواقع إلى فهم السلوك الملاحي',
    title: 'الأنظمة الحالية تعرض موقع السفينة، لكنها لا تفسّر سلوكها',
    points: [
      { title: 'اقتراب الزوارق الصغيرة', text: 'صعوبة تمييز الزوارق غير المعرّفة أثناء اقترابها التدريجي.' },
      { title: 'تغييرات المسار المفاجئة', text: 'انحراف مفاجئ عن خطوط الملاحة دون مبرر ملحوظ.' },
      { title: 'الإجهاد الذهني للمشغلين', text: 'مراقبة بشرية مستمرة لآلاف نقاط البيانات الرادارية.' },
    ],
  },
  {
    id: 'solution',
    media: 'map',
    kicker: 'الحل',
    title: 'Maritime Sentinel',
    lead: 'منظومة ذكية متكاملة بثلاث قدرات:',
    points: [
      { title: 'المراقبة البحرية المستمرة', text: 'تتبع السفن والأهداف المجاورة لحظيًا.' },
      { title: 'تقييم المخاطر السلوكية', text: 'رصد الشذوذ الملاحي وإنذار مبكر قابل للتفسير.' },
      { title: 'التحقق البصري بالمسيّرات', text: 'تأكيد بصري مباشر عند الحاجة، بقرار بشري.' },
    ],
    motto: 'الذكاء الاصطناعي يستكشف، والإنسان يقرر.',
    cta: 'ادخل غرفة العمليات',
  },
];

export const SOURCES = [
  { key: 'UNCTAD', text: 'UNCTAD, Review of Maritime Transport' },
  { key: 'IMB', text: 'ICC International Maritime Bureau, Piracy and Armed Robbery Against Ships, 2025 annual report' },
  { key: 'JMIC', text: 'Joint Maritime Information Centre (via Reuters factbox, 2025)' },
  { key: 'Pexels', text: 'Videos: Pexels (free license)' },
];

export const DATA_NOTE =
  'السفن في الخلفية حقيقية: مسجلة من مضيق دوفر ومنقولة إلى باب المندب. الأهداف بدون AIS محاكاة.';
