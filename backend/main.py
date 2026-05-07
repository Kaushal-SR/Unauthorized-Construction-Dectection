import sys
import os
import base64
from io import BytesIO
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import torch
import torch.nn.functional as F
import torchvision.transforms.functional as TF

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATASET_ROOT = PROJECT_ROOT / "LEVIR-CD+"

# Add ChangeFormer repo to sys.path so we can import its model definitions
CHANGEFORMER_DIR = BACKEND_DIR / "ChangeFormer"
if str(CHANGEFORMER_DIR) not in sys.path:
    sys.path.insert(0, str(CHANGEFORMER_DIR))

# ---------------------------------------------------------------------------
# ChangeFormer model import (deferred until sys.path is set)
# ---------------------------------------------------------------------------
from models.ChangeFormer import ChangeFormerV6  # noqa: E402

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Unauthorized Construction Change Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the LEVIR-CD+ images so the frontend can display them
if DATASET_ROOT.exists():
    app.mount("/dataset", StaticFiles(directory=str(DATASET_ROOT)), name="dataset")

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------
MODEL: Optional[torch.nn.Module] = None
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
IMG_SIZE = 256

# ---------------------------------------------------------------------------
# Checkpoint path — long nested folder from the official release
# ---------------------------------------------------------------------------
CKPT_DIR = (
    CHANGEFORMER_DIR
    / "checkpoints"
    / "ChangeFormer_LEVIR"
    / "CD_ChangeFormerV6_LEVIR_b16_lr0.0001_adamw_train_test_200_linear_ce_multi_train_True_multi_infer_False_shuffle_AB_False_embed_dim_256"
)
CKPT_FILE = CKPT_DIR / "best_ckpt.pt"


@app.on_event("startup")
async def load_model() -> None:
    global MODEL
    if not CKPT_FILE.exists():
        print(f"Checkpoint not found at {CKPT_FILE}; running without model.")
        return
    try:
        net = ChangeFormerV6(embed_dim=256, input_nc=3, output_nc=2, decoder_softmax=False)
        ckpt = torch.load(str(CKPT_FILE), map_location=DEVICE, weights_only=False)
        net.load_state_dict(ckpt["model_G_state_dict"])
        net.to(DEVICE)
        net.eval()
        MODEL = net
        print(f"ChangeFormerV6 loaded from {CKPT_FILE} on {DEVICE}")
    except Exception as exc:
        print(f"Failed to load model: {exc}")
        MODEL = None


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def _preprocess(img: Image.Image) -> torch.Tensor:
    """PIL Image -> (1, 3, 256, 256) tensor normalised to [-1, 1]."""
    img = img.convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)
    t = TF.to_tensor(img)  # (3,H,W) in [0,1]
    t = TF.normalize(t, mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
    return t.unsqueeze(0)  # (1,3,H,W)


def _mask_to_boxes(mask: np.ndarray) -> List[Dict[str, int]]:
    """Convert a binary mask to bounding boxes using connected-component-like
    contiguous region detection via simple label scan."""
    from scipy import ndimage

    labeled, n = ndimage.label(mask)
    boxes: List[Dict[str, int]] = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        area = len(xs)
        if area < 20:  # skip tiny noise spots
            continue
        boxes.append({
            "x": int(xs.min()),
            "y": int(ys.min()),
            "width": int(xs.max() - xs.min() + 1),
            "height": int(ys.max() - ys.min() + 1),
        })
    return boxes


def _mask_to_base64_png(mask: np.ndarray) -> str:
    """Encode a 0/255 uint8 mask as a base64 PNG for the frontend."""
    img = Image.fromarray(mask)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@torch.no_grad()
def _run_inference(old_img: Image.Image, new_img: Image.Image) -> Dict[str, Any]:
    """Run ChangeFormer inference on two PIL images and return results."""
    width, height = new_img.size

    if MODEL is None:
        return {
            "illegal": False,
            "reason": "Model not loaded.",
            "boxes": [],
            "mask_b64": "",
            "image_width": width,
            "image_height": height,
        }

    t1 = _preprocess(old_img).to(DEVICE)
    t2 = _preprocess(new_img).to(DEVICE)

    preds = MODEL(t1, t2)                  # list of multi-scale outputs
    logits = preds[-1]                      # (1, 2, H, W) — 2-class logits
    pred = torch.argmax(logits, dim=1)      # (1, H, W)  0 = no-change, 1 = change
    mask_256 = pred[0].cpu().numpy().astype(np.uint8)  # (256,256) 0/1

    # Resize mask back to original image size
    mask_full = np.array(
        Image.fromarray(mask_256 * 255).resize((width, height), Image.NEAREST)
    )
    mask_bin = (mask_full > 127).astype(np.uint8)

    boxes = _mask_to_boxes(mask_bin)
    illegal = len(boxes) > 0
    change_pct = float(mask_bin.sum()) / mask_bin.size * 100

    return {
        "illegal": illegal,
        "reason": (
            f"Detected structural change ({change_pct:.1f}% of area)."
            if illegal
            else "No significant change detected."
        ),
        "boxes": boxes,
        "mask_b64": _mask_to_base64_png(mask_full * 255 if mask_full.max() <= 1 else mask_full),
        "image_width": width,
        "image_height": height,
        "change_percent": round(change_pct, 2),
    }


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"status": "ok", "model_loaded": MODEL is not None, "device": str(DEVICE)}


@app.post("/detect-changes")
async def detect_changes(
    oldImage: UploadFile = File(...),
    newImage: UploadFile = File(...),
) -> Dict[str, Any]:
    """Accept two uploaded images, run change detection."""
    old_img = Image.open(BytesIO(await oldImage.read()))
    new_img = Image.open(BytesIO(await newImage.read()))
    return _run_inference(old_img, new_img)


# ---------- Dataset browsing endpoints ----------

@app.get("/api/dataset/list")
async def dataset_list(
    split: str = Query("test", pattern="^(train|test)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(12, ge=1, le=50),
) -> Dict[str, Any]:
    """List available image pairs from the LEVIR-CD+ dataset with pagination."""
    a_dir = DATASET_ROOT / split / "A"
    if not a_dir.exists():
        raise HTTPException(status_code=404, detail=f"Dataset split '{split}' not found")

    all_names = sorted(
        f for f in os.listdir(a_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    )

    total = len(all_names)
    start = (page - 1) * per_page
    end = start + per_page
    page_names = all_names[start:end]

    items = []
    for name in page_names:
        items.append({
            "name": name,
            "a_url": f"/dataset/{split}/A/{name}",
            "b_url": f"/dataset/{split}/B/{name}",
            "label_url": f"/dataset/{split}/label/{name}",
        })

    return {
        "split": split,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
        "items": items,
    }


@app.post("/api/detect-dataset-pair")
async def detect_dataset_pair(
    split: str = Form("test"),
    filename: str = Form(...),
) -> Dict[str, Any]:
    """Run change detection on a specific LEVIR-CD+ image pair."""
    # Validate filename to prevent path traversal
    safe_name = Path(filename).name
    a_path = DATASET_ROOT / split / "A" / safe_name
    b_path = DATASET_ROOT / split / "B" / safe_name

    if not a_path.exists() or not b_path.exists():
        raise HTTPException(status_code=404, detail="Image pair not found")

    old_img = Image.open(a_path)
    new_img = Image.open(b_path)
    result = _run_inference(old_img, new_img)
    result["a_url"] = f"/dataset/{split}/A/{safe_name}"
    result["b_url"] = f"/dataset/{split}/B/{safe_name}"
    result["label_url"] = f"/dataset/{split}/label/{safe_name}"
    result["filename"] = safe_name
    return result
