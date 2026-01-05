import { app, desktopCapturer, BrowserWindow, ipcMain, shell } from "electron";
import ChromeVersionFix from "./fix/chrome-version-fix";
import Electron21Fix from "./fix/electron-21-fix";
import HotkeyModule from "./module/hotkey-module";
import ModuleManager from "./module/module-manager";
import TrayModule from "./module/tray-module";
import WindowSettingsModule from "./module/window-settings-module";


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

//const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.9999.0 Safari/537.36";

function getUnusedPath(filePath) {
	// такого файла нет, возвращаем исходный путь
	if (!fs.existsSync(filePath)) return filePath;

	const dir = path.dirname(filePath);
	const ext = path.extname(filePath);
	const name = path.basename(filePath, ext);
	let counter = 1;

	// найдем свободное имя: name (1).ext, name (2).ext ...
	while (fs.existsSync(path.join(dir, `${name} (${counter})${ext}`))) {
		counter++;
	}

	return path.join(dir, `${name} (${counter})${ext}`);
}

export default class MainApp {
	
	private readonly window: BrowserWindow;
	private readonly moduleManager: ModuleManager;
	public quitting = false;

	constructor() {
		this.window = new BrowserWindow({
			title: "MAX",
			icon: path.join("./assets/", process.platform === 'win32' ? "mainapp.ico":"mainapp.png"),
			width: 1200,
			height: 800,
			minWidth: 600,
			minHeight: 400,
			backgroundColor: "#25262d",
//			useContentSize: true,//false
			show: false,
			autoHideMenuBar: true,
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				spellcheck: false,

				// autoplayPolicy не срабатывает, но, один хер, оставим))
				autoplayPolicy: 'document-user-activation-required', //'user-gesture-required',
				contextIsolation: true//false//, // native Notification override in preload :(
			}
		});

		// костыль в видеCSS-кода для  НОРМАЛЬНОГО выравнивания содержимого по высоте окна от криворучек, выдумавших маху
		// (видимо, electron-21 и ниже криво обрабатывают сие безарбузие,  рисуя скроллбары поверх махо-интерфейсовых
		this.window.webContents.insertCSS('.aside, .openedChat { height: 100vh; display: flex; flex-direction: column; }  ');

		this.moduleManager = new ModuleManager([
			new Electron21Fix(),
			new HotkeyModule(this, this.window),
			new TrayModule(this, this.window),
			new WindowSettingsModule(this, this.window),
			new ChromeVersionFix(this)
		]);

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

		///////////////////////////////////////////////
		this.window.on("ready-to-show", () => {
			this.window.show();
		});
		///////////////////////////////////////////////
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
		app.setAsDefaultProtocolClient("max");

	}

	public reload() {
		this.window.webContents.reloadIgnoringCache();
	}

	public quit() {
		this.quitting = true;
		this.moduleManager.onQuit();
		app.quit();
	}
	
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
	}
};
