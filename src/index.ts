import { app } from 'electron';
import MainApp from './mainapp';

app.commandLine.appendSwitch('autoplay-policy', 'user-gesture-required');

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit();
}

app.whenReady().then(() => new MainApp().init());
