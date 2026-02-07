import { contextBridge, ipcRenderer, webFrame } from "electron";
const api = {};
const { dialog } = require('electron');

////////////////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////////////////////////////
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
////////////////////////////////////////////////////////////////////////////////

// попытаемся развернуть картинки во весь экран - всё криво,
// но картинку разворачивает (по двойному клику ЛКМ)

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

webFrame.executeJavaScript(scriptToInject); // видео на паузу
webFrame.executeJavaScript(imageFullscreenScript); // разрешим картинки в fullScreen

////////////////////////////////////////////////////////////////////////////////


contextBridge.exposeInMainWorld('electronAPI', {
	onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});


contextBridge.exposeInMainWorld('electronAPI', {
  // для окна выбора транслируемого объекта
  sendReady: () => ipcRenderer.send('picker-ready'),
  onShowSources: (cb: any) => ipcRenderer.on('show-sources', (_e, s) => cb(s)),
  selectSource: (id: string | null) => ipcRenderer.send('source-selected', id),
});

// спиздил у официальной махи
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
	} catch (error) {
		console.error(error);
	}
} else {
//	window.electron = electronAPI;
//	window.api = api;
}

overrideNotification();
handleChromeVersionBug();


////////////////////////////////////////////////////////////////////////////////



