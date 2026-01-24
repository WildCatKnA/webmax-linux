export interface IElectronAPI {
  updateOverlay: (dataUrl: string, description: string) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
