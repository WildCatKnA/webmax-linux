import { app, session, desktopCapturer, BrowserWindow, nativeImage, nativeTheme, ipcMain, shell } from "electron";
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
let pickerWin: BrowserWindow | null = null;
let viewerWin: BrowserWindow | null = null;

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
			backgroundColor: nativeTheme.shouldUseDarkColors ? "#25262d" : "#ffffff",
			show: false,
			autoHideMenuBar: true,

			// настройки кастомного бара:
/*			titleBarStyle: 'hidden',
			titleBarOverlay: {
				color: '#1a1a1a',       // фон области кнопок
				symbolColor: '#ffffff', // кнопки (свернуть, закрыть)
				height: 40              // высота области кнопок
			},//*/

			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				spellcheck: false,
//				autoplayPolicy: 'user-gesture-required',
				contextIsolation: true, // if false - native Notification override in preload 
				sandbox: false
			}
		});
//		this.window.loadFile(path.join(__dirname, 'index.html'));
//		this.window.loadFile('index.html');

//		this.window.webContents.openDevTools(); // для отладки

		// костыль в виде CSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары
		// поверх мах-интерфейсовых)
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
//		app.setAppUserModelId('webmax');
		app.setAppUserModelId('ru.oneme.electron'); // прикинемся "ветошью"
		app.setAsDefaultProtocolClient("max");

		///////////////////////////////////////////////
		// убираем electron и наше  приложение из UserAgent
		// (прикидываемся "ветошью", т.е. мы - а-ля Chrome)
		// надо оно или нет? хз
		/*
		const defaultUserAgent = new BrowserWindow({ show: false }).webContents.getUserAgent();
		let usSTR = defaultUserAgent.replace(/Electron\/[\d.]+\s/, '');  
		usSTR = usSTR.replace(/webmax\/[\d\.\-]+/g, '');
		const cleanUserAgent = usSTR;
		app.userAgentFallback = cleanUserAgent;//*/

		///////////////////////////////////////////////
		// уведомления, доступ к медиа и микрофону, если возможно, и прочее
		// types 'geolocation' | 'unknown' | 'clipboard-read' | 'clipboard-sanitized-write' |
		// 'display-capture' | 'mediaKeySystem' | 'midi' | 'midiSysex' | 'pointerLock' | 'fullscreen' |
		// 'openExternal' | 'window-placement' | 'audioCapture' 
		session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
			const allowedPermissions = ['fullscreen', 'notifications', 'media', 'audioCapture', 'clipboard-read', 'clipboard-sanitized-write']; 
			if (allowedPermissions.includes(permission)) {
				callback(true); 
			} else {
				callback(false);
			}
		});

		///////////////////////////////////////////////
		// пробуем выбрать, что будем транслировать...
		// (плюс файлы picker.html, picker.js и доп.код в preload)
		session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
		let myScheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
			desktopCapturer.getSources({ 
				types: ['screen', 'window'],
				fetchWindowIcons: true, 
				thumbnailSize: { width: 300, height: 200 } 
			}).then(async (sources) => {

				const colorScheme = await this.window.webContents.executeJavaScript(
					// пытаемся понять, "темная" или "сваетлая" у нас тема...
					"document.documentElement.getAttribute('data-color-scheme')"
				).catch(() => //'dark') || 'dark'; // если ошибка - ставим dark
							// или же возьмём системную тему
							myScheme) || myScheme;

				pickerWin = new BrowserWindow({
					width: 800,
					height: 600,
					parent: this.window,
					modal: true,
					title: "MAX - источники",
					icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
					backgroundColor: colorScheme === 'dark' ? '#25262d' : '#ffffff', // Меняем фон самого окна
					autoHideMenuBar: true,
					webPreferences: {
						preload: path.join(__dirname, 'preload.js'),
						contextIsolation: true
						/*,
						// вроде не актуально, но пока оставим
						sandbox: false, // чтобы preload зацепился
						webSecurity: false // разрешаем локальный контент
						//*/
					}
				});

				//pickerWin.loadFile(path.join(__dirname, 'picker.html'));
				pickerWin.loadFile(path.join(__dirname, 'picker.html'), { query: { theme: colorScheme } });

				// готовность окна выбора
				ipcMain.once('picker-ready', () => {
					const viewSources = sources.map(s => ({
						id: s.id,
						name: s.name,
						thumbnail: s.thumbnail.toDataURL()
					}));
					pickerWin?.webContents.send('show-sources', viewSources);
				});

				// выбор пользователя
				ipcMain.once('source-selected', (_event, sourceId) => {
					if (!sourceId) {
//						callback({}); // !!!вызываем при закрытии окна, иначе ошибка
					} else {
						const selected = sources.find(s => s.id === sourceId);
						if (selected) {
							// выбранный источник
							callback({ video: selected, audio: 'loopback' });
						} else {
//							callback({}); // !!!вызываем при закрытии окна, иначе ошибка
						}
					}

					if (pickerWin) {
						pickerWin.close();
						pickerWin = null;
					}
				});

				pickerWin.on('closed', () => {
				try {
					callback({}); // !!!вот здесь и вызываем
					} catch (e) {
						// игнорируем, если callback уже был вызван ранее
					}
					ipcMain.removeAllListeners('source-selected');
					ipcMain.removeAllListeners('picker-ready');
				});
			});
		}); //*/
		///////////////////////////////////////////////
		
		this.makeLinksOpenInBrowser();
		this.registerListeners();

		this.window.setMenu(null);

		this.window.loadURL('https://web.max.ru/', {
			extraHeaders: "pragma: no-cache\n" // а оно надо?
		}); //*/

		this.moduleManager.beforeLoad();
		this.moduleManager.onLoad();
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

		///////////////////////////////////////////////
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

		this.window.on('resize', () => {
			this.moduleManager.onQuit();
		});

		this.window.on('move', () => {
			this.moduleManager.onQuit();
		});
		//*/

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

		///////////////////////////////////////////
		// махинации с просмотрщиком

		ipcMain.on('toggle-max-viewer', (event, isActive) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			if (win) {
				win.setFullScreen(isActive);
			}
		}); /*/
		///////////////////////////////////////////
/*		ipcMain.on('open-viewer', (event, { url, type }) => {
			console.info("мы в open-viewer");
			if (viewerWin && !viewerWin.isDestroyed()) {
				viewerWin.close();
			}

			viewerWin = new BrowserWindow({
				fullscreen: true,
				backgroundColor: '#000000',
				frame: false,
				transparent: false,
				webPreferences: {
					preload: path.join(__dirname, 'preload.js'),
					contextIsolation: true
				}
			});

			// HTML файл просмотрщика
			viewerWin.loadFile(path.join(__dirname, 'viewer.html'));

			viewerWin.webContents.on('did-finish-load', () => {
				viewerWin?.webContents.send('load-content', { url, type });
			});

			// закрытие по клику мимо или кнопке
			ipcMain.once('close-viewer', () => {
				viewerWin?.close();
			});
		});// */

		///////////////////////////////////////////
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
