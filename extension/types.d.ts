type ExtensionTask = {
  id: string | number; draftId: string | number; status: string; title: string; bodyText: string;
  images: { id: string | number; index: number; insertOffset: number; insertPrefix: string; signedUrl: string; expiresIn: number }[];
  blocks?: import("../lib/blog-publishing/blocks").BlogExecutionBlock<{ index: number; signedUrl: string }>[];
};
type EditorDiagnostic = {
  url: string; writing: boolean; ready: boolean; existing: boolean;
  frameReady: boolean; titleFound: boolean; bodyFound: boolean;
  title: { matchedSelector: string; target: { tag: string; class: string } | null };
  body: { matchedSelector: string; target: { tag: string; class: string } | null };
  iframeCount: number; paragraphs: number; titleTag?: string; bodyTag?: string; reason: string;
};
type EditorTargetPosition = { x: number; y: number; rect: { x: number; y: number; width: number; height: number } };
type ExtensionMessage = {
  type: string; id?: string; draftId?: string; baseUrl?: string; token?: string; task?: ExtensionTask; overwrite?: boolean;
  field?: "title" | "body";
  publisher?: "blocks" | "legacy";
  blockNumber?: number; imageNumber?: number;
};
type ExtensionReply = {
  error?: string; tasks?: { id: string | number; draftId?: string | number; title: string; status: string }[]; task?: ExtensionTask;
  diagnostic?: EditorDiagnostic; frameId?: number; message?: string;
  diagnostics?: { frameId: number; diagnostic?: EditorDiagnostic; reason?: string }[];
  position?: EditorTargetPosition; existing?: boolean;
  imageReady?: boolean;
  needsParagraph?: boolean;
  verification?: { titleMatches: boolean; bodyMatches: boolean; actualLength: number; expectedLength: number };
};
declare const chrome: {
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId?: number; sessionId?: string }, method: string, params?: object): Promise<object | undefined>;
    onEvent: {
      addListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params?: { backendNodeId?: number; frameId?: string; mode?: string }) => void): void;
      removeListener(listener: (source: { tabId?: number; sessionId?: string }, method: string, params?: { backendNodeId?: number; frameId?: string; mode?: string }) => void): void;
    };
    onDetach: {
      addListener(listener: (source: { tabId?: number }, reason: string) => void): void;
      removeListener(listener: (source: { tabId?: number }, reason: string) => void): void;
    };
  };
  runtime: { onMessage: { addListener(listener: (message: ExtensionMessage, sender: { id?: string }, respond: (reply: ExtensionReply) => void) => boolean | void): void }; sendMessage(message: ExtensionMessage): Promise<ExtensionReply>; getURL(path: string): string; id: string };
  sidePanel: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
  storage: { local: { get(keys: string[]): Promise<Record<string, string>>; set(value: Record<string, string>): Promise<void>; setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void> }; session: { get(keys: string[]): Promise<Record<string, string>>; set(value: Record<string, string>): Promise<void> } };
  tabs: { query(options: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>; sendMessage(id: number, message: ExtensionMessage, options: { frameId: number }): Promise<ExtensionReply> };
  webNavigation: { getAllFrames(options: { tabId: number }): Promise<{ frameId: number; url: string }[] | null> };
  permissions: { request(options: { origins: string[] }): Promise<boolean> };

};
