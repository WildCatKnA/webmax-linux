import { app } from 'electron';
import MainApp from './mainapp';

////////////////////////////////////////////////////////////////////////////////

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit();
}

// костыль, чтобы в Windows не искажались сохраненные изображения
// (заставить работать с цветовым профилем sRGB)
if (process.platform === 'win32') {
	app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

app.whenReady().then(() => new MainApp().init());
