import { app, BrowserWindow, Menu, MenuItem, Tray, Notification, /*ipcMain*/ } from "electron";
import { getUnreadMessages, getMyOSVersion } from "../util";

const { dialog, nativeImage } = require('electron');

import path from "path";
import MainApp from "../mainapp";
import Module from "./module";

const ICON        = path.join(app.getAppPath(), "assets/", process.platform === 'darwin'? "mainapp_16.png" : "mainapp.png");
const ICON_UNREAD = path.join(app.getAppPath(), "assets/", process.platform === 'darwin'? "mainapp-unread_16.png" : "mainapp-unread.png");
const OVERLAY     = path.join(app.getAppPath(), "assets/", "overlay.png");
const ICON_ABOUT  = path.join(app.getAppPath(), "assets/", /*process.platform === 'win32'? "applogo.ico" :*/ "applogo.png");
const MENU_HIDE   = path.join(app.getAppPath(), "assets/", "hide.png");
const MENU_ABOUT  = path.join(app.getAppPath(), "assets/", "about.png");
const MENU_ZOOM   = path.join(app.getAppPath(), "assets/", "zoom.png");
const MENU_ZOOM_P = path.join(app.getAppPath(), "assets/", "zoom-plus.png");
const MENU_ZOOM_M = path.join(app.getAppPath(), "assets/", "zoom-minus.png");
const MENU_QUIT   = path.join(app.getAppPath(), "assets/", "quit.png");
const ttMAX		  = "MAX";

let unread = 0;

export default class TrayModule extends Module {

	private readonly tray: Tray;

	constructor(
		private readonly MainApp: MainApp,
		private readonly window: BrowserWindow
	) {
		super();
		this.tray = new Tray(ICON);

		const menu = Menu.buildFromTemplate([
			{
				label: "Показать/Cкрыть",
				icon: MENU_HIDE,
				click: () => this.onClickShowHide()
			},

			{ type: 'separator' },

			{
				label: "Масштаб",
				icon: MENU_ZOOM,
				submenu: [
					{
						label: "Увеличить",
						icon: MENU_ZOOM_P,
						click: () => {
							if (this.window.webContents.getZoomFactor() < 3)
								this.window.webContents.zoomLevel += 1
						}
					},

					{
						label: "Уменьшить",
						icon: MENU_ZOOM_M,
						click: () => {
							if (this.window.webContents.getZoomFactor() > 0.5)
								this.window.webContents.zoomLevel -= 1
						}
					},

					{ type: 'separator' },

					{
						label: "По умолчанию",
						icon: MENU_ZOOM,
						click: () => {
							this.window.webContents.setZoomLevel(0)
						}
					}
				]
			},

			{ type: 'separator' },

			{
				label: "О программе",
				icon: MENU_ABOUT,
				click: () => {
					this.showAboutDlg()
				}
			},

			{ type: 'separator' },

			{
				label: "Выход",
				icon: MENU_QUIT,
				click: () => this.MainApp.quit()
			}
		]);

		this.tray.setContextMenu(menu);
		this.tray.setToolTip(ttMAX);
		this.tray.on("click", (/*event, bounds*/) => {
			if (process.platform !== 'darwin') { this.onClickShowHide(); }
		});
		this.tray.on('right-click', () => {
			this.tray.setContextMenu(menu);
			this.tray.popUpContextMenu(menu);
		});	
	}

	public override onLoad() {
		this.registerListeners();
	}

////////////////////////////////////////////////////////////////////////////////

	private onClickShowHide() {
		if (!this.window.isVisible()) {
			this.window.show();
			this.window.focus();
		} else if (this.window.isMinimized()) {
			this.window.restore();
			this.window.focus();
		}
		else if (this.window.isVisible()) {
			// в Windows при клике на трей-иконку фокус окна теряется, в Linux - нет
			if(process.platform === 'linux' /*this.MainApp.focused*/ && !this.window.isFocused()) {
				this.window.focus();
			} else {
				this.window.hide();
			}
		}
		else {
			this.window.show();
			this.window.focus();
		}
	}

	private showAboutDlg() {
		let appArch = process.arch;
		if (appArch === 'ia32') appArch='x86';
		const about = dialog.showMessageBox(this.window, {
			icon: ICON_ABOUT,
			buttons: ['OK'],
			title:  'О программе...',
			message:'WebMax v.'+ app.getVersion() + ' (' + appArch + ') / Electron v.' + process.versions.electron
			,
			detail:
					'OS: ' + getMyOSVersion()
					+ (process.platform === 'linux'? '\nDesktop: ' + process.env.XDG_SESSION_TYPE + '/' + process.env.XDG_CURRENT_DESKTOP: '')
					+'\n\n'+
//					'UA: ' + session.defaultSession.getUserAgent() + '\n\n' +
					'Неофициальное приложение MAX\n'+
					'для Linux x64, Windows-7 и выше (32/64),\n'+
					'или Mac OS 10.15 и выше.\n\n'+
					'Copyright © 2023, Alberto Mimbrero\n'+
					'Copyright © 2026, WildCat/KnA\n\n'
//					+'https://github.com/WildCatKnA/webmax-linux/releases'
			,checkboxLabel: 'Показать папку с файлом после загрузки',
			checkboxChecked: this.MainApp.openFldr
		}).then(result => {
			this.MainApp.openFldr = result.checkboxChecked;
		});
	}
////////////////////////////////////////////////////////////////////////////////

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

			if (unread !== 0) { // или таки >0 ?
				this.tray.setToolTip(title + " - MAX");
				this.tray.setImage(ICON_UNREAD);
				if (process.platform === 'win32') {
					this.window.setOverlayIcon(nativeImage.createFromPath(OVERLAY), title);

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

				if (process.platform === 'win32') {
					this.window.setOverlayIcon(null, '');
				}

			}
//			this.tray.setImage(unread > 0 ? ICON_UNREAD : ICON);

			/* //////////////
			// уведомление о кол-ве непочитанных
			// пока убрал, чтобы не мешалось...
			// кому надо - раскомментируйте,
			// только не забудьте раскомметнтировать
			// Notification в первой строке
			
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

	}
};
