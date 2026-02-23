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

function handleChromeVersionBug() {
    window.addEventListener("DOMContentLoaded", () => {
        if (document.getElementsByClassName("landing-title version-title").length != 0)
            ipcRenderer.send("chrome-version-bug");
    });
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

            console.log('--- AUTOPLAY BLOCKED BY INJECTION ---');
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

// попытаемся развернуть картинки во весь экран
// вариант 1 - всё криво, но картинку
// разворачивает (по двойному клику ЛКМ)

///*
const imageFullscreenScript = `
document.addEventListener('dblclick', (e) => {
	const target = e.target;
	if (target.tagName === 'IMG') {
		if (!document.fullscreenElement)
		{
			target.requestFullscreen().catch(err => {
				target.parentElement.requestFullscreen();
			});
		} else {
			document.exitFullscreen();
		}
	}
}, true);
`;//*/

// вариант 2 - при клике на картинку или
// видео должно разворачиваться
/*const imageFullscreenScript = `
document.addEventListener('click', (e) => {
	const target = e.target;
	if (target.tagName === 'IMG' && target.closest('.message-content')) {
		window.electronAPI.openViewer({ url: target.src, type: 'image' });
	}

//	if (target.tagName === 'VIDEO') {
//		window.electronAPI.openViewer({ url: target.src, type: 'video' });
//	}
}, true);
`;//*/



///////////////////////////////////////////
///////////////////////////////////////////
// Загружаем сохраненный масштаб или ставим 100%
/*/
let currentFontPercent = parseInt(localStorage.getItem('max-font-scale') || '1');
//let currentFontPercent = 1;

function applyMaxFontSmooth(percent: number) {
	const styleId = 'electron-font-smooth-override';
	let styleElement = document.getElementById(styleId);

	if (!styleElement) {
		styleElement = document.createElement('style');
		styleElement.id = styleId;
		document.head.appendChild(styleElement);
	}

	styleElement.textContent = `
		html, body, #app, main, div, span, p, input, textarea, [class*="svelte-"] {
			font-size: ${percent}rem !important;
//			transition: font-size 0.01s ease-out !important;
		}

	    [class*="navigation"], [class*="navigation"] *, 
		.navigation, .navigation * {
			font-size: 11px !important; 
			transition: none !important;
		}
		[class*="settingsTab"], [class*="settingsTab"] *,
		.settingsTab, .settingsTab * {
			font-size: 15px !important; 
			transition: none !important;
		}

		i, svg, img, .icon {
			transition: none !important;
		}

		[class*="info"], .info * {
			font-size: 24px !important; 
			transition: none !important;
		}

		[class*="header"], {
			font-size: 16px !important; 
			transition: none !important;
		}
	`;
	localStorage.setItem('max-font-scale', percent.toString());
} //*/

////////////////////////////////////////
////////////////////////////////////////

webFrame.executeJavaScript(scriptToInject); // видео на паузу
//webFrame.executeJavaScript(imageFullscreenScript); // разрешим картинки в fullScreen

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

/*			// просмотрщик картинок/видео
			,
			openViewer: (data: { url: string, type: 'image' | 'video' }) => ipcRenderer.send('open-viewer', data),
			onLoadContent: (cb: any) => ipcRenderer.on('load-content', (_e, data) => cb(data)),
			closeViewer: () => ipcRenderer.send('close-viewer')
			//*/
		});
		//console.info('--- Preload Script Active ---'); // для отладки

		/////////////////////////////////////////////////
		// при клике на картинку/видео врубаем fullscreen
		const observer = new MutationObserver(() => {
			const mover = document.querySelector('[class*="mover"]');
			ipcRenderer.send('toggle-max-viewer', !!mover);
		});

		window.addEventListener('DOMContentLoaded', () => {
			observer.observe(document.body, { childList: true, subtree: true });
		});//*/
		///////////////////////////////////////////

/*		// применяем настройки шрифтов при загрузке страницы
		window.addEventListener('DOMContentLoaded', () => {
			if (currentFontPercent != 1) applyMaxFontSmooth(currentFontPercent);
		});

		// слушатель клавиш Ctrl + PgUp/PgDn/Home
		window.addEventListener('keydown', (e) => {
			if (e.ctrlKey) {
				if (e.key === '=' || e.key === 'PageUp') {
					e.preventDefault();
					currentFontPercent += 0.1;
					if (currentFontPercent > 2) currentFontPercent = 2;
					applyMaxFontSmooth(currentFontPercent);
				} else if (e.key === 'PageDown') {
					e.preventDefault();
					currentFontPercent -= 0.1;
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
		///////

	} catch (error) {
		console.error(error);
	}


/*////////
// попытска сделать собственный просмотрщик...
window.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  // ищем клик по картинке (тег <img>)
  if (target && target.tagName === 'IMG') {
    const img = target as HTMLImageElement;
    
    // блокируем стандартное поведение браузера (если оно есть)
    e.preventDefault();
    e.stopPropagation();

    // Отправляем сигнал в Main процесс
    ipcRenderer.send('open-viewer', { 
      url: img.src, 
      type: 'image' 
    });
  }
}, true); // true — чтобы поймать клик раньше скриптов самого сайта
////////*/

} else {
//	window.electron = electronAPI;
//	window.api = api;
}

// кажись, до этого момента не доходит, хотя сохранялка работает... пока оставим
contextBridge.exposeInMainWorld('electronAPI', {
	onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});

overrideNotification();
handleChromeVersionBug();



