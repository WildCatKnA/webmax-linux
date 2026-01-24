import { app } from 'electron';
import MainApp from './mainapp';

////////////////////////////////////////////////////////////////////////////////
// костыли... которые, к несчастью, не работают ))
/*if (process.platform === 'linux') {
    // 0 - отключает новые механизмы Chromium, заставляя искать системную libappindicator
    process.env.ELECTRON_USE_LIBAPPINDICATOR = '1'; 
    // Иногда требуется сбросить переменную рабочего стола, чтобы Electron не умничал
//	process.env.XDG_CURRENT_DESKTOP = 'XFCE'; // или оставить пустым
    process.env.XDG_CURRENT_DESKTOP = 'Unity'; 
} //*/
////////////////////////////////////////////////////////////////////////////////

if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit();
}

app.whenReady().then(() => new MainApp().init());
