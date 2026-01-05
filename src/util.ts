import { app, nativeImage } from "electron";
import fs from "fs";
import path from "path";

export function getUnreadMessages(title: string) {
	const matches = title.match(/\d+ /);
	return matches == null ? 0 : Number.parseInt(matches[0].match(/\d+/)[0]);
}
