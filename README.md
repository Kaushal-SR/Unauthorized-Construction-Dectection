# Unauthorized-Construction-Detection

FastAPI + ChangeFormer-based change-detection backend with a simple static frontend.

This repo is structured so you can:
- Upload two images (before/after) and get a change mask + bounding boxes.
- (Optional) Browse/run inference on image pairs from a local `LEVIR-CD+` dataset folder.

## Project structure

```
.
├─ backend/
│  ├─ main.py                 # FastAPI app (loads ChangeFormer checkpoint on startup)
│  ├─ requirements.txt        # Python deps for the API
│  └─ ChangeFormer/           # ChangeFormer source code (MIT, upstream project)
└─ public/
	 ├─ index.html
	 ├─ about.html
	 ├─ main.js
	 └─ style.css
```

## Prerequisites

- Python 3.9+ (3.10/3.11 recommended)
- (Optional) NVIDIA GPU + CUDA-enabled PyTorch for faster inference

## Setup (Windows)

From the repo root:

1) Create and activate a virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2) Install backend dependencies

```powershell
pip install -r backend\requirements.txt
```

## Model checkpoint (required for real inference)

The backend expects a ChangeFormerV6 checkpoint at:

```
backend/ChangeFormer/checkpoints/ChangeFormer_LEVIR/
	CD_ChangeFormerV6_LEVIR_b16_lr0.0001_adamw_train_test_200_linear_ce_multi_train_True_multi_infer_False_shuffle_AB_False_embed_dim_256/
		best_ckpt.pt
```

This repo does NOT include the checkpoint (it is large). You need to download it from the official ChangeFormer release and place it into the path above.

If the checkpoint is missing, the API still runs but returns `"Model not loaded."`.

## Dataset folder (optional)

`backend/main.py` will serve a local dataset folder named `LEVIR-CD+` from the repo root (if it exists):

```
LEVIR-CD+/
	train/
		A/   B/   label/
	test/
		A/   B/   label/
```

### Download link

Download the dataset from Google Drive:

- https://drive.google.com/drive/folders/1lJ5GteQy5Z2LVayrKYZOn7_QPImlYP8C

### Where to paste it (important)

After downloading/extracting, you must end up with this exact path on disk:

```
<repo-root>/LEVIR-CD+/
```

That is: `LEVIR-CD+` must be a **top-level folder next to** `backend/` and `public/`.

Example:

```
.
├─ LEVIR-CD+/
├─ backend/
└─ public/
```

If your download extracts into a different name (for example `LEVIR-CD+ (1)` or nested folders like `LEVIR-CD+/LEVIR-CD+/...`), rename/move it so the final layout matches the structure shown above.

### What uses this folder

- `backend/main.py` checks for `<repo-root>/LEVIR-CD+` on startup.
- If it exists, the backend serves it at `GET /dataset/...`.
- The dataset endpoints `GET /api/dataset/list` and `POST /api/detect-dataset-pair` read files from this folder.

If you don’t have this folder, dataset browsing endpoints will return 404, but the upload-based endpoint still works.

## Run

### 1) Start the backend API

From the repo root:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Health check:

- http://localhost:8000/health

### 2) Open the frontend

This is a static frontend. You can open it directly:

- Open `public/index.html` in your browser

If your browser blocks requests due to CORS or `file://` restrictions, serve the `public/` folder with any simple static server (for example, VS Code Live Server).

## API endpoints

- `GET /health` — returns API status and whether the model loaded
- `POST /detect-changes` — multipart upload with fields `oldImage` and `newImage`
- `GET /api/dataset/list?split=test&page=1&per_page=12` — lists dataset image names (requires `LEVIR-CD+` folder)
- `POST /api/detect-dataset-pair` — form fields `split` and `filename` (requires `LEVIR-CD+` folder)

## Notes / troubleshooting

- If `/health` shows `model_loaded=false`, confirm the `best_ckpt.pt` path matches exactly.
- CPU inference works but can be slow.
- This repo includes ChangeFormer source code under [backend/ChangeFormer](backend/ChangeFormer) and its MIT license.