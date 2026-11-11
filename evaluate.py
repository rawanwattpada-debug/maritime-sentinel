import pandas as pd
import numpy as np
import math
import os
from sklearn.metrics import precision_score, recall_score, confusion_matrix

os.makedirs('data', exist_ok=True)

# 1. توليد 200 سيناريو حركي فعلي (وليس تصنيفات فقط)
np.random.seed(42)
eval_data = []
start_time = pd.Timestamp('2026-11-10T08:00:00Z')

for track_id in range(1, 201):
    is_attack = np.random.rand() > 0.7
    label = 'coordinated_attack' if is_attack else 'fishing_cluster'
    speed = np.random.uniform(25, 35) if is_attack else np.random.uniform(1, 5)
    
    lat, lon = 12.58 + np.random.uniform(-0.05, 0.05), 43.33 + np.random.uniform(-0.05, 0.05)
    dlat, dlon = np.random.uniform(-0.0005, 0.0005), np.random.uniform(-0.0005, 0.0005)
    cog = int((math.degrees(math.atan2(dlon, dlat)) + 360) % 360)
    
    for step in range(60): # 3 دقائق لكل قارب تقييم
        eval_data.append({
            'timestamp': (start_time + pd.Timedelta(seconds=step*3)).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'track_id': f'eval_{track_id}',
            'lat': lat, 'lon': lon, 'sog_kn': speed, 'cog_deg': cog,
            'source': 'radar_sim', 'mmsi': '', 'label': label
        })
        lat += dlat
        lon += dlon

df_eval = pd.DataFrame(eval_data)
df_eval.to_parquet('data/eval_set.parquet', engine='pyarrow')
print("تم توليد الحركات الفعلية لـ 200 قارب وحفظها في data/eval_set.parquet")

# 2. التقييم الحقيقي المستند على مخرجات محرك الخطورة
# يفترض أن محرك الخطورة يقرأ eval_set.parquet ويحفظ نتائجه في risk_output.csv
if os.path.exists('data/risk_output.csv'):
    risk_results = pd.read_csv('data/risk_output.csv')
    
    # استخراج التصنيف الحقيقي من البيانات الأصلية (لكل مسار)
    actual_labels = df_eval.groupby('track_id')['label'].first().reset_index()
    actual_labels['y_true'] = actual_labels['label'].apply(lambda x: 1 if x == 'coordinated_attack' else 0)
    
    # دمج التوقع الحقيقي للمحرك
    merged = pd.merge(actual_labels, risk_results, on='track_id', how='left')
    merged['y_pred'] = merged['level'].apply(lambda x: 1 if x == 'HIGH' else 0)
    
    precision = precision_score(merged['y_true'], merged['y_pred'])
    recall = recall_score(merged['y_true'], merged['y_pred'])
    conf_matrix = confusion_matrix(merged['y_true'], merged['y_pred'])
    
    print("\n--- أرقام التقييم النهائية للعرض التقديمي ---")
    print(f"الدقة (Precision): {precision:.2f}")
    print(f"الاستدعاء (Recall): {recall:.2f}")
    print(f"إنذارات كاذبة (False Alarms): {conf_matrix[0][1]} حالة")
else:
    print("\nتنبيه: ملف مخرجات محرك الخطورة (risk_output.csv) غير موجود بعد.")
    print("أخبري العضوة 3 بتشغيل محرك الخطورة على eval_set.parquet أولاً لكي يحسب هذا السكربت النتائج الحقيقية.")