import { app, nativeImage, Tray, } from "electron";
import fs from "fs";
import path from "path";

const { dialog } = require('electron');
const iconew  = path.join("./", "unread_32.png");

export function getUnreadMessages(title: string) {
	const matches = title.match(/\d+ /);
	return matches == null ? 0 : Number.parseInt(matches[0].match(/\d+/)[0]);
}

////////////////////////////////////////////////////////////////////
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

