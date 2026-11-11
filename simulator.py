import pandas as pd
import numpy as np
import os
import math
from datetime import datetime, timedelta

os.makedirs('data/sim', exist_ok=True)
REF_LAT, REF_LON = 12.58, 43.33
COLUMNS = ['timestamp', 'track_id', 'lat', 'lon', 'sog_kn', 'cog_deg', 'source', 'mmsi', 'label']

def add_radar_noise(lat, lon):
    return lat + np.random.normal(0, 0.0001), lon + np.random.normal(0, 0.0001)

def get_bearing(dlat, dlon):
    # حساب الاتجاه الحقيقي بناءً على التغير في الإحداثيات
    bearing = math.degrees(math.atan2(dlon, dlat))
    return int((bearing + 360) % 360)

def generate_scenario(name, num_targets, speed, start_offsets, dir_offsets):
    data = []
    start_time = datetime(2026, 11, 10, 8, 0, 0)
    
    for idx in range(num_targets):
        lat = REF_LAT + start_offsets[idx][0]
        lon = REF_LON + start_offsets[idx][1]
        dlat, dlon = dir_offsets[idx][0], dir_offsets[idx][1]
        
        # إذا كان الهدف ثابتاً يُعطى اتجاهاً عشوائياً، وإلا يحسب هندسياً
        cog = get_bearing(dlat, dlon) if (dlat != 0 or dlon != 0) else np.random.randint(0, 360)
        
        for i in range(120): # 6 دقائق (120 ضرب 3 ثواني)
            if np.random.rand() > 0.1: 
                noisy_lat, noisy_lon = add_radar_noise(lat, lon)
                # قوارب الصيد تتحرك بعشوائية، المهاجمون يحافظون على الاتجاه
                current_cog = cog if speed > 5 else np.random.randint(0, 360)
                
                data.append([
                    (start_time + timedelta(seconds=i*3)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    f'sim_{name}_{idx}', noisy_lat, noisy_lon, speed, current_cog, 'radar_sim', '', name
                ])
            lat += dlat
            lon += dlon
            
    df = pd.DataFrame(data, columns=COLUMNS)
    df.to_csv(f'data/sim/{name}.csv', index=False)

# 1. اقتراب منفرد (HIGH)
generate_scenario('single_approach', 1, 25.0, [(0.05, 0.05)], [(-0.0004, -0.0004)])
# 2. تجمع صيد (LOW)
generate_scenario('fishing_cluster', 4, 3.0, [(0.01, 0.01), (0.012, 0.008), (0.008, 0.012), (0.01, 0.009)], [(0, 0), (0, 0), (0, 0), (0, 0)])
# 3. هجوم منسق (HIGH)
generate_scenario('coordinated_attack', 3, 30.0, [(0.04, 0.04), (-0.04, 0.04), (0.04, -0.04)], [(-0.0003, -0.0003), (0.0003, -0.0003), (-0.0003, 0.0003)])
# 4. قارب منفرد يعبر بسرعة (MEDIUM)
generate_scenario('fast_crossing', 1, 20.0, [(0.06, -0.02)], [(-0.0005, 0.0001)])
# 5. سفينة أم (HIGH - هدف بطيء يطلق هدفاً سريعاً)
generate_scenario('mother_ship', 2, 15.0, [(0.03, 0.03), (0.03, 0.03)], [(-0.0001, -0.0001), (-0.0004, -0.0004)])

print("تم تحديث السيناريوهات الـ 5 بفيزياء حركية صحيحة في data/sim/")