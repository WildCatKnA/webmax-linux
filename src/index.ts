import { app } from 'electron';

const path = require('path');
const fs = require('fs');

/////////////////////////////////////////////////////////////////
// переключаем пути к данным, если рядом с исполняемым файлом 
// находится файл 'is_portable.txt' (делаемся портабельными)

function isWritable(dir) {
	try {
		// наличие прав на запись
		fs.accessSync(dir, fs.constants.W_OK);
		return true;
	} catch (err) {
		return false;
	}
}

const exeDir = path.dirname(app.getPath('exe'));

if (fs.existsSync(path.join(exeDir, 'is_portable.txt'))) {
	if (isWritable(exeDir)) {
		// переключаемся на Portable
		const portableDataPath = path.join(exeDir, 'data');
		app.setPath('userData', portableDataPath);
		app.setPath('sessionData', portableDataPath);
		app.commandLine.appendSwitch('user-data-dir', portableDataPath);
	} else {
		// облом, оставляем %AppData%
		console.error("Нет прав на запись в папку приложения. Используется стандартный путь.");

	}
}


// проверяемся
//checkPortableMode();

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
