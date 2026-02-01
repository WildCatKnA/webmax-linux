import { contextBridge, webFrame, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
const api = {};
//const { dialog } = require('electron');
////////////////////////////////////////////////////////////////////////////////
// кастомная рамка окна
/*const titleBarScript = `
(function() {
    const tb = document.createElement('div');
    tb.id = 'tg-header';
    tb.innerHTML = '<div class="drag-area"></div><div class="title">MAX</div>';
    document.body.prepend(tb);

    const style = document.createElement('style');
    style.textContent = \`
        #tg-header {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 32px;
            background: #17212b;
            display: flex;
            align-items: center;
            z-index: 10000; // выше всех элементов сайта
            border-bottom: 1px solid #0e161d;
        }
        .drag-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;//calc(100% - 138px);
            height: calc(100% - 138px);//100%;
            -webkit-app-region: drag; // делаем область перетаскиваемой
        }
        .title {
            margin-left: 12px;
            color: #f5f5f5;
            font-family: "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            pointer-events: none; // не мешать перетаскиванию
        }
        // сдвигаем контент сайта вниз 
        #root, .app-container, body > div:first-of-type {
            margin-top: 24px !important;
        }
        // убираем заголовок в фуллскрине и при просмотре фото
        :root:-webkit-full-screen #tg-header,
        body.is-viewer-open #tg-header {
            display: none !important;
        }
    \`;
    document.head.append(style);

    // Добавляем класс на body при появлении .mover, чтобы скрыть заголовок через CSS
    const observer = new MutationObserver(() => {
        document.body.classList.toggle('is-viewer-open', !!document.querySelector('.mover'));
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
`;
//*/
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
`;

//webFrame.executeJavaScript(titleBarScript); // врубить кастомную рамку
webFrame.executeJavaScript(scriptToInject); // видео на паузу
webFrame.executeJavaScript(imageFullscreenScript); // разрешим картинки в fullScreen

////////////////////////////////////////////////////////////////////////////////

function handleChromeVersionBug() {
	window.addEventListener("DOMContentLoaded", () => {
		if (document.getElementsByClassName("landing-title version-title").length != 0)
			ipcRenderer.send("chrome-version-bug");
	});
}

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
	//window.electron = electronAPI;
	//window.api = api;
}

contextBridge.exposeInMainWorld('electronAPI', {
  onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});


//overrideNotification();
handleChromeVersionBug();

