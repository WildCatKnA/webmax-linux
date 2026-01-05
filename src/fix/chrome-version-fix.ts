import { ipcMain } from "electron";
import MainApp from "../mainapp";
import Fix from "./fix";

export default class ChromeVersionFix extends Fix {

    constructor(private readonly MainApp: MainApp) {
        super();
    }

    public override onLoad() {
        this.MainApp.reload();

        ipcMain.on("chrome-version-bug", () => {
            console.info("Detected chrome version bug. Reloading...");
            this.MainApp.reload();
        });
    }
}
