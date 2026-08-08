import { app } from 'electron';
import Store from 'electron-store';

const instances: { [key: string]: Settings } = {};

export const getSettings = (section: string) => {
	if (!instances[section]) {
		instances[section] = new Settings(section);//, app.getPath('userData'));
	}
	return instances[section];
};

export default class Settings {
	private readonly store: Store;
	private readonly section: string;

//	constructor(section: string, userDataPath: string) {
	constructor(section: string) {
		this.section = section + ".";
		this.store = new Store({
			cwd: app.getPath('userData'),//userDataPath, 
			name: 'config'
		});
//		console.log(`Settings [${section}] путь:`, this.store.path);
	}

	public get(key: string, defaults: any = null): any {
		try {
			return this.store.get(this.section + key, defaults);
		} catch (err) {
			// например, EPERM/EBUSY при чтении config.json на сетевых
			// (перенаправленных через GPO) папках профиля - не фатально
			console.error(`Settings.get(${this.section}${key}) failed:`, err);
			return defaults;
		}
	}

	public set(key: string, value: any): void {
		try {
			this.store.set(this.section + key, value);
		} catch (err) {
			// например, EPERM при rename config.json.tmp -> config.json на
			// сетевых (перенаправленных через GPO) папках профиля - теряем
			// только это конкретное сохранение состояния, не крашим приложение
			console.error(`Settings.set(${this.section}${key}) failed:`, err);
		}
	}
}
