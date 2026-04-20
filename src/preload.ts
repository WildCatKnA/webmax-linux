import { contextBridge, ipcRenderer, webFrame } from "electron";
const api = {};
const { dialog } = require('electron');

//const originalSetSinkId = HTMLAudioElement.prototype.setSinkId;
///////////////////////////////////////////


function overrideNotification() {
	window.Notification = class extends Notification {
		constructor(title: string, options: NotificationOptions) {
			super(title, options);
			this.onclick = _event => ipcRenderer.send("notification-click");
		}
	}
}


//////////////////////////////////////////////////////
// попытка остановить автовоспроизведение видео в MAX.
// вроде бы  сработало =) внедрим  скриптик, который
// будет выполняться внутри "мира" страницы
// вариант 1 - срабатывает до первого клика по Play
// (после этого все видео начинают играть)
/*const scriptToInject = `
(function() {
	const originalPlay = HTMLMediaElement.prototype.play;

	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value: function() {
			// разрешаем аудиосообщения
			if (this.tagName === 'AUDIO') {
				return originalPlay.apply(this, arguments);
			}

			// разрешаем видео только по клику Play
			if (this.dataset.userActivated === 'true') {
				return originalPlay.apply(this, arguments);
			}

			// console.log('--- AUTOPLAY BLOCKED BY INJECTION ---');
			return Promise.reject('Manual play required');
		}
	});

	document.addEventListener('mousedown', () => {
		document.querySelectorAll('video').forEach(v => {
			v.dataset.userActivated = 'true';
		});
	}, { capture: true, passive: true });
})();
`; //*/
/*const scriptToInject = `
(function() {
	const originalPlay = HTMLMediaElement.prototype.play;
	const originalPause = HTMLMediaElement.prototype.pause;
	let isUserInteracting = false;
	let interactionTimeout = null;

	// для временной разблокировки
	function setInteraction() {
		isUserInteracting = true;
		if (interactionTimeout) clearTimeout(interactionTimeout);
		interactionTimeout = setTimeout(() => { isUserInteracting = false; }, 500); // 500мс - надежное окно
	}

	// слушаем клики и нажатия клавиш (пробел для Play)
	['mousedown', 'keydown', 'touchstart'].forEach(type => {
		document.addEventListener(type, (e) => {
			if (e.isTrusted) setInteraction();
		}, { capture: true, passive: true });
	});

	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value: function() {
			if (this.tagName === 'AUDIO') return originalPlay.apply(this, arguments);

			if (isUserInteracting) {
				// Если юзер реально кликнул - разрешаем и сбрасываем флаг
				isUserInteracting = false;
				return originalPlay.apply(this, arguments);
			}

			// ЕСЛИ ЭТО АВТОПЛЕЙ (скролл):
			// 1. Останавливаем видео физически
			originalPause.apply(this); 
			// 2. Убираем атрибут autoplay, чтобы Chromium не пытался снова
			this.removeAttribute('autoplay');
			this.autoplay = false;
			
			// console.log('--- BLOCKING BACKGROUND PLAY ---');
			
			// возвращаем заваленный промис, чтобы интерфейс чата ПОНЯЛ, 
			// что видео НЕ заиграло и вернул кнопку в статус "Play"
			return Promise.reject(new DOMException('Play interrupted by user script', 'NotAllowedError'));
		}
	});

	// чистим новые элементы при скролле
	const obs = new MutationObserver((ms) => {
		ms.forEach(m => m.addedNodes.forEach(n => {
			const vids = n.tagName === 'VIDEO' ? [n] : (n.querySelectorAll ? n.querySelectorAll('video') : []);
			vids.forEach(v => {
				v.removeAttribute('autoplay');
				v.preload = 'metadata';
			});
		}));
	});
	obs.observe(document.body, { childList: true, subtree: true });
})();
`;//*/
///////////
// вариант 2 - не играют все видео, но есть один нюанс
// (если видео в последнем сообщении чата - оно играет)

/**/
const scriptToInject = `
(function() {
	const originalPlay = HTMLMediaElement.prototype.play;
	let lastInteraction = 0;

	document.addEventListener('mousedown', (e) => { 
		if (e.isTrusted) lastInteraction = Date.now(); 
	}, true);

	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value: function() {
			if (this.tagName === 'AUDIO') return originalPlay.apply(this, arguments);

			const isManual = (Date.now() - lastInteraction) < 1000;
			if (isManual) {
				this.dataset.manuallyStarted = 'true';
				return originalPlay.apply(this, arguments);
			}

			// БЛОКИРОВКА: сначала разрешаем "мнимый" запуск, чтобы не было ошибок
			// но тут же планируем паузу в следующем цикле событий
			const video = this;
			video.removeAttribute('autoplay');
			
			Promise.resolve().then(() => {
				video.pause();
				// генерируем событие паузы вручную, если чат его пропустил
				video.dispatchEvent(new Event('pause'));
			});

			return Promise.resolve();
		}
	});

	// дополнительный предохранитель для кнопок
	document.addEventListener('play', (e) => {
		const v = e.target;
		if (v.tagName === 'VIDEO' && v.dataset.manuallyStarted !== 'true') {
			// используем setTimeout, чтобы дать скриптам чата "почувствовать" паузу
			setTimeout(() => {
				v.pause();
				v.dispatchEvent(new Event('pause'));
			}, 10);
		}
	}, true);

	// удаление автоплея у новых элементов
	new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
		const vids = n.tagName === 'VIDEO' ? [n] : (n.querySelectorAll ? n.querySelectorAll('video') : []);
		vids.forEach(v => { v.removeAttribute('autoplay'); v.preload = 'metadata'; });
	}))).observe(document.body, { childList: true, subtree: true });
})();
`;
//*/

///////////////////////////////////////////////////////
// вариант 3 - не стабильный
/*
const scriptToInject = `
(function() {
	const originalPlay = HTMLMediaElement.prototype.play;
	let lastInteraction = 0;

	document.addEventListener('mousedown', (e) => { 
		if (e.isTrusted) lastInteraction = Date.now(); 
	}, true);

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
	configurable: true,
	value: function() {
		if (this.tagName === 'AUDIO') return originalPlay.apply(this, arguments);

		const video = this;
		const now = Date.now();
		// кратковременное "окно доверия" для клика (1 сек)
		const isManual = (now - lastInteraction) < 1000;

		// 1. проверяем признаки просмотрщика или диалога (включая FullScreen)
		const isPlayer = video.closest('dialog') || 
						 video.closest('.mover') || 
						 video.closest('.videoLayer') ||
						 video.closest('[role="region"]') ||
						 document.fullscreenElement || 
						 document.webkitFullscreenElement;

		// РАЗРЕШАЕМ: если это плеер/диалог ИЛИ был свежий клик
		if (isPlayer) {
			video.dataset.manuallyStarted = 'true';
			return originalPlay.apply(this, arguments);
		}

		if (isManual) {
			video.dataset.manuallyStarted = 'true';
			return originalPlay.apply(this, arguments);
		}

		// БЛОКИРУЕМ: если это видео в ленте чата (video--interactive)
		const isChat = video.closest('.video--interactive') || video.classList.contains('player--cover');
		
		if (isChat || !isPlayer) {
			video.pause();
			video.removeAttribute('autoplay');
			const p = Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
			p.catch(() => {}); 
			return p;
		}

		return originalPlay.apply(this, arguments);
	}
});

	// БЕЗОПАСНЫЙ ЗАПУСК ОБСЕРВЕРА
	const startObserver = () => {
		if (!document.body) {
			// Если body еще нет, пробуем через 50мс
			setTimeout(startObserver, 50);
			return;
		}

		const obs = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
			if (n.nodeType !== 1) return; // проверка, что это Element
			const vids = n.tagName === 'VIDEO' ? [n] : (n.querySelectorAll ? n.querySelectorAll('video') : []);
			vids.forEach(v => { v.removeAttribute('autoplay'); v.preload = 'metadata'; });
		})));

		obs.observe(document.body, { childList: true, subtree: true });
	};

	startObserver();
})();
`;
//*/


///////////////////////////////////////////

///////////////////////////////////////////
// загружаем сохраненный масштаб шрифта или ставим по умолчанию
let currentFontPercent = parseFloat(localStorage.getItem('max-font-scale') || '1');
//let currentFontPercent = 1;

function applyMaxFontSmooth(percent: number) { // Явно указываем : number
	const styleId = 'electron-font-smooth-override';
	let styleElement = document.getElementById(styleId);

	if (!styleElement) {
		styleElement = document.createElement('style');
		styleElement.id = styleId;
		document.head.appendChild(styleElement);
	}

	// типизируем объект с базовыми размерами
	const baseSizes: Record<string, number> = {
		baseline: 20,
		header: 24,
		detail: 15,
		body: 16,
		bubble: 14,
		markdown: 17,
		mdtitle: 20,
		smtitle: 14,
		tag: 11,
		label: 12,
		input: 15
	};

	// с этим TS не будет ругаться на умножение
	const baseLine	 = (baseSizes.baseline * percent).toFixed(1);
	const headerSize   = (baseSizes.header   * percent).toFixed(1);
	const detailSize   = (baseSizes.detail   * percent).toFixed(1);
	const bodySize	 = (baseSizes.body	 * percent).toFixed(1);
	const bubbleSize   = (baseSizes.bubble   * percent).toFixed(1);
	const markdownSize = (baseSizes.markdown * percent).toFixed(1);
	const mdtitleSize  = (baseSizes.mdtitle  * percent).toFixed(1);
	const smtitleSize  = (baseSizes.smtitle  * percent).toFixed(1);
	const tagSize	  = (baseSizes.tag	  * percent).toFixed(1);
	const labelSize	= (baseSizes.label	* percent).toFixed(1);
	const inputSize	= (baseSizes.input	* percent).toFixed(1);
	const lhCoeff	  = 1.3;

	styleElement.textContent = `
:root {
  --font-header-size: ${headerSize}px !important;
  --font-detail-size: ${detailSize}px !important;
  --font-body-size: ${bodySize}px !important;
  --font-label-size: ${labelSize}px !important;

  --font-bubble-description-size: ${bubbleSize}px !important;
  --font-bubble-description-strong-size: ${bubbleSize}px !important;
  --font-bubble-description-line-height: ${(Number(bubbleSize) * lhCoeff).toFixed(1)}px !important;

  --font-markdown-message-base-size: ${markdownSize}px !important;
  --font-markdown-message-line-height: ${(Number(markdownSize) * lhCoeff).toFixed(1)}px !important;
  --font-markdown-message-title-size: ${mdtitleSize}px !important;
  --font-markdown-message-base-line-height: ${baseLine}px !important;
  --font-action-small-size: ${smtitleSize}px !important;
  --font-action-small-line-height: ${(Number(smtitleSize) * lhCoeff).toFixed(1)}px !important;

  --font-bubble-tag-size: ${tagSize}px !important;
  --font-bubble-label-strong-size: ${labelSize}px !important;
  --font-bubble-label-size: ${labelSize}px !important;

  --font-tag-size: 11px !important;
//  --font-body-size: 16px !important;
//  --font-label-size: 12px !important;
  --font-description-size: 13px !important;
}


	`;
	
	localStorage.setItem('max-font-scale', percent.toString());
} //*/

////////////////////////////////////////

webFrame.executeJavaScript(scriptToInject); // видео на паузу

//////////////////////////////////////////////
// спиздил у официальной махи, чуть подковырял
if (process.contextIsolated) {
	try {
		let createKey = function(id, messageId, chatId) {
			return `${id}_${messageId}_${chatId}`;
		};
		const subs = new Map();
		ipcRenderer.on(
			"download-progress",
			(_, { fileId, messageId, chatId, downloadedSize, totalSize }) => {
				subs.get(createKey(fileId, messageId, chatId))?.onProgress({ downloadedSize, totalSize });
			}
		);

		/////////////////
		// обрабатываем опции шрифта из tray-меню
		ipcRenderer.on('change-font-size', (_event, action) => {
			if (action === 'up') {
				currentFontPercent = Math.min(currentFontPercent + 0.05, 1.5);
				applyMaxFontSmooth(currentFontPercent);
			} else if (action === 'down') {
				currentFontPercent = Math.max(currentFontPercent - 0.05, 0.5);
				applyMaxFontSmooth(currentFontPercent);
			} else if (action === 'reset') {
				currentFontPercent = 1;
				const el = document.getElementById('electron-font-smooth-override');
				if (el) el.remove();
				localStorage.setItem('max-font-scale', '1');
			}
		});		
		/////////////////


		contextBridge.exposeInMainWorld("electron", {
			downloadFile: ({ url, fileId, messageId, chatId, fileName }, onProgress) => {
				subs.set(createKey(fileId, messageId, chatId), { onProgress });
				return ipcRenderer.invoke("download-file", { url, fileName, fileId, messageId, chatId }).finally(() => subs.delete(createKey(fileId, messageId, chatId)));
			},
			downloadCancel: ({ fileId, messageId, chatId }) => {
				ipcRenderer.send("download-cancel", { fileId, messageId, chatId });
				subs.delete(createKey(fileId, messageId, chatId));
			},
			notifyClick: () => {
				ipcRenderer.invoke("notify-click");
			}
		});
		contextBridge.exposeInMainWorld('api', api);

		///////////////////////////////////////////
		contextBridge.exposeInMainWorld('electronAPI', {
			// выбор экрана для трансляции
			sendReady: () => ipcRenderer.send('picker-ready'),
			onShowSources: (cb: any) => ipcRenderer.on('show-sources', (_e, s) => cb(s)),
			selectSource: (id: string | null) => ipcRenderer.send('source-selected', id),

			// уведомления о сообщениях
			sendNotification: (data: any) => ipcRenderer.send('notify-me', data)

		});

		/////////////////////////////////////////////////
		// при клике на картинку/видео врубаем fullscreen
		const observer = new MutationObserver(() => {
			const mover = document.querySelector('[class*="mover"]');
//			const mover = document.querySelector('dialog[class*="container"]');
//			console.log('мы в прелоадере');
			ipcRenderer.send('toggle-max-viewer', !!mover);
		});

		window.addEventListener('DOMContentLoaded', () => {
			observer.observe(document.body, { childList: true, subtree: true });
		});//*/
		////////////////////////////////////////////////////





		////////////////////////////////////////////////////
		// применяем настройки шрифтов при загрузке страницы
		window.addEventListener('DOMContentLoaded', () => {
			if (currentFontPercent != 1) applyMaxFontSmooth(currentFontPercent);
		});//*/

		// слушатель клавиш Ctrl + PgUp/PgDn/Home
		window.addEventListener('keydown', (e) => {
			if (e.ctrlKey) {
				if (e.key === 'PageUp') {
					e.preventDefault();
					currentFontPercent += 0.05;
					if (currentFontPercent > 1.5) currentFontPercent = 1.5;
					applyMaxFontSmooth(currentFontPercent);
				} else if (e.key === 'PageDown') {
					e.preventDefault();
					currentFontPercent -= 0.05;
					if (currentFontPercent < 0.5) currentFontPercent = 0.5;
					applyMaxFontSmooth(currentFontPercent);
				} else if (e.key === 'Home') {
					e.preventDefault();
					currentFontPercent = 1;
					const el = document.getElementById('electron-font-smooth-override');
					if (el) el.remove();
				}
 			}
		});//*/

		///////////////////////////////////////////////////
		// махинации с копированием картинки по нажатию ПКМ
		window.addEventListener('mousedown', (e: MouseEvent) => {
			if (e.button !== 2) return;

			const target = e.target as HTMLElement;
			const img = target.closest('img') as HTMLImageElement | null;

			if (img && img.complete) {
				// копия картинки для обхода ограничений CORS, если нужно
				const tempImg = new Image();
				tempImg.crossOrigin = "anonymous"; 
				tempImg.src = img.src;

				tempImg.onload = () => {
					const canvas = document.createElement('canvas');
					canvas.width = tempImg.naturalWidth;
					canvas.height = tempImg.naturalHeight;

					const ctx = canvas.getContext('2d');
					if (ctx) {
						ctx.drawImage(tempImg, 0, 0);
						const dataUrl = canvas.toDataURL('image/png');
						ipcRenderer.send('copy-data-url-to-clipboard', dataUrl);
					}
				};

				tempImg.onerror = () => {
					// если через Canvas не вышло, пробуем старый метод
					ipcRenderer.send('copy-image-to-clipboard', img.src);
				};
			}
		}, true);



		//////////////////////////////////////////////////
		// по CTRL+S имитируем нажатие на кнопку "Скачать"
		// в просмотрщике, чтобы скачивать, без мышки
		document.addEventListener('keydown', (event: KeyboardEvent) => {
			const isCtrlS = (event.ctrlKey || event.metaKey) && event.code === 'KeyS';

			if (isCtrlS) {
				// мы в просмотрщике?
				const viewer = document.querySelector('[class*="mover"]');
				if (viewer) {
					// ищем кнопку "скачать"
					const downloadSpan = document.querySelector('button[aria-label*="Скачать"] span.text') as HTMLElement | null;

					if (downloadSpan) {
//						event.preventDefault(); // остановить нативное сохранение
//						event.stopImmediatePropagation(); // помешать другим скриптам перехватить нажатие
						downloadSpan.click();
//						console.log('[Electron] Media download triggered via Span click');
					}
				}
			}
		}, true);//*/

		///////////////////////////////////////////////////
		// попытаемся отработать сворачивание в трей по Esc
		document.addEventListener('keydown', (event: KeyboardEvent) => {
			const isEsc = event.code === 'Escape';
			if (isEsc) {
				// мы "на пустом месте"? (чат/профиль закрыт)
//				const addChats = document.querySelector('button.button--accent-primary[aria-label="Добавить чаты"]');
				const emptyState = document.querySelector('[class*="emptyState"]');
//				const emptyState = !!document.querySelector('.emptyState');
//				const emptySvelte = document.querySelector('[class*="empty.Svelte"]');
//				const addChats = !!document.querySelector('button[aria-label="Добавить чаты"]');
//				if (emptyState && !addChats) window.electronAPI.hideWindow();
				if (emptyState) {// && !emptySvelte) {
//					console.log('Esc нажат (3й сегмент - emptyState)');
					ipcRenderer.send('hide-by-esc'); // сворачиваемся
				}
				else {
					// пробуем найти кнопку "Назад", если мы где-нибудь в чате
					const backButton = document.querySelector('button.backBtn.button') as HTMLElement | null;
					if (backButton) backButton.click();
					// или пробуем перейти "назад по истории" (как правило, если мы в настройках профиля)
					else if (window.history.length > 1) window.history.back();
				}
			}
		}, true);//*/

		//////////////////////////////////////
		// скроллинг клавишами PgUp/PgDn
		// в открытом чате или втором сегменте
		// окна (если чат закрыт (emptyState)
		document.addEventListener('keydown', (event: KeyboardEvent) => {
			const { key } = event;
			const isPgUp = key === 'PageUp';
			const isPgDown = key === 'PageDown';
			const isArrowUp = key === 'ArrowUp';
			const isArrowDown = key === 'ArrowDown';
			if (!isPgUp && !isPgDown && !isArrowUp && !isArrowDown) return;

			// мы в поле ввода?
			const activeEl = document.activeElement;
			const isTyping = activeEl && (
				activeEl.tagName === 'INPUT' || 
				activeEl.tagName === 'TEXTAREA' || 
				(activeEl as HTMLElement).isContentEditable
			);

			const isEmptyState = !!document.querySelector('.emptyState');

			// поиск скролл-контейнера
			const findScrollable = (el: Element): Element | null => {
				const style = window.getComputedStyle(el);
				const isScrollable = /(auto|scroll)/.test(style.overflowY + style.overflow);
				if (isScrollable && el.scrollHeight > el.clientHeight) return el;
				for (const child of Array.from(el.children)) {
					const found = findScrollable(child);
					if (found) return found;
				}
				return null;
			};

			// второй сегмент (список чатов)
			if (isEmptyState) {
				// ищем либо .cropped, либо любой подходящий сайдбар (левую панель)
				const sideBar = document.querySelector('.cropped') || document.querySelector('aside');
				if (!sideBar) return;

				// нажаты стрелки — переносим фокус
				if (isArrowUp || isArrowDown) {
					if (!sideBar.contains(activeEl)) {
						const firstChat = sideBar.querySelector('a, button, [role="button"], [tabindex="0"]');
						(firstChat as HTMLElement)?.focus();
					}
					return;
				}

				// нажаты PgUp/PgDown — листаем список
				if (isPgUp || isPgDown) {
					// если findScrollable не находит внутри .cropped, пробуем сам .cropped
					const scrollContainer = findScrollable(sideBar) || sideBar;

					if (scrollContainer) {
						const direction = isPgUp ? -1 : 1;
						const scrollAmount = scrollContainer.clientHeight * 0.8;

						scrollContainer.scrollBy({
							top: scrollAmount * direction,
							behavior: 'smooth'
						});

						event.preventDefault();
						event.stopPropagation();
					}
				}
			}

			// третий сегмент (открытый чат)
			else {
				const chat = document.querySelector('.openedChat');
				if (!chat) return;

				// печатаем, значит стрелки не трогаем. но PgUp/PgDown — всегда листают чат
				if (isTyping && (isArrowUp || isArrowDown)) return;

				const scrollContainer = findScrollable(chat);
				if (scrollContainer) {
					const direction = (isArrowUp || isPgUp) ? -1 : 1;
					const scrollAmount = (isArrowUp || isArrowDown) 
						? 100 
						: scrollContainer.clientHeight * 0.7;

					scrollContainer.scrollBy({
						top: scrollAmount * direction,
						behavior: 'smooth'
					});

					event.preventDefault();
					event.stopPropagation();
				}
			}
		}, true);


		////////////////////////////////////////////////////////////////////////
		// здесь пляски с бубном и куртизатнками вокруг МАХовского контекстного
		// меню по пунктику "Вставить", чтобы научить вставлять картинки

		// глядим, чего под мышкой
		window.addEventListener('mousedown', (e) => {
			const target = e.target as HTMLElement;
			const btn = target.closest('button.actionsMenuItem');
			const title = btn?.querySelector('.title')?.textContent;

			if (title === 'Вставить') {
				const input = document.querySelector('[contenteditable="true"], textarea') as HTMLElement;
				if (input) {
					input.focus();
				}
			}
		}, true);

		window.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			const btn = target.closest('button.actionsMenuItem');
			const title = btn?.querySelector('.title')?.textContent;

			if (title === 'Вставить') {
				ipcRenderer.send('force-ctrl-v');
				(window as any)._skipNextPaste = true;
				setTimeout(() => (window as any)._skipNextPaste = false, 300);
			}
		}, true);

		// если в буфере только текст - гасим его
		window.addEventListener('paste', (e) => {
			if ((window as any)._skipNextPaste) {
				if (!e.clipboardData?.types.includes('Files')) {
					e.stopImmediatePropagation();
				}
			}
		}, true);
		
		////////////////////////////////////////////////////////////////////////


	} catch (error) {
		console.error(error);
	}


} else {
//	window.electron = electronAPI;
//	window.api = api;
}

/*

// кажись, до этого момента не доходит, хотя сохранялка работает... пока оставим
contextBridge.exposeInMainWorld('electronAPI', {
	onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});

overrideNotification(); //*/
