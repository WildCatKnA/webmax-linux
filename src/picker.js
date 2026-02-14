let allSources = [];
const searchInput = document.getElementById('search-input');
const list = document.getElementById('list');
const cancelBtn = document.getElementById('cancel-btn');

// отрисовка списка
function renderSources(sources) {
	list.innerHTML = '';
	sources.forEach(s => {
		const div = document.createElement('div');
		div.className = 'item';
		div.innerHTML = `
			<div class="thumbnail-wrapper"><img src="${s.thumbnail}"></div>
			<span>${s.name}</span>
		`;
		div.addEventListener('click', () => window.electronAPI.selectSource(s.id));
		list.appendChild(div);
	});
}

document.addEventListener('DOMContentLoaded', () => {

	// проверка наличия API
	if (!window.electronAPI) {
		console.error("Прелоад не загружен!");
		return;
	}

	// мы готовы
	window.electronAPI.sendReady();

	// список окон
/*	window.electronAPI.onShowSources((sources) => {
		list.innerHTML = '';
		sources.forEach(s => {
			const div = document.createElement('div');
			div.className = 'item';
			div.innerHTML = `
				<img src="${s.thumbnail}">
				<span>${s.name}</span>
			`;
			div.addEventListener('click', () => {
				window.electronAPI.selectSource(s.id);
			});
			list.appendChild(div);
		});
	});//*/
	// слушаем данные
	window.electronAPI.onShowSources((sources) => {
		allSources = sources;
		renderSources(allSources);
		searchInput.focus();
	});

	// обработка поиска
	searchInput.addEventListener('input', (e) => {
		const query = e.target.value.toLowerCase();
		const filtered = allSources.filter(s => s.name.toLowerCase().includes(query));
		renderSources(filtered);
	});

	// обработка отмены
	cancelBtn.addEventListener('click', () => {
		window.electronAPI.selectSource(null);
	});

	// клавиша Esc
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			window.electronAPI.selectSource(null);
		}
		// Enter - первый результат из поиска
		else if (e.key === 'Enter') {
			const firstItem = document.querySelector('.item');
			if (firstItem) {
				firstItem.click();
			}
		}
	});
});
