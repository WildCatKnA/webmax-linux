import { app, session, desktopCapturer, BrowserWindow, nativeImage, net, Notification, clipboard, nativeTheme, ipcMain, shell } from "electron";
import HotkeyModule from "./module/hotkey-module";
import ModuleManager from "./module/module-manager";
import TrayModule from "./module/tray-module";
import WindowSettingsModule from "./module/window-settings-module";
import { getUnusedPath } from "./util";
//import { convertWebpToJpegInRenderer } from "./util";
import Settings from "./settings";
import { existsSync, createWriteStream, unlink } from "fs";
import Store from "electron-store";
import { get } from "https";

const store = new Store({
	name: "globalStore",
	clearInvalidConfig: true
});
///*
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
//*/

const dloadSetting = new Settings("download");
const spellSetting = new Settings("spell");

//////////////////////////////////////////////////

const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const downloadsStore = new Store();
let pickerWin: BrowserWindow | null = null;
//let viewerWin: BrowserWindow | null = null;
let isHidden = false;
let saveTimeout;
let bckGround;//: string;
//let pendingSavePath: string | null = null;
const pendingDownloads = new Map<string, string>();
//////////////////////////////////
const checkArchitecture = () => {
	const isApp32 = process.arch === 'ia32';
	const isOs64 = process.env.PROCESSOR_ARCHITEW6432 !== undefined || process.arch === 'x64' || process.env.PROCESSOR_ARCHITECTURE === 'AMD64';

	if (isApp32 && isOs64) {
		dialog.showMessageBoxSync({
			type: 'warning',
			title: 'MAX',
			message: 'Вы запустили 32-битную версию приложения на 64-битной системе.',
			detail: 'Для лучшей производительности рекомендуется использовать x64 версию.',
			buttons: ['Понятно']
        });
    }
};
////////////////////////////////

export default class MainApp {
	
	private readonly window: BrowserWindow;
	private readonly moduleManager: ModuleManager;
	public quitting = false;
	public openFldr = true;
	public spellChecking = false;
	public fullscrView = false;
	private cssKey: string | null = null;

	constructor() {
		bckGround = nativeTheme.shouldUseDarkColors ? "#25262d" : "#ffffff";
		this.window = new BrowserWindow({
			title: "MAX",
			icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
			width: 1200,
			height: 800,
			minWidth: 800,
			minHeight: 600,
			backgroundColor: bckGround,
			show: false,
			autoHideMenuBar: true,

			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				spellcheck: true, //this.spellChecking,//false,
//				autoplayPolicy: 'user-gesture-required',
				contextIsolation: true, // if false - native Notification override in preload 
				sandbox: false
			}
		});

//		this.window.webContents.openDevTools(); // для отладки

		// костыль в виде CSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары
		// поверх мах-интерфейсовых) - уже не актуально
//		if (process.versions.electron.startsWith('21.')) {
//			this.window.webContents.insertCSS('.aside, .openedChat { height: 100vh; display: flex; flex-direction: column; }  ');
//		}


////////////////////////////////////////////////////////////////////////////////
// тут пытаемся "подправить" фон в просмотрщике и прочую лабуду
this.window.webContents.insertCSS(`
*:focus { outline: none !important; box-shadow: none !important; }
//[class*="mover"] { backdrop-filter: blur(15px) saturate(140%) !important; -webkit-backdrop-filter: blur(12px) saturate(140%) !important; }
[class*="media"] { background: #000000 !important; }
[class*="videoLayer"] video { background: #000000; !important; border: none !important; }
[class*="settings"] { -webkit-user-select: none !important; user-select: none !important; }
//.navigation, aside, topbar, .openedChat { -webkit-user-select: none !important; user-select: none !important; }
.navigation, aside, topbar { -webkit-user-select: none !important; user-select: none !important; }
`).catch(err => console.error('CSS Injection failed:', err)); //*/

////////////////////////////////////////////////////////////////////////////////

		this.moduleManager = new ModuleManager([
			new HotkeyModule(this, this.window)
			, new TrayModule(this, this.window)
			, new WindowSettingsModule(this, this.window)
		]);

		this.window.on("show", () => {
		
			setTimeout(() => {
				this.window.focus();
			}, 200);
		});

		///////////////////////////////////////////////
		// костыль, для скачивания картинок/видео
		// вариант с конвертированием в .jpg
		this.window.webContents.session.on('will-download', (event, item, webContents) => {
			const url = item.getURL();
			const isWebP = item.getMimeType() === 'image/webp' || url.toLowerCase().endsWith('.webp');

			// это видео или мы уже в процессе повторной загрузки
			if (!isWebP || pendingDownloads.has(url)) {
				if (pendingDownloads.has(url)) {
					const filePath = pendingDownloads.get(url)!;
					item.setSavePath(filePath);
					pendingDownloads.delete(url);

					item.once('done', (e, state) => {
						if (state === 'completed') {
							this.window.webContents.send('dl-complete', { success: true, path: filePath });
							if (this.openFldr) shell.showItemInFolder(filePath);
						}
					});
					return;
				}
			}

			// это .webp - перехватываем процесс
			event.preventDefault(); 

			(async () => {
				const lastPath = dloadSetting.get("downloadsPath", app.getPath("downloads"));
				// меняем расширение, чтобы потом с этим не заморачиваться
				const fileName = item.getFilename().replace(/\.webp$/i, '.jpg');

				const { filePath, canceled } = await dialog.showSaveDialog(this.window, {
					title: 'Сохранить файл',
					defaultPath: path.join(lastPath, fileName)
				});

				if (canceled || !filePath) return;
				if (!isWebP) {
					dloadSetting.set("downloadsPath", path.dirname(filePath));
					pendingDownloads.set(url, filePath);
					this.window.webContents.session.downloadURL(url);
				} else {
					try {
						// грузим и конвертим прямо в renderer через canvas
						const base64Jpg = await webContents.executeJavaScript(`
							fetch("${url}").then(r => r.blob()).then(blob => {
								return new Promise((resolve) => {
									const img = new Image();
									img.onload = () => {
										const canvas = document.createElement('canvas');
										canvas.width = img.width;
										canvas.height = img.height;
										const ctx = canvas.getContext('2d');
										ctx.fillStyle = 'white';
										ctx.fillRect(0, 0, canvas.width, canvas.height);
										ctx.drawImage(img, 0, 0);
										resolve(canvas.toDataURL('image/jpeg', 0.9));
									};
									img.src = URL.createObjectURL(blob);
								});
							})
						`);

						const base64Data = base64Jpg.split(';base64,').pop();
						const buffer = Buffer.from(base64Data, 'base64') as Buffer;

						// и пишем напрямую
						fs.writeFileSync(filePath, buffer);

						dloadSetting.set("downloadsPath", path.dirname(filePath));
						this.window.webContents.send('dl-complete', { success: true, path: filePath });
						if (this.openFldr) shell.showItemInFolder(filePath);

					} catch (err) {
						// если всё совсем плохо, скачиваем как есть
						console.log("ошибка конвертации:", err);
						pendingDownloads.set(url, filePath);
						this.window.webContents.session.downloadURL(url);
					}
				}
			})();
		}); // */

		////////////////////////////////////////////////////////////////////
		// этот вариант просто сохраняет .webp без конвертирования или видео
/*
		this.window.webContents.session.on('will-download', (event, item, webContents) => {
			const url = item.getURL();

			// этот URL в списке выбранных?
			if (pendingDownloads.has(url)) {
				const filePath = pendingDownloads.get(url)!;
				item.setSavePath(filePath);
				pendingDownloads.delete(url); // удаляем из очереди

				item.once('done', (e, state) => {
					if (state === 'completed') {
						this.window.webContents.send('dl-complete', { success: true, path: filePath });
						if (this.openFldr) shell.showItemInFolder(filePath);
					}
				});
				return; 
			}

			// диалога "Сохранить файл" еще не было
			event.preventDefault(); 
			const fileName = item.getFilename();

			(async () => {
				const lastPath = dloadSetting.get("downloadsPath", app.getPath("downloads"));
				const { filePath, canceled } = await dialog.showSaveDialog(this.window, {
//					icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
					title: 'Сохранить файл',
					defaultPath: path.join(lastPath, fileName)
				});

				if (canceled || !filePath) return;

				// Запоминаем путь
				pendingDownloads.set(url, filePath);
				dloadSetting.set("downloadsPath", path.dirname(filePath));

				// перезапуск загрузки, для видео лучше метод session
				this.window.webContents.session.downloadURL(url);
			})();
		}); //*/
		//////

	}
	
	public init() {
		// закомментировать - уведомления могут не работать
		app.setAppUserModelId('WebMax Desktop'); 

		// чтоб не создавался ключ в реестре
		// (HKEY_CURRENT_USER\Software\Classes\max),
		// закомментируем сей параметр:
//		app.setAsDefaultProtocolClient("max");

		// с этим - не создаёт GPU-кэш в реестре и на диске
		// (но, судя по названию, вырубит аппаратное ускорение)
//		app.disableHardwareAcceleration(); 

		// запретить автозагрузку
		app.setLoginItemSettings({ openAtLogin: false });

		///////////////////////////////////////////////
		// уведомления, доступ к медиа и микрофону, если возможно, и прочее
		// types 'geolocation' | 'unknown' | 'clipboard-read' | 'clipboard-sanitized-write' |
		// 'display-capture' | 'mediaKeySystem' | 'midi' | 'midiSysex' | 'pointerLock' | 'fullscreen' |
		// 'openExternal' | 'window-placement' | 'audioCapture' 

//		this.spellChecking = process.argv.some(arg => arg.toLowerCase() === '--spellcheck');
		this.spellChecking = spellSetting.get("spellCheck", false);
		if (this.spellChecking === true) {
//			session.defaultSession.setSpellCheckerLanguages(['ru-RU', 'en-US']);
//			session.defaultSession.setSpellCheckerEnabled(this.spellChecking);
			this.window.webContents.session.setSpellCheckerLanguages(['ru-RU', 'en-US']);
			this.window.webContents.session.setSpellCheckerEnabled(this.spellChecking);
//			this.window.webContents.session.invalidateServiceWorkers();
		}
		const notify = new Notification({
			title: 'MAX',
			body: `Проверка орфографии ${this.spellChecking ? 'включена' : 'выключена'}.`,
			icon: path.join(app.getAppPath(), "assets/", this.spellChecking ? "spell-on.png":"spell-off.png"),
			silent: true,
		});
		notify.on('click', () => {
			if (!this.window.isVisible()) this.window.show();
			if (this.window.isMinimized()) this.window.restore();
			this.window.focus();
		});
		notify.show();

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
//						callback({}); // !!!вызываем при закрытии окна, не сейчас! иначе ошибка
					} else {
						const selected = sources.find(s => s.id === sourceId);
						if (selected) {
							// выбранный источник
							callback({ video: selected, audio: 'loopback' });
						} else {
//							callback({}); // !!!вызываем при закрытии окна, не сейчас! иначе ошибка
						}
					}

					if (pickerWin) {
						pickerWin.close();
						pickerWin = null;
					}
				});

				pickerWin.on('closed', () => {
				try {
					callback({}); // !!!вот теперь здесь и вызываем
					} catch (e) {
						// игнорируем, если callback уже был вызван ранее
					}
					ipcMain.removeAllListeners('source-selected');
					ipcMain.removeAllListeners('picker-ready');
				});
			});
		}); //*/
		///////////////////////////////////////////////
		if (process.platform === 'win32') { checkArchitecture(); }
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

		//isHidden = process.argv.includes('--hidden');
		isHidden = process.argv.some(arg => arg.toLowerCase() === '--hidden');
		if (!isHidden) this.window.show();

	}

	public reload() {
		this.window.webContents.reloadIgnoringCache();
	}

	public quit() {
		spellSetting.set("spellCheck", this.spellChecking);
		this.quitting = true;
		this.moduleManager.onQuit();
		app.quit();
	}

	public saveWinState() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
       		this.moduleManager.onQuit();
		}, 500);
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

		///////////////////////////////////////////
		// подчищаем за собой в Windows/StartMenu
		// (пытаемся удалить ярлык для уведомлений)
		app.on('will-quit', () => {
			if (process.platform === 'win32') {
				const shortcutName = `${app.name}.lnk`; 
				const shortcutPath = path.join(
					process.env.APPDATA || '', 
					'..', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs',  shortcutName
				);

				if (fs.existsSync(shortcutPath)) {
					try {
						fs.unlinkSync(shortcutPath);
					} catch (e) {
						console.error("Не удалось подчистить ярлык", e);
					}
				}
			}
		});


		this.window.webContents.on('enter-html-full-screen', () => {
			this.window.setFullScreen(true);
		});

		this.window.webContents.on('leave-html-full-screen', () => {
			this.window.setFullScreen(false);
		});//*/

		this.window.on('resize', () => {
			//this.moduleManager.onQuit();
			this.saveWinState();
		});

		this.window.on('move', () => {
			//this.moduleManager.onQuit();
			this.saveWinState();
		});
		// */

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

		////////////////////////////////////////
		// сворачиваемся по Esc, если чат закрыт
		ipcMain.on('hide-by-esc', (event) => {
			event.preventDefault(); // чтобы не выполнялись иные действия, проигнорим их
			this.window.hide();
		});

		///////////////////////////////////////////
		// махинации с просмотрщиком
		ipcMain.on('toggle-max-viewer', (event, isActive) => {
//			console.log('toggle-max-viewer');
			if (process.platform !== 'darwin' && this.fullscrView) {
				const win = BrowserWindow.fromWebContents(event.sender);
				if (win) {
					win.setFullScreen(isActive);
				}
			}
		}); // */
		//////////////////////////////////////////////////////////
		

		//////////////////////////////////////////////////////////
		// копирование картинки по нажатию ПКМ (до появления меню)
		ipcMain.on('copy-data-url-to-clipboard', (event, dataUrl: string) => {
			const image = nativeImage.createFromDataURL(dataUrl);
			if (!image.isEmpty()) {
				clipboard.writeImage(image);
			}
		});//*/

		///////////////////////////////////////////
		// допиливаем вставку через меню web.max.ru
		// (через меню не вставлялись картинки)
		ipcMain.on('force-ctrl-v', (event) => {
			const wc = event.sender;
			const modifier = process.platform === 'darwin' ? 'meta' : 'control';

			setTimeout(() => {
				// тупо имитируем Ctrl+V (или Meta+V для mac)
				wc.sendInputEvent({ type: 'keyDown', modifiers: [modifier], keyCode: 'v' });
				wc.sendInputEvent({ type: 'char', modifiers: [modifier], keyCode: 'v' });
				wc.sendInputEvent({ type: 'keyUp', modifiers: [modifier], keyCode: 'v' });
			}, 50); 
		}); //*/

		///////////////////////////////////////////
		// спиздил из официальной махи и подогнал под свои нужды...
		// но, на мой взгляд, всё можно сделать проще, но и это работает
		ipcMain.handle("download-file", async (_, { url, fileId, messageId, chatId, fileName }) => {
			function createKey(id, messageId2, chatId2) {
				return `${id}_${messageId2}_${chatId2}`;
			}

//			dialog.showMessageBox({message: url});
			////////////
			// диалог перед началом загрузки
			const lastPath = dloadSetting.get("downloadsPath", app.getPath("downloads"));

			const { filePath, canceled } = await dialog.showSaveDialog({
//				icon: path.join(app.getAppPath(), "assets/", process.platform === 'win32' ? "app.ico":"mainapp.png"),
				title: 'Сохранить файл',
				defaultPath: path.join(lastPath, fileName)
			});

			if (canceled || !filePath) {
				return { success: false, message: "Отменено пользователем" };
			}

			const folderPath = path.dirname(filePath);
			dloadSetting.set("downloadsPath", folderPath);
			////////////

			const storeKey = createKey(fileId, messageId, chatId);
			return new Promise((resolve, reject) => {
				let canceled = false;

				// если диалог не нужен - используем это
//				const downloadPath = app.getPath("downloads");
//				const filePath = path.join(downloadPath, fileName);

/*				const exists = existsSync(filePath);
				if (filePath && exists) {
					if (this.openFldr) { shell.showItemInFolder(filePath); }
					resolve({ success: true, filePath: filePath });
					return;
				}//*/

//				let finalFilePath = getUnusedPath(filePath);
				let finalFilePath = filePath;
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
