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
export async function createBadgeIcon(count, tray) {
const svg =
`<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" fill="none">
<defs>
	<linearGradient id="myGradient" x1="0%" y1="0%" x2="100%" y2="100%">
	<stop offset="0%" stop-color="#4c34e7" />
	<stop offset="100%" stop-color="#9750db" />
</linearGradient>
</defs>
<rect x="0" y="0" width="21" height="21" rx="5" fill="url(#myGradient)"/>
<path fill="#fff" fill-rule="evenodd"
 d="M10.22 20.8a6.25 6.26 0 0
1-4.46-1.44c-1 1.3-4.18 2.3-4.32.57 0-1.3-.29-2.38-.6-3.58-.4-1.47-.84-3.1-.84-5.48C0
5.2 4.65.94 10.17.94A9.86 9.86 0 0 1 20 10.92a9.84 9.84 0 0 1-9.78
9.88Zm.08-14.96c-2.68-.14-4.78 1.72-5.24 4.63-.38 2.41.3 5.35.88
5.5.27.07.97-.5 1.4-.93.71.46 1.52.82 2.43.87a5.1 5.1 0 0 0
5.34-4.77 5.11 5.11 0 0 0-4.81-5.3Z" />

<circle cx="10" cy="11" r="6" fill="#404040" stroke="#101010" stroke-width="1" />
<text x="10" y="14" font-family="Arial" font-size="9" font-weight="bold"
	fill="white" text-anchor="middle">${count > 9 ? '9+' : count}</text>
</svg>`;


//////////////////
const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });

// Создание URL для использования в <img> или для скачивания
const url = URL.createObjectURL(blob);

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const img = new Image();

	canvas.width = 32;//img.width;
	canvas.height = 32;//img.height;
	ctx.drawImage(img, 0, 0);
  
	// Получение PNG Blob
	canvas.toBlob((blob) => {
		console.log('PNG Blob готов:', blob);
	}, 'image/png');

	img.src = URL.createObjectURL(blob);

	const arrayBuffer = await blob.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	const icon = nativeImage.createFromBuffer(buffer);

//    fs.writeFileSync('./assets/tray-unread--.svg', blob);

//	fs.writeFileSync('./assets/tray-unread-.png', icon.src);
	fs.writeFile('./assets/tray-unread-.png', buffer, (err) => {
		if (err) console.error('Ошибка записи:', err);
		else console.log('Файл успешно сохранен');
	});
//	tray.setIcon(icon);
//*/
return;//(blob);
//return(img);

//////////////////






//	// 3. Конвертируем SVG в NativeImage
//    const buffer = Buffer.from(svg);
//    const buffer = Image.toPNG(svg);
//    const ic = nativeImage.createFromBuffer(buffer, { scaleFactor: 2.0});
//    fs.writeFileSync('./assets/tray-unread.svg', svg);
//    return;// nativeImage.createFromBuffer(buffer);// { scaleFactor: 2.0 });
}
////////////////////////////////////////////////////////////////////

