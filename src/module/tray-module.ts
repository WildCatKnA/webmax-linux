import { app, BrowserWindow, Menu, MenuItem, Tray, Notification, ipcMain } from "electron";
import { getUnreadMessages, createBadgeIcon } from "../util";

const { dialog, nativeImage } = require('electron');

import path from "path";
import MainApp from "../mainapp";
import Module from "./module";

const ICON        = path.join("./assets/", "mainapp.png");
const ICON_UNREAD = path.join("./assets/", "mainapp-unread.png");
const OVERLAY     = path.join("./assets/", "overlay.png");
const ICON_ABOUT  = path.join("./assets/", "app.png");
const MENU_HIDE   = path.join("./assets/", "hide.png");
const MENU_ABOUT  = path.join("./assets/", "about.png");
const MENU_QUIT   = path.join("./assets/", "quit.png");

let unread = 0;

export default class TrayModule extends Module {

	private readonly tray: Tray;

	constructor(
		private readonly MainApp: MainApp,
		private readonly window: BrowserWindow
	) {
		super();
		this.tray = new Tray(ICON);
		this.createMenu();
		this.tray.setToolTip("MAX");
	}

	public override onLoad() {
//		this.createMenu(); // переместил в constructor
		this.registerListeners();
	}


	private createMenu() {
//	const i_hide = nativeImage.createFromPath(MENU_HIDE);
		const menu = Menu.buildFromTemplate([
			{
				label: "Показать/Cкрыть",
				icon: MENU_HIDE,
				click: () => this.onClickShowHide()
			},

			{
				type: 'separator'
			},

			{
				label: "О программе",
				icon: MENU_ABOUT,
				click: () => {
					///////////////////
					let ver = app.getVersion();
					const about = dialog.showMessageBox(this.window, {
						icon: ICON_ABOUT,
						buttons: ['OK'],
						title: 'О программе...',
						message: 'WebMax v.'+ver + '/ Electron v.' + process.versions.electron,
						detail:  'Неофициальное приложение <MAX>\nдля Linux x64 или Windows-7 x64\n\nCopyright (C) 2026, WildCat/KnA',
					});
					///////////////////
				}
			},

			{
				type: 'separator'
			},

			{
				label: "Выход",
				icon: MENU_QUIT,
				click: () => this.MainApp.quit()
			}
		]);

		this.tray.setContextMenu(menu);

		this.tray.on("click", (event, bounds) => {
			this.onClickShowHide();
		});

	}

	private onClickShowHide() {
		if (!this.window.isVisible()) {
			this.window.show();
			this.window.focus();
		} else if (this.window.isMinimized()) {
			this.window.restore();
			this.window.focus();
		}
		else if (this.window.isVisible()) {
			this.window.hide();
		}
		else {
			this.window.show();
			this.window.focus();
		}
	}

	private registerListeners() {
		this.window.on("close", event => {
			if (this.MainApp.quitting) return;

			event.preventDefault();
			this.window.hide();
		});

		this.window.webContents.on("page-title-updated", (_event, title, explicitSet) => {
			if (!explicitSet) return;

			unread = getUnreadMessages(title);
			this.window.setTitle(title);

			if (unread != 0) {
				//imm = new NativeImage();

/*				try{
					createBadgeIcon(unread, this.tray);
				} catch (error) {
					console.error(error);
//					this.tray.setImage(ICON_UNREAD);
				}//*/

//				imm = nativeImage.createFromDataURL(createBadgeIcon(unread));// nativeImage.createFromDataURL(createBadgeIcon(unread));
				this.tray.setToolTip(title + " - MAX");

				if (process.platform === 'win32') {
					this.window.setOverlayIcon(nativeImage.createFromPath(OVERLAY), ''+unread);
				}

				if (process.platform === 'darwin') {
					app.dock.setBadge(String(unread));
				}
			}
			else {
				this.tray.setImage(ICON);
				this.tray.setToolTip("MAX");
				if (process.platform === 'darwin') {
					app.dock.setBadge('');
				}
			}
			this.tray.setImage(unread == 0 ? ICON : ICON_UNREAD);

			/* //////////////
			// уведомление о кол-ве непочитанных
			// пока убрал, чтобы не мешалось, кому надо - раскомментируйте
			
			if (unread !=0 && Notification.isSupported()) {
				const notify = new Notification({
					title: 'MAX',
					//subtitle: title,
					body: title,
					icon: ICON_UNREAD,
					silent: true,
				});

				// Обработка клика по уведомлению
				notify.on('click', () => {
					if (!this.window.isVisible()) this.window.show();
					if (this.window.isMinimized()) this.window.restore();
					this.window.focus();
				});
				notify.show();
			}
			////////////// */
		});
//		ipcMain.on('png-finished', (event, dataUrl) => {
//			const icon = nativeImage.createFromDataURL(dataUrl);
//			this.tray.setImage(icon);
//			console.log('SVG успешно превращен в PNG и установлен в трей');
//    });
	}
};
