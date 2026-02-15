import { app } from 'electron';

const path = require('path');
const fs = require('fs');

/////////////////////////////////////////////////////////////////
// переключаем пути к данным, если рядом с исполняемым файлом 
// находится файл 'is_portable.txt' (делаемся портабельными)
function checkPortableMode() {
	const exeDir = path.dirname(app.getPath('exe'));
	const flagPath = path.join(exeDir, 'is_portable.txt');

	if (fs.existsSync(flagPath)) {
		const portableDataPath = path.join(exeDir, 'data');

		// основные пути в папку 'data' рядом с exe
		app.setPath('userData', portableDataPath);
		app.setPath('sessionData', portableDataPath);
		app.commandLine.appendSwitch('user-data-dir', portableDataPath);
	}
}

// проверяемся
checkPortableMode();

/////////////////////////////////////////////////////////////////
import MainApp from './mainapp';

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit();
}

/////////////////////////////////////////////////////////////////
// костыль, чтобы в Windows не искажались сохраненные изображения
// (заставить работать с цветовым профилем sRGB)
if (process.platform === 'win32') {
	app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

app.whenReady().then(() => new MainApp().init());
