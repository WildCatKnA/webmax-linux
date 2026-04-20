import { app, screen, BrowserWindow, Menu, MenuItem, Tray, Notification, /*ipcMain*/ } from "electron";
import { getUnreadMessages, getMyOSVersion } from "../util";

const { dialog, nativeImage } = require('electron');
//import sharp from 'sharp';
import fs from 'fs';
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

const FONT_ZOOM   = path.join(app.getAppPath(), "assets/", "font.png");
const FONT_ZOOM_P = path.join(app.getAppPath(), "assets/", "font-plus.png");
const FONT_ZOOM_M = path.join(app.getAppPath(), "assets/", "font-minus.png");

const SPELL_ON    = path.join(app.getAppPath(), "assets/", "spell-on.png");
const SPELL_OFF   = path.join(app.getAppPath(), "assets/", "spell-off.png");

const MENU_QUIT   = path.join(app.getAppPath(), "assets/", "quit.png");
const TRAY_SVG    = path.join(app.getAppPath(), "assets/", "_MAX032_unread.svg");
const OVER_SVG    = path.join(app.getAppPath(), "assets/", "overlay-v2.svg");
const ttMAX		  = "MAX";

let unread = 0;


export default class TrayModule extends Module {

	private readonly tray: Tray;
	private lastCount = 0;
	private svgTemplate: string;
	private svgOverlay: string;
	private worker: BrowserWindow;

	constructor(
		private readonly MainApp: MainApp,
		private readonly window: BrowserWindow
	) {
		super();
		this.tray = new Tray(ICON);
		this.svgTemplate = fs.readFileSync(TRAY_SVG, 'utf8');
		this.svgOverlay = fs.readFileSync(OVER_SVG, 'utf8');

		this.worker = new BrowserWindow({
			show: false,
			webPreferences: { offscreen: true }
		});
		this.worker.loadURL('about:blank');

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
				label: "Шрифт",
				icon: FONT_ZOOM,
				submenu: [
					{
						label: "Увеличить",
						icon: FONT_ZOOM_P,
						click: () => {
							this.window.webContents.send('change-font-size', 'up');
						}
					},

					{
						label: "Уменьшить",
						icon: FONT_ZOOM_M,
						click: () => {
							this.window.webContents.send('change-font-size', 'down');
						}
					},

					{ type: 'separator' },

					{
						label: "По умолчанию",
						icon: FONT_ZOOM,
						click: () => {
							this.window.webContents.send('change-font-size', 'reset');
						}
					}
				]
			},


			{ type: 'separator' },

			{
				id: 'spellcheck',
				label: "Проверка орфографии",
//				type: 'checkbox',
				icon: SPELL_ON,
				checked: this.MainApp.spellChecking,
				click: () => {
					const item = menu.getMenuItemById('spellcheck');
//					this.MainApp.spellChecking = item.checked;
					this.MainApp.spellChecking = !this.MainApp.spellChecking;
					this.window.webContents.session.setSpellCheckerEnabled(this.MainApp.spellChecking);
//					this.window.webContents.invalidateServiceWorkers();

					const notify = new Notification({
						title: 'MAX',
						body: `Проверка орфографии ${this.MainApp.spellChecking ? 'включена' : 'выключена'}.`,
						icon: path.join(this.MainApp.spellChecking ? SPELL_ON : SPELL_OFF),
						silent: true,
					});
					notify.on('click', () => {
						if (!this.window.isVisible()) this.window.show();
						if (this.window.isMinimized()) this.window.restore();
						this.window.focus();
					});
					notify.show();
					console.log(`spellcheck: ${this.MainApp.spellChecking ? 'on' : 'off'}`);
				}
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

		if (process.platform === 'darwin') {
			const mainMenu = Menu.buildFromTemplate([ 
				{
					label: app.name,
					submenu: menu
				}
			]);
			//this.window.
			Menu.setApplicationMenu(mainMenu);
		}

		if (process.platform !== 'darwin') {
			this.tray.setContextMenu(menu);
		}

		this.tray.setToolTip(ttMAX);
		this.tray.on("click", (/*event, bounds*/) => {
//			if (process.platform !== 'darwin') { this.onClickShowHide(); }
			this.onClickShowHide();
		});
		if (process.platform !== 'darwin') {
			this.tray.on('right-click', () => {
				this.tray.setContextMenu(menu);
				this.tray.popUpContextMenu(menu);
			});
		}
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
		let appArch = (process.arch === 'ia32' ? 'x86' : process.arch);
//		if (appArch === 'ia32') appArch='x86';
		const about = dialog.showMessageBox(this.window, {
			icon: ICON_ABOUT,
			buttons: ['OK'],
			title:  'О программе...',
			message:'WebMax v.'+ app.getVersion() + ' (' + appArch + ') / Electron v.' + process.versions.electron
			,
			detail:
					'OS: ' + getMyOSVersion()
					+ (process.platform === 'linux'? '\nDesktop: ' + process.env.XDG_SESSION_TYPE + '/' + process.env.XDG_CURRENT_DESKTOP: '')
					+'\n\n' +
//					'UA: ' + session.defaultSession.getUserAgent() + '\n\n' +
					'Неофициальное приложение MAX\n' +
					'для Linux x64, Windows-' + (process.versions.electron.startsWith('22.') ? '7' : '10') +
					' и выше (32/64),\n' +
					(process.versions.electron.startsWith('22.') ? 'или Mac OS 10.15 и выше.\n\n' : '\n\n') +
					'Copyright © 2023, Alberto Mimbrero\n' +
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
/*		this.window.on("close", event => {

			if (this.MainApp.quitting) return;
			if (!this.MainApp.canCloseMe) {
				event.preventDefault();
			} else {
				event.preventDefault();
				this.MainApp.canCloseMe = false;
				this.window.hide();
			}
		});//*/

		this.window.on("close", (event) => {
			if (this.MainApp.quitting) return;

			const bounds = this.window.getBounds();
			const { x, y } = screen.getCursorScreenPoint();

			// всё, что НЕ заголовок и НЕ края — это сайт
			const headerHeight = 35; // высота стандартной рамки окна

			const isInsideContent = 
				x > bounds.x && x < (bounds.x + bounds.width) &&
				y > (bounds.y + headerHeight) && y < (bounds.y + bounds.height);

			// если мышь НЕ в контенте (значит, она на рамке/крестике/вне окна)
			const shouldHide = this.MainApp.canCloseMe || !isInsideContent;

//			// Дебаг в DevTools
//			this.window.webContents.executeJavaScript(
//				`console.log("Close trigger. Inside content: ${isInsideContent}. User action: ${shouldHide}")`
//			);

			if (shouldHide) {
				event.preventDefault();
				this.MainApp.canCloseMe = false;
				this.window.hide();
//				console.log("Окно скрыто (действие вне контента сайта)");
			} else {
				event.preventDefault();
//				console.log("Сайт попытался закрыть окно, пока мышь была внутри него. Блокируем.");
			}
		});

		this.window.on('page-title-updated', async (event, title) => {
			if (title !== "MAX") {
				unread = getUnreadMessages(title);
			} else unread = 0;
			if (unread !== 0) { // или таки >0 ?
				////////////////////////////////
				if (unread !== this.lastCount) {
					this.lastCount = unread;
					this.window.setTitle(title);
					this.tray.setToolTip(title + " - MAX");
					if (process.platform === 'darwin') {
						this.tray.setImage(ICON_UNREAD);
						app.dock.setBadge(String(unread));
					} else {
						const countText = unread > 99 ? '99' : unread.toString();
						const processedSvg = this.svgTemplate.replace(/\${count}/g, countText);

						const dataUrl = await this.renderSvg(unread.toString());
						const nIcon = nativeImage.createFromDataURL(dataUrl)
						try { this.tray.setImage(nIcon); }
						catch { this.tray.setImage(ICON_UNREAD); }

						if (process.platform === 'win32') {
							const processedOvl = this.svgOverlay.replace(/\${count}/g, countText);
							const overUrl = await this.renderSvg(unread.toString());
							const oIcon = nativeImage.createFromDataURL(dataUrl)
							try { this.window.setOverlayIcon(oIcon,String(unread)); }
							catch { this.window.setOverlayIcon(nativeImage.createFromPath(OVERLAY),String(unread)); }
						}
					}
				}
				////////////////////////////////

			}
			else {
				this.lastCount = 0;
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

	////////////////////////////
	// рисуем циферки в трее
	private async renderSvg(count: string): Promise<string> {
		const updatedSvg = this.svgTemplate.replace('${count}', count);
		return this.worker.webContents.executeJavaScript(`
        new Promise((resolve) => {
        const img = new Image();
        const svgBlob = new Blob([\`${updatedSvg}\`], {type: 'image/svg+xml;charset=utf-8'});
        const url = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = url;
        });`);
	}	
	////////////////////////////
};
