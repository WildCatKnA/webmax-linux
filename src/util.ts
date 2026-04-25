import { app, Tray, BrowserWindow } from "electron";
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

	// ищем свободное имя: name (1).ext, name (2).ext ...
	while (fs.existsSync(path.join(dir, `${name} (${counter})${ext}`))) {
		counter++;
	}

	return path.join(dir, `${name} (${counter})${ext}`);
}

////////////////////////////////////////////////////////////////////
// возвращаем полную версию Windows/Linux/Mac (почти полную)
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

///////////////////////////////////////
// уведомлялка внутри окна в приложении
export function showWebToast(message: string, win: BrowserWindow): void {
	const bgColor = 'rgba(32, 32, 32, 0.7)';

	const jsCode = `
(() => {
  const toast = document.createElement("div");
  toast.innerText = ${JSON.stringify(message)};
			
  toast.style.cssText = \`
    position: fixed; 
    top: 2px; 
    left: -350px; 
    background: ${bgColor};
    color: white; 
    padding: 12px 24px; 
    border-radius: 0 12px 12px 0; 
    z-index: 999999; 
    font-family: sans-serif;
    box-shadow: 4px 4px 12px rgba(0,0,0,0.15); 
    transition: all 0.4s ease-out; 
    opacity: 0;
    pointer-events: none;
  \`;
			
  document.body.appendChild(toast);

  setTimeout(() => { 
    toast.style.left = "0px"; 
    toast.style.opacity = "1"; 
  }, 50);

  setTimeout(() => {
    toast.style.left = "-350px"; 
    toast.style.opacity = "0";
    setTimeout(() => { toast.remove(); }, 500);
  }, 3500);
})();
`;

	if (win && win.webContents) {
		win.webContents.executeJavaScript(jsCode);
	}
}
