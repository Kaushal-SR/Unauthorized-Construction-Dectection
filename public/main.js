// main.js
// Handles image upload form and placeholder model run

document.addEventListener('DOMContentLoaded', function() {
	const form = document.getElementById('imageUploadForm');
	const resultDiv = document.getElementById('result');

	if (form) {
		form.addEventListener('submit', function(e) {
			e.preventDefault();
			const oldImage = document.getElementById('oldImage').files[0];
			const newImage = document.getElementById('newImage').files[0];

			if (!oldImage || !newImage) {
				resultDiv.textContent = 'Please select both images.';
				return;
			}

			// Placeholder: Simulate model run
			resultDiv.textContent = 'Analyzing images for changes...';
			setTimeout(() => {
				resultDiv.textContent = 'Change detection complete. (This is a placeholder. Model integration coming soon.)';
			}, 2000);
		});
	}

	// Dataset selection logic
	const datasetForm = document.getElementById('datasetForm');
	const datasetResultDiv = document.getElementById('datasetResult');
	if (datasetForm) {
		datasetForm.addEventListener('submit', function(e) {
			e.preventDefault();
			const dataset = document.getElementById('datasetSelect').value;
			if (!dataset) {
				datasetResultDiv.textContent = 'Please select a dataset.';
				return;
			}
			datasetResultDiv.textContent = 'Analyzing pre-added dataset...';
			setTimeout(() => {
				datasetResultDiv.textContent = `Change detection complete for ${dataset.replace('set', 'Sample Area ')}. (This is a placeholder. Model integration coming soon.)`;
			}, 2000);
		});
	}

	console.log('Site loaded: Online Monitoring of Unauthorized Construction');
});
