"""
Measure how well a detector finds BOATS in real drone footage (SeaDronesSee validation images).

Compares, on exactly the same images and with exactly the same rules:
  - the maritime model  dronefreak/seadronessee-yolov8s  (class "boat")
  - the general model   yolov8n.pt (COCO)                 (class "boat")

Run:
  python evaluate_vision.py --images sds/data/images/val/shard_000 --labels sds/data/labels/val/shard_000
Output:
  vision_eval.json  (precision, recall, F1, AP50 per model) + a printed table

A prediction counts as correct when it overlaps a labelled boat with IoU >= 0.5
(the standard "mAP@50" rule). Precision/recall/F1 are reported at confidence 0.25,
the same threshold vision.py uses.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from ultralytics import YOLO

IOU = 0.5
CONF_REPORT = 0.25


def iou(box, boxes):
    x1 = np.maximum(box[0], boxes[:, 0]); y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2]); y2 = np.minimum(box[3], boxes[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    a = (box[2] - box[0]) * (box[3] - box[1])
    b = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return inter / (a + b - inter + 1e-9)


def load_gt(label_file, w, h, cls_id):
    out = []
    if label_file.exists():
        for line in label_file.read_text().split("\n"):
            parts = line.split()
            if len(parts) == 5 and int(parts[0]) == cls_id:
                cx, cy, bw, bh = (float(v) for v in parts[1:])
                out.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
    return np.array(out).reshape(-1, 4)


def average_precision(scores, matched, n_gt):
    if n_gt == 0 or len(scores) == 0:
        return 0.0
    order = np.argsort(-scores)
    tp = np.cumsum(matched[order])
    fp = np.cumsum(~matched[order])
    recall = tp / n_gt
    precision = tp / (tp + fp)
    # all-point interpolation (same idea as COCO / Ultralytics)
    mrec = np.concatenate([[0], recall, [1]])
    mpre = np.concatenate([[1], precision, [0]])
    mpre = np.flip(np.maximum.accumulate(np.flip(mpre)))
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def evaluate(model_path, boat_class, images, labels_dir, imgsz):
    model = YOLO(model_path)
    scores, matched, n_gt = [], [], 0
    tp_r = fp_r = 0
    for img in images:
        r = model.predict(str(img), imgsz=imgsz, conf=0.001, iou=0.6, verbose=False)[0]
        h, w = r.orig_shape
        gt = load_gt(labels_dir / (img.stem + ".txt"), w, h, 1)  # SeaDronesSee: 1 = boat
        n_gt += len(gt)
        keep = r.boxes.cls.cpu().numpy().astype(int) == boat_class
        boxes = r.boxes.xyxy.cpu().numpy()[keep]
        conf = r.boxes.conf.cpu().numpy()[keep]
        used = np.zeros(len(gt), bool)
        for i in np.argsort(-conf):
            hit = False
            if len(gt):
                ious = iou(boxes[i], gt)
                ious[used] = 0
                j = int(np.argmax(ious))
                if ious[j] >= IOU:
                    used[j] = hit = True
            scores.append(conf[i]); matched.append(hit)
            if conf[i] >= CONF_REPORT:
                tp_r += hit; fp_r += not hit
    scores, matched = np.array(scores), np.array(matched, bool)
    fn_r = n_gt - tp_r
    p = tp_r / max(tp_r + fp_r, 1)
    rc = tp_r / max(n_gt, 1)
    return {
        "images": len(images), "labelled_boats": int(n_gt),
        "precision": round(p, 3), "recall": round(rc, 3),
        "f1": round(2 * p * rc / max(p + rc, 1e-9), 3),
        "ap50": round(average_precision(scores, matched, n_gt), 3),
        "true_positives": int(tp_r), "false_positives": int(fp_r), "missed": int(fn_r),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--maritime", default="models/seadronessee-yolov8s.pt")
    ap.add_argument("--generic", default="models/yolov8n.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--out", default="vision_eval.json")
    a = ap.parse_args()

    images = sorted(Path(a.images).glob("*.jpg"))
    labels = Path(a.labels)
    results = {
        "dataset": f"SeaDronesSee val (random sample of {len(images)} images)",
        "class": "boat", "iou": IOU, "conf": CONF_REPORT, "imgsz": a.imgsz,
        "maritime_yolov8s": evaluate(a.maritime, 1, images, labels, a.imgsz),   # 1 = boat
        "generic_yolov8n": evaluate(a.generic, 8, images, labels, a.imgsz),     # COCO 8 = boat
    }
    Path(a.out).write_text(json.dumps(results, indent=2, ensure_ascii=False))

    print(f"\n{'':22}{'precision':>10}{'recall':>9}{'F1':>7}{'AP50':>7}{'missed':>8}{'false':>7}")
    for name in ("maritime_yolov8s", "generic_yolov8n"):
        r = results[name]
        print(f"{name:22}{r['precision']:>10}{r['recall']:>9}{r['f1']:>7}{r['ap50']:>7}{r['missed']:>8}{r['false_positives']:>7}")
    print(f"\nlabelled boats: {results['maritime_yolov8s']['labelled_boats']} in {len(images)} images -> {a.out}")
