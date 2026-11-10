import pandas as pd
import numpy as np
import os
from datetime import datetime, timedelta

os.makedirs('data/sim', exist_ok=True)

REF_LAT, REF_LON = 12.58, 43.33
COLUMNS = ['timestamp', 'track_id', 'lat', 'lon', 'sog_kn', 'cog_deg', 'source', 'mmsi', 'label']

def add_radar_noise(lat, lon):
    return lat + np.random.normal(0, 0.00045), lon + np.random.normal(0, 0.00045)

def generate_scenario(name, num_targets, speed, is_high_risk, start_offsets, dir_offsets):
    data = []
    start_time = datetime(2026, 11, 10, 8, 0, 0)
    
    for idx in range(num_targets):
        lat = REF_LAT + start_offsets[idx][0]
        lon = REF_LON + start_offsets[idx][1]
        label = 'HIGH' if is_high_risk else 'LOW'
        
        for i in range(60): 
            if np.random.rand() > 0.1: 
                noisy_lat, noisy_lon = add_radar_noise(lat, lon)
                data.append([
                    (start_time + timedelta(seconds=i*3)).strftime('%Y-%m-%dT%H:%M:%SZ'),
                    f'sim_{name}_{idx}', noisy_lat, noisy_lon, speed, np.random.randint(0, 360), 'radar_sim', '', label
                ])
            lat += dir_offsets[idx][0]
            lon += dir_offsets[idx][1]
            
    df = pd.DataFrame(data, columns=COLUMNS)
    df.to_csv(f'data/sim/{name}.csv', index=False)

generate_scenario('single_approach', 1, 25.0, True, [(0.05, 0.05)], [(-0.0008, -0.0008)])
generate_scenario('fishing_cluster', 4, 3.0, False, [(0.01, 0.01), (0.012, 0.008), (0.008, 0.012), (0.01, 0.009)], [(0, 0), (0, 0), (0, 0), (0, 0)])
generate_scenario('coordinated_attack', 3, 30.0, True, [(0.04, 0.04), (-0.04, 0.04), (0.04, -0.04)], [(-0.0006, -0.0006), (0.0006, -0.0006), (-0.0006, 0.0006)])

print("تم توليد ملفات السيناريوهات بنجاح في data/sim/")