import { app, desktopCapturer, BrowserWindow, nativeImage, ipcMain, shell } from "electron";
import ChromeVersionFix from "./fix/chrome-version-fix";
import Electron21Fix from "./fix/electron-21-fix";
import HotkeyModule from "./module/hotkey-module";
import ModuleManager from "./module/module-manager";
import TrayModule from "./module/tray-module";
import WindowSettingsModule from "./module/window-settings-module";
import { getUnusedPath } from "./util";

import { existsSync, createWriteStream, unlink } from "fs";
import Store from "electron-store";

import { get } from "https";

const store = new Store({
	name: "globalStore",
	clearInvalidConfig: true
});
const globalStore = {
	has(key) {
		return store.has(key);
	},
	set(key, payload) {
		store.set(key, payload);
	},
	get(key) {
		return store.get(key);
	},
	delete(key) {
		return store.delete(key);
	}
};

//////////////////////////////////////////////////

const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const downloadsStore = new Store();

let workerWindow: BrowserWindow | null = null;

//let workerWindow = null; // Скрытое окно-рендерер
//const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.9999.0 Safari/537.36";

export default class MainApp {
	
	private readonly window: BrowserWindow;
	private readonly moduleManager: ModuleManager;
	public quitting = false;
	public blockAudVid = false;

	constructor() {
		this.window = new BrowserWindow({
			title: "MAX",
			icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
			width: 1200,
			height: 800,
			minWidth: 800,
			minHeight: 600,
			backgroundColor: "#25262d",
//			useContentSize: true,//false
			show: false,
			autoHideMenuBar: true,
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				spellcheck: false,

				// autoplayPolicy не срабатывает, но, один хер, оставим))
				autoplayPolicy: 'document-user-activation-required', //'user-gesture-required',
				contextIsolation: false//, // native Notification override in preload :(
			}
		});

		// костыль в виде CSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна от криворучек, выдумавших маху
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары поверх махо-интерфейсовых)
		this.window.webContents.insertCSS('.aside, .openedChat { height: 100vh; display: flex; flex-direction: column; }  ');

		this.moduleManager = new ModuleManager([
			new Electron21Fix()
			, new HotkeyModule(this, this.window)
			, new TrayModule(this, this.window)
			, new WindowSettingsModule(this, this.window)
			, new ChromeVersionFix(this)
		]);

		this.window.on("show", () => {
		
			setTimeout(() => {
				this.window.focus();
			}, 200);
		});

		///////////////////////////////////////////////
		// костыль, для скачивания видосика для костыля, который не отправит ссылку в браузер
		this.window.webContents.session.on('will-download', (event, item, webContents) => {
			const fileName = item.getFilename(); 

			// Принудительно вызываем диалог сохранения:
			const savePath = dialog.showSaveDialogSync(this.window, {
				title: 'Сохранить файл',
				defaultPath: path.join(app.getPath('downloads'), fileName) // Предлагаем стандартное имя файла
			});

			if (savePath) {
				item.setSavePath(getUnusedPath(savePath)); // добавляем (n), если файл уже есть

				item.once('done', (event, state) => {
					this.window.webContents.send('dl-complete', { success: state === 'completed', path: savePath });
//					resolve({ success: true, filePath: savePath });
					shell.showItemInFolder(savePath);
				});
			} else {
				item.cancel(); // Если нажали "Отмена" в диалоге
			}
		});
	}
	

	public init() {
		this.makeLinksOpenInBrowser();
		this.registerListeners();

		this.window.setMenu(null);

		this.window.loadURL('https://web.max.ru/', {
//			userAgent: USER_AGENT,
			extraHeaders: "pragma: no-cache\n"
		});

		this.moduleManager.beforeLoad();
		this.moduleManager.onLoad();
		///////////////////////////////////////////////
		/// полная блокировка  видеоплеера в MAX
		//	слишком радикально, но оно сработало
		if (this.blockAudVid) {
			this.window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
				callback({
					responseHeaders: {
						...details.responseHeaders,
						'Content-Security-Policy': ["media-src 'none'"] // Запрещает ВСЁ медиа
					}
				});
			});
		} //*/
		///////////////////////////////////////////////
		app.setAsDefaultProtocolClient("max");
		app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');

		this.window.show();
		/////////
/*		workerWindow = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				backgroundThrottling: false
			}
		});
		workerWindow.loadFile('worker.html');

		// Когда рендерер готов, отправляем ему SVG
		workerWindow.webContents.once('did-finish-load', () => {
			function renderSvgToTray(svgString) {
			    if (workerWindow) {
	        		workerWindow.webContents.send('render-svg', svgString);
	    		}
			}
			const mySvg = `<svg width="32" height="32" xmlns="www.w3.org">
<circle cx="16" cy="16" r="14" fill="red" />
<text x="16" y="21" font-family="Arial" font-size="14" fill="white" text-anchor="middle">SVG</text>
</svg>`;
			renderSvgToTray(mySvg);
		});
		/////////*/

	}

	public reload() {
		this.window.webContents.reloadIgnoringCache();
	}

	public quit() {
		this.quitting = true;
		this.moduleManager.onQuit();
		app.quit();
	}
	

	// если контент - видос или изображение, то попытаемся сохранить,
	// в противном случае: если протокол https - открываем ссылку в браузере
	private makeLinksOpenInBrowser() {

		this.window.webContents.setWindowOpenHandler((details) => {
		const url = details.url;
		try {
			const parsed = new URL(url);
			// костыль при попытке скачать видосик - если не проверить, ссылка откроется в браузере
			const pattern = /^https\:\/\/maxvd.*\.okcdn\.ru.*$/; // maxvd375.okcdn.ru
			if (parsed.protocol === "https:" && pattern.test(url)) {
				this.window.webContents.session.downloadURL(url);
				return { action: "deny" };

			} else if (parsed.protocol === "https:" && !pattern.test(url)) {
				shell.openExternal(url);
				return { action: "deny" };

			} else {
				console.warn(`Blocked unsafe URL: ${url}`);
			}

		} catch (e) {
			console.warn(`Invalid URL: ${url}`);
		}
		return { action: "deny" };
		}); // */

		////////////////////////////////////////////////////////////
	}

	private registerListeners() {
		app.on('second-instance', () => {
			this.window.show();
			this.window.focus();
		});

		ipcMain.on('notification-click', () => {
			if (!this.window.isVisible()) this.window.show();
			if (this.window.isMinimized()) this.window.restore();
			this.window.focus();		
		});
		///////////////////////////////////////////////
//		ipcMain.on('png-finished', (event, dataUrl) => {
//        	const icon = nativeImage.createFromDataURL(dataUrl);
//!			this.tray.setImage(icon);
//			console.log('SVG успешно превращен в PNG и установлен в трей');
//		});
		///////////////////////////////////////////////

		// спиздил из официальной махи и подогнал под свои нужды... но, на мой взгляд, всё можно сделать проще
		ipcMain.handle("download-file", async (_, { url, fileId, messageId, chatId, fileName }) => {
			function createKey(id, messageId2, chatId2) {
				return `${id}_${messageId2}_${chatId2}`;
			}
			const storeKey = createKey(fileId, messageId, chatId);
			return new Promise((resolve, reject) => {
				let canceled = false;
				const downloadPath = app.getPath("downloads");
				const filePath = path.join(downloadPath, fileName);
				const exists = existsSync(filePath);
				if (filePath && exists) {
					shell.showItemInFolder(filePath);
					resolve({ success: true, filePath: filePath });
					return;
				}

				let finalFilePath = getUnusedPath(filePath);
				const file = createWriteStream(finalFilePath);
				const req = get(url, (response) => {
					const totalSize = parseInt(response.headers["content-length"] || "", 10);
					let downloadedSize = 0;
					response.on("data", (chunk) => {
						if (canceled) {
							return;
						}
						downloadedSize += chunk.length;
						const progress = Math.round(downloadedSize / totalSize * 100);
						this.window.webContents.send("download-progress", {
							fileId,
							messageId,
							chatId,
							progress,
							downloadedSize,
							totalSize
						});
					});
					response.pipe(file);
					file.on("finish", () => {
						ipcMain.removeListener("download-cancel", handleCancel);
						file.close();
						resolve({ success: true, filePath: finalFilePath });
						shell.showItemInFolder(finalFilePath);
					});
				}).on("error", (err) => {
					unlink(finalFilePath, () => {
					});
					reject(err);
				});
				function handleCancel(_2, cancel) {
					if (cancel.fileId === fileId && cancel.messageId === messageId && cancel.chatId === chatId) {
						canceled = true;
						req.destroy();
						unlink(finalFilePath, () => {
						});
					}
				}
				ipcMain.on("download-cancel", handleCancel);
			});
		});
		///////////////////////////////////////////////
/*//
ipcMain.on('open-viewer', (event, data) => {
    let viewer = new BrowserWindow({
        fullscreen: true,
        backgroundColor: '#000000',
        frame: false
    });

    // Генерируем HTML прямо в коде
    const html = `
        <html>
        <body style="margin:0; background:black; display:flex; justify-content:center; align-items:center; height:100vh;" onclick="window.close()">
            <img src="${data.url}" style="max-width:100%; max-height:100%;">
            <script>
                window.onkeydown = (e) => { if(e.key === 'Escape') window.close(); }
            </script>
        </body>
        </html>
    `;

    viewer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});
//*/
		///////////////////////////////////////////////

	}
};
