interface UserActivation {
  readonly hasBeenActive: boolean;
  readonly isActive: boolean;
}

interface Navigator {
  readonly userActivation: UserActivation;
}

interface Window {
  mediaViewer: {
    open: (url: string, type: 'image' | 'video') => void;
    onData: (callback: (data: any) => void) => void;
  };
}
