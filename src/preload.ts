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

//////////////////////////////////////////////////////////////////
// очередная попытка остановить автовоспроизведение видео в MAX...
// и, по всей видимости  сработало =) внедрим  скриптик, который
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


webFrame.executeJavaScript(scriptToInject); // видео на паузу
webFrame.executeJavaScript(imageFullscreenScript); // разрешим картинки в fullScreen

///////////////////////////////////////////

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
		///////////////////////////////////////////

	} catch (error) {
		console.error(error);
	}


/*////////
window.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  // Ищем клик по картинке (тег <img>)
  if (target && target.tagName === 'IMG') {
    const img = target as HTMLImageElement;
    
    // Блокируем стандартное поведение браузера (если оно есть)
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



