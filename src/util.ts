import { app, nativeImage, Tray, } from "electron";
import fs from "fs";
import path from "path";

const os = require('os');
//const { dialog } = require('electron'); // использовал для отладки

export function getUnreadMessages(title: string) {
	const matches = title.match(/\d+ /);
	return matches == null ? 0 : Number.parseInt(matches[0].match(/\d+/)[0]);
}

////////////////////////////////////////////////////////////////////
// добавляем в имя файла "(n)", если исходный уже есть
export function getUnusedPath(filePath) {
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

////////////////////////////////////////////////////////////////////

// возвращаем полную версию Windows/Linux/Mac
export function getMyOSVersion() {
	// разрядность
	function getSystemArch() {
		if (process.platform === 'win32') {
			if (process.arch === 'x64' || process.env.PROCESSOR_ARCHITEW6432) {
				return 'x64';
			}
			return 'x86';
		}
		else {
			return os.arch();
		}
	}

	const version = process.getSystemVersion(); // пример: "10.0.22631"
	const build = parseInt(version.split('.').pop(), 10);
	let fullVer = '';
	let arch = getSystemArch();

	if (process.platform === 'win32') {
		if (build >= 22000) {
			fullVer = 'Windows 11 ' + arch + ' (build ' + build + ')';

		} else if (build >= 10240) {
			fullVer = 'Windows 10 ' + arch + ' (build ' + build + ')';

		} else if (version.startsWith('6.3')) {
			fullVer = 'Windows 8.1 ' + arch + ' (build ' + build + ')';

		} else if (version.startsWith('6.2')) {
		    fullVer = 'Windows 8 ' + arch + ' (build ' + build + ')';

		} else if (version.startsWith('6.1')) {
			fullVer = 'Windows 7 ' + arch + ' (build ' + build + ')';
		}
	
		else fullVer = 'Unknown Windows ' + arch + ' (' + version + ')';
	}

	else if (process.platform === 'linux') {
		fullVer = 'Linux ' + arch + ' ' + version;
	}

	else if (process.platform === 'darwin') {
		fullVer = 'Mac OS ' + arch + ' ' + version;
	}

	else fullVer = 'Unknown OS ' + arch + ' ' + version;

	return fullVer;
}

////////////////////////////////////////////////////////////////////