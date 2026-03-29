import json
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import random
import scipy.ndimage as nd
from PIL import Image
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler
import os
from collections import defaultdict

IMG_SIZE = 28
CLASSES = "0123456789+-=/xy()"
class_to_idx = {c: i for i, c in enumerate(CLASSES)}
idx_to_class = {i: c for c, i in class_to_idx.items()}

VAL_SPLIT = 0.15
BATCH_SIZE = 32
EPOCHS = 200
LR = 1e-3
PATIENCE = 20


def augment(img):
    dx, dy = random.randint(-2, 2), random.randint(-2, 2)
    img = nd.shift(img, (dy, dx), mode='nearest')
    angle = random.uniform(-15, 15)
    img = nd.rotate(img, angle, reshape=False)
    img += np.random.normal(0, 0.05, img.shape)
    return np.clip(img, 0, 1)


def draw_line(canvas, x1, y1, x2, y2):
    x1, y1, x2, y2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx - dy
    while True:
        if 0 <= x1 < IMG_SIZE and 0 <= y1 < IMG_SIZE:
            canvas[y1, x1] = 1.0
        if x1 == x2 and y1 == y2:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x1 += sx
        if e2 < dx:
            err += dx
            y1 += sy


def rasterize(sample):
    canvas = np.zeros((IMG_SIZE, IMG_SIZE), dtype=np.float32)
    all_points = []
    for shape_segments in sample["strokes"]:
        for segment in shape_segments:
            for p in segment:
                all_points.append(p)

    if len(all_points) == 0:
        return canvas

    xs = [p["x"] for p in all_points]
    ys = [p["y"] for p in all_points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    bbox_w = max_x - min_x or 1
    bbox_h = max_y - min_y or 1

    pad = 2
    scale = min((IMG_SIZE - pad * 2) / bbox_w, (IMG_SIZE - pad * 2) / bbox_h)
    offset_x = pad + (IMG_SIZE - pad * 2 - bbox_w * scale) / 2
    offset_y = pad + (IMG_SIZE - pad * 2 - bbox_h * scale) / 2

    def to_canvas(p):
        return (p["x"] - min_x) * scale + offset_x, (p["y"] - min_y) * scale + offset_y

    for shape_segments in sample["strokes"]:
        for segment in shape_segments:
            if len(segment) == 0:
                continue
            cx, cy = to_canvas(segment[0])
            for i in range(1, len(segment)):
                nx, ny = to_canvas(segment[i])
                draw_line(canvas, cx, cy, nx, ny)
                cx, cy = nx, ny

    return canvas


def save_debug_image(canvas, label, idx):
    safe_label = 'div' if label == '/' else label
    os.makedirs("debug_imgs", exist_ok=True)
    img = Image.fromarray((canvas * 255).astype(np.uint8), mode='L')
    img.save(f"debug_imgs/{idx}_{safe_label}.png")


def load_data(path, save_debug=False):
    with open(path) as f:
        data = json.load(f)
    X, y = [], []
    for i, s in enumerate(data):
        if s["label"] not in class_to_idx:
            continue
        canvas = rasterize(s)
        if save_debug:
            save_debug_image(canvas, s["label"], i)
        X.append(canvas)
        y.append(class_to_idx[s["label"]])
    X = torch.tensor(np.array(X)[:, None, :, :])
    y = torch.tensor(np.array(y))
    return X, y


def stratified_split(X, y, val_fraction, seed=42):
    """
    Split into train/val such that:
    - Every class present in the dataset appears in both splits
    - Each split has proportional class representation
    - At least 1 sample per class goes to val (if class has >= 2 samples)
    """
    rng = random.Random(seed)
    # Group indices by class
    class_indices = defaultdict(list)
    for idx, label in enumerate(y.tolist()):
        class_indices[label].append(idx)

    train_idx, val_idx = [], []
    for label, indices in class_indices.items():
        rng.shuffle(indices)
        if len(indices) == 1:
            # Only one sample — goes to train, can't put in val
            print(f"  Warning: class '{idx_to_class[label]}' has only 1 sample, skipping val")
            train_idx.extend(indices)
        else:
            # At least 1 in val, rest proportional
            n_val = max(1, round(len(indices) * val_fraction))
            val_idx.extend(indices[:n_val])
            train_idx.extend(indices[n_val:])

    return train_idx, val_idx


def make_weighted_sampler(y_train):
    """
    WeightedRandomSampler so every class is sampled equally during training,
    compensating for class imbalance without discarding any samples.
    """
    class_counts = torch.bincount(y_train)
    # Weight per sample = 1 / count of its class
    weights = 1.0 / class_counts[y_train].float()
    return WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)


class CNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(1, 16, 3),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Flatten(),
            nn.Linear(32 * 5 * 5, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, len(CLASSES))
        )

    def forward(self, x):
        return self.net(x)


def per_class_accuracy(preds, labels):
    correct = defaultdict(int)
    total = defaultdict(int)
    for p, l in zip(preds, labels):
        cls = idx_to_class[l]
        total[cls] += 1
        if p == l:
            correct[cls] += 1
    return {cls: correct[cls] / total[cls] for cls in total}


if __name__ == "__main__":
    X, y = load_data("../data-capture/public/dataset.json", save_debug=True)

    print(f"\nDataset: {len(y)} samples across {len(y.unique())} classes")
    print("Class distribution:")
    for i, count in enumerate(torch.bincount(y)):
        if count > 0:
            bar = '█' * int(count)
            print(f"  {idx_to_class[i]}  {bar} {count.item()}")

    print(f"\nSplitting with stratification (val={VAL_SPLIT:.0%})...")
    train_idx, val_idx = stratified_split(X, y, VAL_SPLIT)

    X_train, y_train = X[train_idx], y[train_idx]
    X_val,   y_val   = X[val_idx],   y[val_idx]

    print(f"Train: {len(train_idx)} samples, Val: {len(val_idx)} samples")
    print(f"Val classes present: {len(y_val.unique())}/{len(y.unique())}\n")

    sampler = make_weighted_sampler(y_train)
    train_loader = DataLoader(
        TensorDataset(X_train, y_train),
        batch_size=BATCH_SIZE,
        sampler=sampler        # replaces shuffle=True, ensures balanced batches
    )
    val_loader = DataLoader(
        TensorDataset(X_val, y_val),
        batch_size=BATCH_SIZE
    )

    model = CNN()
    opt = optim.Adam(model.parameters(), lr=LR)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(opt, patience=10, factor=0.5)
    loss_fn = nn.CrossEntropyLoss()

    best_val_loss = float('inf')
    best_state = None
    patience_counter = 0

    for epoch in range(EPOCHS):
        # Training
        model.train()
        train_loss, train_correct = 0.0, 0
        for X_batch, y_batch in train_loader:
            X_aug = torch.tensor(
                np.array([augment(x[0].numpy()) for x in X_batch])
            ).unsqueeze(1)
            opt.zero_grad()
            out = model(X_aug)
            loss = loss_fn(out, y_batch)
            loss.backward()
            opt.step()
            train_loss += loss.item() * len(y_batch)
            train_correct += (out.argmax(1) == y_batch).sum().item()

        train_loss /= len(train_idx)
        train_acc = train_correct / len(train_idx)

        # Validation
        model.eval()
        val_loss, val_correct = 0.0, 0
        all_preds, all_labels = [], []
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                out = model(X_batch)
                val_loss += loss_fn(out, y_batch).item() * len(y_batch)
                preds = out.argmax(1)
                val_correct += (preds == y_batch).sum().item()
                all_preds.extend(preds.tolist())
                all_labels.extend(y_batch.tolist())

        val_loss /= len(val_idx)
        val_acc = val_correct / len(val_idx)
        scheduler.step(val_loss)

        is_best = val_loss < best_val_loss
        print(
            f"epoch {epoch:03d}  "
            f"train loss={train_loss:.4f} acc={train_acc:.3f}  "
            f"val loss={val_loss:.4f} acc={val_acc:.3f}"
            + (" ✓" if is_best else "")
        )

        if is_best:
            best_val_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"\nEarly stopping at epoch {epoch}")
                break

    model.load_state_dict(best_state)

    # Final per-class accuracy report
    model.eval()
    all_preds, all_labels = [], []
    with torch.no_grad():
        for X_batch, y_batch in val_loader:
            all_preds.extend(model(X_batch).argmax(1).tolist())
            all_labels.extend(y_batch.tolist())

    print("\nPer-class validation accuracy:")
    class_acc = per_class_accuracy(all_preds, all_labels)
    for cls, acc in sorted(class_acc.items(), key=lambda x: x[1]):
        bar = '█' * int(acc * 20)
        print(f"  {cls}  {bar:<20} {acc:.1%}")

    os.makedirs("../models", exist_ok=True)
    torch.save(model.state_dict(), "../models/model.pt")
    print("\nSaved best model to ../models/model.pt")