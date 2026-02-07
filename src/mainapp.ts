import { app, session, desktopCapturer, BrowserWindow, nativeImage, ipcMain, shell } from "electron";
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
let pickerWindow: BrowserWindow | null = null;

//const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.9999.0 Safari/537.36";

export default class MainApp {
	
	private readonly window: BrowserWindow;
	private readonly moduleManager: ModuleManager;
	public quitting = false;
	public openFldr = true;

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
//				autoplayPolicy: 'user-gesture-required',
				contextIsolation: true // if false - native Notification override in preload 
			}
		});

		// костыль в виде CSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна от криворучек, выдумавших маху
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары поверх махо-интерфейсовых)
		if (process.versions.electron.startsWith('21.')) {
			this.window.webContents.insertCSS('.aside, .openedChat { height: 100vh; display: flex; flex-direction: column; }  ');
		}

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

			// принудительно вызываем диалог сохранения:
			const savePath = dialog.showSaveDialogSync(this.window, {
				title: 'Сохранить файл',
				defaultPath: path.join(app.getPath('downloads'), fileName) // предлагаем стандартное имя файла
			});

			if (savePath) {
				item.setSavePath(getUnusedPath(savePath)); // добавляем (n), если файл уже есть

				item.once('done', (event, state) => {
					this.window.webContents.send('dl-complete', { success: state === 'completed', path: savePath });
//					resolve({ success: true, filePath: savePath });
					if (this.openFldr) { shell.showItemInFolder(savePath); }
				});
			} else {
				item.cancel(); // нажали "Отмена" в диалоге
			}
		});
	}
	

	public init() {
		app.setAppUserModelId('webmax');
		//app.setDesktopName('webmax.desktop');
//		electronApp.setAppUserModelId("ru.oneme.electron"); // у официалов это было
		app.setAsDefaultProtocolClient("max");

		////////////////////////////////////////////////////////////////////////
		// убираем electron и наше  приложение из UserAgent
		// (прикидываемся "ветошью", т.е. мы - а-ля Chrome)
		/*
		const defaultUserAgent = new BrowserWindow({ show: false }).webContents.getUserAgent();
		let usSTR = defaultUserAgent.replace(/Electron\/[\d.]+\s/, '');  
		usSTR = usSTR.replace(/webmax\/[\d\.\-]+/g, '');
		const cleanUserAgent = usSTR;
		app.userAgentFallback = cleanUserAgent;//*/

		////////////////////////////////////////////////////////////////////////
		// разрешение для трансляции экрана
		// вариант 1 - вещает только весь экран
		session.defaultSession.setDisplayMediaRequestHandler(
			(request, callback) => {
				desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
					callback({ video: sources[0], audio: "loopback" });
				});
			} //, { useSystemPicker: true } // выбор источника - не работает в electron-22
		);//*/

		// вариант 2 - не работает, ибо оно не знает, чего вещать
/*		session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
			callback({ video: (request as any).video, audio: (request as any).audio });
		}
//		,{ useSystemPicker: true }
		);//*/

		// вариант 3 - грабли с выбором, не показывает варианты
		////////////////////////////////////////////////////////////////////////
/*		session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
			desktopCapturer.getSources({ 
				types: ['screen', 'window'], 
				thumbnailSize: { width: 300, height: 300 } 
			}).then((sources) => {
			
				pickerWindow = new BrowserWindow({
					width: 500,
					height: 600,
					parent: this.window,
					modal: true,
					backgroundColor: "#25262d",
					autoHideMenuBar: true,
					webPreferences: {
						preload: path.join(__dirname, 'preload.js'),
						contextIsolation: true,
						nodeIntegration: false
					}
				});

				pickerWindow.loadFile(path.join(__dirname, 'picker.html'));

				// отправляем данные, когда renderer готов
				ipcMain.once('picker-ready', () => {
					const viewSources = sources.map(s => ({
						id: s.id,
						name: s.name,
						thumbnail: s.thumbnail.toDataURL()
					}));
					pickerWindow?.webContents.send('show-sources', viewSources);
				});

				// выбираем источник
				ipcMain.once('source-selected', (_event, sourceId) => {
					const selected = sources.find(s => s.id === sourceId);
					callback(selected ? { video: selected, audio: 'loopback' } : {});
					pickerWindow?.close();
				});
			});
		});//*/
		////////////////////////////////////////////////////////////////////////

		// разрешаем уведомления, доступ к медиа и микрофону, если возможно
		// types '"geolocation" | "unknown" | "clipboard-read" | "clipboard-sanitized-write" |
		// "display-capture" | "mediaKeySystem" | "midi" | "midiSysex" | "pointerLock" | "fullscreen" |
		// "openExternal" | "window-placement"' and '"audioCapture"' 
		session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
			const allowedPermissions = ['fullscreen', 'notifications', 'media', 'audioCapture']; 
			if (allowedPermissions.includes(permission)) {
				callback(true); 
			} else {
				callback(false);
			}
		});
		////////////////////////////////////////////////////////////////////////
		
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
		//  полная блокировка  видеоплеера в MAX
		//	слишком радикально, но оно сработало
		//  (но блокировала и аудиосообщения...)
		// --- уже не актуально, победили ---
		/*if (this.blockAudVid) {
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

		this.window.show();

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

		this.window.webContents.on('enter-html-full-screen', () => {
			this.window.setFullScreen(true);
		});

		this.window.webContents.on('leave-html-full-screen', () => {
			this.window.setFullScreen(false);
		});//*/


		// для contextIsolation = false (по сути, не требуется)
		ipcMain.on('notification-click', () => {
			if (!this.window.isVisible()) this.window.show();
			if (this.window.isMinimized()) this.window.restore();
			this.window.focus();		
		});

		// для contextIsolation = true
		ipcMain.handle("notify-click", async () => {
			if (!this.window.isVisible()) { this.window.show(); }
			if (this.window.isMinimized()) { this.window.restore(); }

			this.window.show();
			this.window.focus();
		});


		// спиздил из официальной махи и подогнал под свои нужды...
		// но, на мой взгляд, всё можно сделать проще, но и это работает
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
					if (this.openFldr) { shell.showItemInFolder(filePath); }
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
						if (this.openFldr) { shell.showItemInFolder(finalFilePath); }
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

	}
};
