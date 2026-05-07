// main.js — Unauthorized Construction Detection frontend
const API = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', function () {

    // ==== Upload form ====
    const form = document.getElementById('imageUploadForm');
    const resultDiv = document.getElementById('result');
    const uploadVisual = document.getElementById('uploadVisual');

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const oldFile = document.getElementById('oldImage').files[0];
            const newFile = document.getElementById('newImage').files[0];
            if (!oldFile || !newFile) {
                resultDiv.textContent = 'Please select both images.';
                return;
            }
            resultDiv.textContent = 'Analyzing images...';
            uploadVisual.style.display = 'none';

            const fd = new FormData();
            fd.append('oldImage', oldFile);
            fd.append('newImage', newFile);

            fetch(API + '/detect-changes', { method: 'POST', body: fd })
                .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
                .then(data => {
                    showResult(resultDiv, data);
                    showVisual(uploadVisual,
                        URL.createObjectURL(oldFile),
                        URL.createObjectURL(newFile),
                        data);
                })
                .catch(err => {
                    console.error(err);
                    resultDiv.textContent = 'Error contacting backend. Is the server running?';
                });
        });
    }

    // ==== Dataset browser ====
    let currentPage = 1;
    const splitSel = document.getElementById('splitSelect');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    const grid = document.getElementById('datasetGrid');
    const dsResult = document.getElementById('datasetResult');
    const dsVisual = document.getElementById('datasetVisual');

    function loadPage() {
        const split = splitSel.value;
        grid.innerHTML = '<p>Loading...</p>';
        dsResult.textContent = '';
        dsVisual.style.display = 'none';

        fetch(API + '/api/dataset/list?split=' + split + '&page=' + currentPage + '&per_page=12')
            .then(r => r.json())
            .then(data => {
                pageInfo.textContent = 'Page ' + data.page + ' / ' + data.total_pages;
                prevBtn.disabled = data.page <= 1;
                nextBtn.disabled = data.page >= data.total_pages;
                renderGrid(data.items, data.split);
            })
            .catch(() => { grid.innerHTML = '<p>Could not load dataset. Is the backend running?</p>'; });
    }

    function renderGrid(items, split) {
        grid.innerHTML = '';
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'ds-card';
            card.innerHTML =
                '<div class="ds-imgs">' +
                '  <img src="' + API + item.a_url + '" alt="A" title="Before">' +
                '  <img src="' + API + item.b_url + '" alt="B" title="After">' +
                '</div>' +
                '<div class="ds-name">' + item.name + '</div>' +
                '<button class="ds-detect-btn">Detect Changes</button>';

            card.querySelector('.ds-detect-btn').addEventListener('click', function () {
                runDatasetDetection(split, item);
            });
            grid.appendChild(card);
        });
    }

    function runDatasetDetection(split, item) {
        dsResult.textContent = 'Running detection on ' + item.name + '...';
        dsVisual.style.display = 'none';

        const fd = new FormData();
        fd.append('split', split);
        fd.append('filename', item.name);

        fetch(API + '/api/detect-dataset-pair', { method: 'POST', body: fd })
            .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(data => {
                showResult(dsResult, data);
                showVisual(dsVisual,
                    API + item.a_url,
                    API + item.b_url,
                    data);
            })
            .catch(err => {
                console.error(err);
                dsResult.textContent = 'Error running detection.';
            });
    }

    if (splitSel) {
        splitSel.addEventListener('change', function () { currentPage = 1; loadPage(); });
        prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; loadPage(); } });
        nextBtn.addEventListener('click', function () { currentPage++; loadPage(); });
        loadPage();
    }

    // ==== Shared helpers ====
    function showResult(el, data) {
        const boxes = Array.isArray(data.boxes) ? data.boxes : [];
        const pct = data.change_percent != null ? data.change_percent : '?';
        if (data.illegal) {
            el.innerHTML = '<span style="color:#c0392b;font-weight:600;">&#9888; Change detected</span> — ' +
                data.reason + ' (' + boxes.length + ' region(s), ' + pct + '% change)';
        } else {
            el.innerHTML = '<span style="color:#27ae60;font-weight:600;">&#10003; No significant change.</span> ' + data.reason;
        }
    }

    function showVisual(container, aUrl, bUrl, data) {
        container.style.display = 'grid';
        container.innerHTML = '';

        // Before
        const colA = document.createElement('div');
        colA.className = 'vis-col';
        colA.innerHTML = '<h4>Before (A)</h4><img src="' + aUrl + '">';
        const imgA = colA.querySelector('img');
        if (imgA) enableZoom(imgA, 'Before (A)');
        container.appendChild(colA);

        // After + boxes
        const colB = document.createElement('div');
        colB.className = 'vis-col';
        colB.innerHTML = '<h4>After (B)</h4>';
        const wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.display = 'inline-block';

        const imgB = new Image();
        imgB.src = bUrl;
        imgB.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = imgB.naturalWidth;
            canvas.height = imgB.naturalHeight;
            canvas.style.maxWidth = '100%';
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgB, 0, 0);

            // Draw mask overlay if available
            if (data.mask_b64) {
                const maskImg = new Image();
                maskImg.onload = function () {
                    ctx.globalAlpha = 0.35;
                    ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
                    ctx.globalAlpha = 1.0;
                    drawBoxes(ctx, data, canvas.width, canvas.height);
                };
                maskImg.src = 'data:image/png;base64,' + data.mask_b64;
            } else {
                drawBoxes(ctx, data, canvas.width, canvas.height);
            }

            wrap.appendChild(canvas);
            enableZoom(canvas, 'After (B)');
        };
        colB.appendChild(wrap);
        container.appendChild(colB);

        // Ground-truth label if from dataset
        if (data.label_url) {
            const colL = document.createElement('div');
            colL.className = 'vis-col';
            colL.innerHTML = '<h4>Ground Truth</h4><img src="' + API + data.label_url + '">';
            const imgL = colL.querySelector('img');
            if (imgL) enableZoom(imgL, 'Ground Truth');
            container.appendChild(colL);
        }
    }

    function drawBoxes(ctx, data, cw, ch) {
        const iw = data.image_width || cw;
        const ih = data.image_height || ch;
        const sx = cw / iw;
        const sy = ch / ih;
        const boxes = data.boxes || [];
        ctx.lineWidth = 2;
        ctx.strokeStyle = data.illegal ? '#e74c3c' : '#27ae60';
        ctx.font = '13px Arial';
        boxes.forEach(function (b, i) {
            const x = (b.x || 0) * sx, y = (b.y || 0) * sy;
            const w = (b.width || 0) * sx, h = (b.height || 0) * sy;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(231,76,60,0.15)';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#e74c3c';
            ctx.fillText('Change ' + (i + 1), x + 3, y + 14);
        });
    }

    // Enable click-to-zoom on images/canvases
    function enableZoom(el, title) {
        if (!el) return;
        el.classList.add('zoomable-image');
        el.addEventListener('click', function () {
            openImageModal(el, title || '');
        });
    }

    function openImageModal(sourceEl, title) {
        const overlay = document.createElement('div');
        overlay.className = 'img-modal-overlay';

        const content = document.createElement('div');
        content.className = 'img-modal-content';
        let zoomEl;
        if (sourceEl.tagName === 'CANVAS') {
            // Clone the canvas to preserve boxes/mask and scale it
            // so the full image fits within the current viewport.
            const clone = document.createElement('canvas');
            clone.width = sourceEl.width;
            clone.height = sourceEl.height;
            const ctx = clone.getContext('2d');
            if (ctx) {
                ctx.drawImage(sourceEl, 0, 0);
            }

            const maxW = window.innerWidth * 0.9;
            const maxH = window.innerHeight * 0.9;
            const scale = Math.min(maxW / sourceEl.width, maxH / sourceEl.height, 1);
            clone.style.width = (sourceEl.width * scale) + 'px';
            clone.style.height = (sourceEl.height * scale) + 'px';

            zoomEl = clone;
        } else if (sourceEl.tagName === 'IMG') {
            // Clone the image and scale based on its natural size
            const imgClone = sourceEl.cloneNode(true);
            if (imgClone.removeAttribute) {
                imgClone.removeAttribute('width');
                imgClone.removeAttribute('height');
            }

            const iw = sourceEl.naturalWidth || sourceEl.width || imgClone.width || 1;
            const ih = sourceEl.naturalHeight || sourceEl.height || imgClone.height || 1;
            const maxW = window.innerWidth * 0.9;
            const maxH = window.innerHeight * 0.9;
            const scale = Math.min(maxW / iw, maxH / ih, 1);
            imgClone.style.width = (iw * scale) + 'px';
            imgClone.style.height = (ih * scale) + 'px';

            zoomEl = imgClone;
        } else {
            zoomEl = sourceEl.cloneNode(true);
        }

        if (title && zoomEl && zoomEl.tagName === 'IMG') {
            zoomEl.alt = title;
            zoomEl.title = title;
        }

        content.appendChild(zoomEl);
        overlay.appendChild(content);

        overlay.addEventListener('click', function () {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });

        document.body.appendChild(overlay);
    }

    console.log('Unauthorized Construction Monitoring — loaded');
});
