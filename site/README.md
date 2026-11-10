# موقع Maritime Sentinel

عرض بالتمرير (5 شرائح)، وبعده زر يفتح غرفة العمليات (الداش بورد).
الموقع يشغّل حلقة الديمو بنفسه من ملف واحد (`public/data/demo.json`)، فما يحتاج خادم.

## التشغيل

يحتاج Node.js (من nodejs.org، نسخة LTS).

```bash
cd site
npm install
npm run dev
```
وافتحي الرابط اللي يطلع (عادة `http://localhost:5173`).

**نسخة نهائية** (مجلد `dist` تقدرون ترفعونه على أي استضافة أو تفتحونه بدون إنترنت، إلا صورة الخريطة):
```bash
npm run build
npm run preview
```

## تحديث البيانات
من المجلد الرئيسي للمشروع (مو من `site`):
```bash
python export_demo.py
```
يعيد إنشاء `site/public/data/demo.json` من التسجيل، ومن سيناريوهات لمى (`data/sim/`)، ومن محرك ولاء (`risk_engine.py`) لو كانت موجودة. ولو ما كانت موجودة، يستخدم بدائل مؤقتة ويكتب ذلك في الملف.

## الملفات اللي ننتظرها
| الملف | من | وش يصير لو ناقص |
|---|---|---|
| `public/videos/01-sea-night.mp4`, `02-cargo-ship.mp4` | روان (Pexels) | خلفية متدرجة بدل الفيديو |
| `public/media/drone_detect.mp4` | مهمة الرؤية الحاسوبية | رسالة مكان الفيديو |
| `public/media/vision_summary.json` (`{"boats": 3, "mean_confidence": 0.87}`) | مهمة الرؤية الحاسوبية | نص توضيحي |
| `data/sim/fishing_cluster.csv`, `coordinated_attack.csv` | لمى | سيناريوهات مؤقتة |
| `risk_engine.py` فيه `score_targets(points)` | ولاء | قواعد تقييم مؤقتة |

## وين أعدّل؟
- **نصوص الشرائح والمصادر:** `src/content.js`
- **الألوان والخطوط:** `src/index.css`
- **صفحات الداش بورد:** `src/dashboard/pages.jsx`
