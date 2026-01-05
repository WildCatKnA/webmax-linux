import { BrowserWindow, Menu, MenuItem, Tray, Notification } from "electron";
import { /*findIcon,*/ getUnreadMessages } from "../util";

const { dialog } = require('electron');

import path from "path";
import MainApp from "../mainapp";
import Module from "./module";

const ICON = path.join("./assets/", process.platform === 'win32' ? "mainapp.ico" : "mainapp.png");
const ICON_UNREAD = path.join("./assets/", process.platform === 'win32' ? "mainapp-unread.ico" : "mainapp-unread.png");
const ICON_ABOUT = path.join("./assets/", "maxlogo.png");

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
//		this.createMenu();
		this.registerListeners();
	}


	private createMenu() {
		const menu = Menu.buildFromTemplate([
			{
				label: "Показать/Cкрыть",
				click: () => this.onClickShowHide()
			},

			{
				type: 'separator'
			},

			{
				label: "О программе",
				click: () => {
					///////////////////
					const about = dialog.showMessageBox(this.window, {
						icon: ICON_ABOUT,
						buttons: ['OK'],
						title: 'О программе...',
						message: 'WebMax v.1.0.1-1 / Electron v21.0.1',
						detail:  'Неофициальное приложение <MAX>\nдля Linux-x64 или Windows-x64\n\nCopyright (C) 2026, WildCat/KnA',
					});
					///////////////////
				}
			},

			{
				type: 'separator'
			},

			{
				label: "Выход",
				click: () => this.MainApp.quit()
			}
		]);

		this.tray.setContextMenu(menu);

		this.tray.on("click", () => {
			if (!this.window.isVisible()) {
				this.window.show();
				this.window.focus();
			} else if (this.window.isMinimized()) {
				this.window.restore();
				this.window.focus();
			} else this.window.hide();
		});
		
	}

	private onClickShowHide() {
		if (this.window.isMinimized()) {
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
				this.tray.setToolTip("MAX" + title);
			}
			else this.tray.setToolTip("MAX");

			this.tray.setImage(unread == 0 ? ICON : ICON_UNREAD);

			/* //////////////
			if (unread !=0 && Notification.isSupported()) {
				const notify = new Notification({
					title: 'MAX',
					//subtitle: title,
					body: title,
					icon: ICON_UNREAD, // Путь к иконке
					silent: false,     // Звуковой сигнал
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
