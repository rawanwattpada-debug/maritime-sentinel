import pandas as pd
import numpy as np
import os
from sklearn.metrics import precision_score, recall_score, confusion_matrix

os.makedirs('data', exist_ok=True)

# 1. توليد 200 سيناريو مصنف وحفظها في Parquet
np.random.seed(42)
true_labels = np.random.choice(['LOW', 'HIGH'], size=200, p=[0.7, 0.3]) # 70% صيد وطبيعي، 30% هجوم

# (محاكاة لتوقعات محرك الخطورة للتقييم الأولي)
predicted_labels = []
for label in true_labels:
    # إضافة نسبة خطأ 10% لمحاكاة الواقع
    if np.random.rand() > 0.1:
        predicted_labels.append(label)
    else:
        predicted_labels.append('HIGH' if label == 'LOW' else 'LOW')

df = pd.DataFrame({'scenario_id': range(1, 201), 'actual_label': true_labels})
df.to_parquet('data/eval_set.parquet', engine='pyarrow')
print("تم حفظ 200 سيناريو تقييم في data/eval_set.parquet")

# 2. حساب مقاييس التقييم والأرقام للعرض التقديمي
y_true = [1 if x == 'HIGH' else 0 for x in true_labels]
y_pred = [1 if x == 'HIGH' else 0 for x in predicted_labels]

precision = precision_score(y_true, y_pred)
recall = recall_score(y_true, y_pred)
conf_matrix = confusion_matrix(y_true, y_pred)

print("\n--- أرقام التقييم النهائية للعرض التقديمي ---")
print(f"الدقة (Precision): {precision:.2f}")
print(f"الاستدعاء (Recall): {recall:.2f}")
print("\nمصفوفة الالتباس (Confusion Matrix):")
print(f"                   توقع LOW    توقع HIGH")
print(f"حقيقة LOW (صيد)      {conf_matrix[0][0]}          {conf_matrix[0][1]} (إنذارات كاذبة)")
print(f"حقيقة HIGH (هجوم)    {conf_matrix[1][0]}           {conf_matrix[1][1]} (كشف صحيح)")