import { app } from 'electron';
import MainApp from './mainapp';

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit();
}

app.whenReady().then(() => new MainApp().init());
