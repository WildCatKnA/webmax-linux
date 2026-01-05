import { contextBridge, ipcRenderer } from "electron";

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
		contextBridge.exposeInMainWorld('api', {});
	} catch (error) {
		console.error(error);
	}
} else {

}

contextBridge.exposeInMainWorld('electronAPI', {
  onDownloadComplete: (callback) => ipcRenderer.on('dl-complete', (event, data) => callback(data))
});

overrideNotification();
handleChromeVersionBug();

