import { app } from 'electron';
import MainApp from './mainapp';

const path = require('path');
const fs = require('fs');
const { systemPreferences } = require('electron');

let portable = false;

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

// проверка, запускаемся ли мы в Portable-режиме (кроме macos)
if (process.platform !== 'darwin') {
	const exeDir = path.dirname(app.getPath('exe'));

	if (fs.existsSync(path.join(exeDir, 'is_portable.txt'))) {
		if (isWritable(exeDir)) {
			// переключаемся на Portable
			portable = true;
			const portableDataPath = path.join(exeDir, 'data');
			app.setPath('userData', portableDataPath);
			app.setPath('sessionData', portableDataPath);
			app.commandLine.appendSwitch('user-data-dir', portableDataPath);
		} else {
			// облом, оставляем %AppData%
			console.error("Нет прав на запись в папку приложения. Используется стандартный путь.");
			portable = false;
		}
	}
}

// пробуем выбить разрешение трансляции экрана при старте (macos)
/*
if (process.platform === 'darwin') {
	// в Catalina это может вернуть denied или not-determined
	const status = systemPreferences.getMediaAccessStatus('screen');
	console.log("getMediaAccessStatus = " + status);
	if (status !== 'granted') {
		// ВАЖНО: просто проверка статуса иногда не вызывает окно запроса.
		// нужно вызвать захват хотя бы одного кадра.
		const { desktopCapturer } = require('electron');
		desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
			console.log("Запрос прав инициирован через getSources");
		});
	}
}// */

/////////////////////////////////////////////////////////////////

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

//app.whenReady().then(() => new MainApp().init());
app.whenReady().then(() => new MainApp(portable).init());
