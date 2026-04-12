export interface IElectronAPI {
	updateOverlay: (dataUrl: string, description: string) => void;
}

declare global {
	interface Window {
		electronAPI: IElectronAPI;
	}
}

declare global {
  interface HTMLAudioElement {
    setSinkId(deviceId: string): Promise<void>;
    sinkId: string;
  }
}

interface AudioSettings {
  outputId?: string;
  inputId?: string;
}

interface UserActivation {
	readonly hasBeenActive: boolean;
	readonly isActive: boolean;
}

interface Navigator {
	readonly userActivation: UserActivation;
}

