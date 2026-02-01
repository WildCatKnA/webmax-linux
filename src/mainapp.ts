import { app, session, desktopCapturer, BrowserWindow, nativeImage, ipcMain, shell } from "electron";
import ChromeVersionFix from "./fix/chrome-version-fix";
import { is, electronApp, optimizer } from "@electron-toolkit/utils";
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
const debugme = false;//true; // для DevTools
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const downloadsStore = new Store();

let workerWindow: BrowserWindow | null = null;

//const USER_AGENT = "Mozilla/5.0 (Unknown OS x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

export default class MainApp {
	
	private readonly window: BrowserWindow;
	private readonly moduleManager: ModuleManager;
	public quitting = false;
	public blockAudVid = false;
	public focused = false;

	constructor() {
		this.window = new BrowserWindow({
			title: "MAX",
			icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
			width: 1200,
			height: 800,
			minWidth: 800,
			minHeight: 600,
//			minimizable: false, 
			backgroundColor: "#17181c", //"#25262d",
//			useContentSize: true,//false
			show: false,
			autoHideMenuBar: true,

			// пока чего-то не работает как надо, закомментируем, думаем дальше
			/*
			//titleBarStyle: (process.platform === 'linux') ? 'default' : 'hidden',
			titleBarStyle:  'hidden',
			titleBarOverlay: {
				color: '#17181c',//'#2b2b2b',
				symbolColor: '#708499',//'#ffffff',
				height: 24
			},//*/

			fullscreenable: true,
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				spellcheck: false,
//				fullscreen: true,
				// contextIsolation: если false - загрузка вложенных файлов через браузер, что не алё... идея официалов
				contextIsolation: true//false, // native Notification override in preload :( 
			}
		});
		if (debugme) { this.window.webContents.openDevTools({ mode: 'detach' }); }

		// костыль в виде CSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна от криворучек, выдумавших маху
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары поверх MAX-интерфейсовых)
		// с electron-22 вроде работает нормально, поэтому организуем проверку версии electron
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
  			const defaultUserAgent = new BrowserWindow({ show: false }).webContents.getUserAgent();
  			let usSTR = defaultUserAgent.replace(/Electron\/[\d.]+\s/, '');  
  			usSTR = usSTR.replace(/webmax\/[\d\.\-]+/g, '');
			const cleanUserAgent = usSTR;
			app.userAgentFallback = cleanUserAgent;

			setTimeout(() => {
				this.window.focus();
				this.focused = true;
			}, 200);
		});//*/

		///////////////////////////////////////////////
		// костыль, для скачивания видео для костыля, который не отправит ссылку в браузер
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
					shell.showItemInFolder(savePath);
				});
			} else {
				item.cancel();
			}
		});
	}
	

	public init() {
		electronApp.setAppUserModelId("ru.oneme.electron");
		/////////////////////
		// capture display
/*		session.defaultSession.setDisplayMediaRequestHandler(
			(_, callback) => {
				desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
					callback({ video: sources[0], audio: "loopback" });
				});
			}
//			, { useSystemPicker: true }
		);//*/

	// без этого аудиосообщения не воспроизводятся
	session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
		const allowedPermissions = ['media', 'audioCapture']; 
		if (allowedPermissions.includes(permission)) {
			callback(true); 
		} else {
			callback(false);
		}
	});

	/////////////////////


		this.makeLinksOpenInBrowser();
		this.registerListeners();

		this.window.setMenu(null);

		this.window.loadURL('https://web.max.ru/', {
			extraHeaders: "pragma: no-cache\n"
		});

		this.moduleManager.beforeLoad();
		this.moduleManager.onLoad();



		this.window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
			if (permission === 'fullscreen') {
				return callback(true);
			}
			callback(false);
		});


		///////////////////////////////////////////////
		// полная  блокировка  видеоплеера  в  MAX,
		// слишком радикально,  но  оно   сработало
		// (добавил чекБокс в окошко "О Программе")
		// -- уже неактуально, можно убрать --
		if (this.blockAudVid) 
		{//*
			this.window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
				callback({
					responseHeaders: {
						...details.responseHeaders,
						// запрещаем ВСЁ медиа, включая аудиосообщения
						'Content-Security-Policy': ["media-src 'none'"]
					}
				});
			});//*/
		} 
		///////////////////////////////////////////////

		// так у официалов, вероятно, для открытия ссылок
		// вида "max://" внутри приложения
		app.setAsDefaultProtocolClient("max");

		this.window.show();
		this.focused = true;
	}

	public reload() {
		this.window.webContents.reloadIgnoringCache();
	}

	public quit() {
		this.quitting = true;
		this.moduleManager.onQuit();
		app.quit();
	}
	

	// если контент - видео или изображение, то попытаемся сохранить,
	// в противном случае:  если  протокол https - открываем ссылку в
	// браузере; в худшем - просто блокируем
	private makeLinksOpenInBrowser() {
		this.window.webContents.setWindowOpenHandler((details) => {
		const url = details.url;
		try {
			const parsed = new URL(url);
			// костыль при попытке скачать видосик - если не проверить,
			// ссылка откроется в браузере, иначе - можно скачать видео
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

		///////////////////////////////////////////////
	}

	private registerListeners() {
		app.on('second-instance', () => {
			this.window.show();
			this.window.focus();
			this.focused = true;
		});

		this.window.webContents.on('enter-html-full-screen', () => {
			this.window.setFullScreen(true);
		});

		this.window.webContents.on('leave-html-full-screen', () => {
			this.window.setFullScreen(false);
		});//*/

		ipcMain.handle("notify-click", async () => {
			!this.window.isVisible() && this.window.show();
			if (this.window.isMinimized()) {
				this.window.restore();
			}
			this.window.show();
			this.window.focus();
			this.focused = true;
		});

		app.on('will-quit', () => {
			// принудительно убиваем процесс
			// топорно, но действенно... =)
			process.exit(0); 
		});

		///////////////////////////////////////////////

		// спиздил из официальной махи и подогнал под свои нужды... на мой взгляд,
		// всё можно сделать проще, но пусть будет "как у них" дабы избежать проб-
		// лем с совместимостью... (на досуге подумаем, как подправить интереснее)
		ipcMain.handle("download-file", async (_, { url, fileId, messageId, chatId, fileName }) => {
			function createKey(id, messageId, chatId) {
				return `${id}_${messageId}_${chatId}`;
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
				function handleCancel(event, cancel) {
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

