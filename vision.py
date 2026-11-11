
import cv2
import json
import os
import argparse
from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument("--input", default="drone_video.mp4")
parser.add_argument("--output", default="assets/drone_detect.mp4")
parser.add_argument("--summary", default="vision_summary.json")
args = parser.parse_args()

os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

model = YOLO("yolov8n.pt")

boat_ids = [
k for k, v in model.names.items()
if v.lower() == "boat"
]

cap = cv2.VideoCapture(args.input)

if not cap.isOpened():
 raise FileNotFoundError(f"Cannot open video: {args.input}")

fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

writer = cv2.VideoWriter(
args.output,
cv2.VideoWriter_fourcc(*"mp4v"),
fps,
(width, height)
)

unique_ids = set()
confidences = []
boat_detections = 0
frames_with_boats = 0
frame_count = 0

for i in range(total_frames):
 ret, frame = cap.read()

 if not ret:
    break

results = model.track(
    source=frame,
    persist=True,
    tracker="bytetrack.yaml",
    conf=0.25,
    verbose=False
)

result = results[0]
writer.write(result.plot())
frame_count += 1

found_boat = False

if result.boxes is not None:
     for box in result.boxes:
        if int(box.cls[0]) in boat_ids:
            found_boat = True
            boat_detections += 1
            confidences.append(float(box.conf[0]))

            if box.id is not None:
                unique_ids.add(int(box.id[0]))

if found_boat:
    frames_with_boats += 1

if (i + 1) % 100 == 0:
    print("Processed:", i + 1, "/", total_frames)

cap.release()
writer.release()

summary = {
 "model": "YOLOv8n",
 "detected_class": "boat",
 "frames_processed": frame_count,
 "boat_detections_across_frames": boat_detections,
 "frames_with_boats": frames_with_boats,
 "unique_tracked_boats": len(unique_ids),
 "average_confidence": (
   sum(confidences) / len(confidences)
   if confidences else 0
  )
}

with open(args.summary, "w") as f:
 json.dump(summary, f, indent=4)

print("Detection completed!")
print(json.dumps(summary, indent=4))
