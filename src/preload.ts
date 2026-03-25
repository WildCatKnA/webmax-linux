import { contextBridge, ipcRenderer, webFrame } from "electron";
const api = {};
const { dialog } = require('electron');

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
const scriptToInject = `
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
`;

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
	const baseLine     = (baseSizes.baseline * percent).toFixed(1);
	const headerSize   = (baseSizes.header   * percent).toFixed(1);
	const detailSize   = (baseSizes.detail   * percent).toFixed(1);
	const bodySize     = (baseSizes.body     * percent).toFixed(1);
	const bubbleSize   = (baseSizes.bubble   * percent).toFixed(1);
	const markdownSize = (baseSizes.markdown * percent).toFixed(1);
	const mdtitleSize  = (baseSizes.mdtitle  * percent).toFixed(1);
	const smtitleSize  = (baseSizes.smtitle  * percent).toFixed(1);
	const tagSize      = (baseSizes.tag      * percent).toFixed(1);
	const labelSize    = (baseSizes.label    * percent).toFixed(1);
	const inputSize    = (baseSizes.input    * percent).toFixed(1);
    const lhCoeff      = 1.3;

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
		///////////////////////////////////////////


		///////////////////////////////////////////


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

		////////////////////////////////////////////////////////////////////////
		// здесь пляски с бубном и куртизатнками вокруг МАХовского контекстного
		// меню по пунктику "Вставить", чтобы научить вставлять картинки

		// глядим, чего под мышкой, прячем меню
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

// кажись, до этого момента не доходит, хотя сохранялка работает... пока оставим
contextBridge.exposeInMainWorld('electronAPI', {
	onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});

overrideNotification();
