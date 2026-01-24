import { BrowserWindow } from 'electron';
import Settings from '../settings';
import MainApp from '../mainapp';
import Module from './module';

const { dialog } = require('electron');
const settings = new Settings("window");

export default class WindowSettingsModule extends Module {

	constructor(
		private readonly MainApp: MainApp,
		private readonly window: BrowserWindow
	) {
		super();
	}

	public override beforeLoad(){
		let defaults = this.window.getBounds();
		const wb = settings.get("bounds", defaults);

		// костыль для линупсов, будь они прокляты...
		if (process.platform === 'linux') {
			this.window.setBounds({ 
				x: wb.x - 2, y: wb.y - 32, width: wb.width, height: wb.height 
			});
		} else this.window.setBounds(wb);

		if (settings.get("maximized", false)) {
			this.window.maximize();
		}
		this.MainApp.blockAudVid = settings.get("block-video", false);
	}

	public override onQuit() {
		settings.set("maximized", this.window.isMaximized());

		if (!this.window.isMaximized()) {
			settings.set("bounds", this.window.getNormalBounds());
		}
		settings.set("block-video", this.MainApp.blockAudVid);
	}
};
