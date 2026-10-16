type ExtensionTask = {
  publishMode?: "manual" | "scheduled";
  finalizeMode?: "review" | "auto";
  scheduledAt?: string | null;
  reservationConfirmedAt?: string | null;
  jobId?: string; attemptNo?: number;
  id: string | number; draftId: string | number; status: string; title: string; bodyText: string;
  images: { id: string | number; index: number; insertOffset: number; insertPrefix: string; signedUrl: string; expiresIn: number }[];
  blocks?: import("../lib/blog-publishing/blocks").BlogExecutionBlock<{ index: number; signedUrl: string }>[];
};
type EditorDiagnostic = {
  url: string; writing: boolean; ready: boolean; existing: boolean;
  frameReady: boolean; titleFound: boolean; bodyFound: boolean;
  activeEditor: boolean; visibleEditor: boolean; publishPanelOpen: boolean;
  writableEditor: boolean; stableEditor: boolean; editorId: string;
  baseReady: boolean; documentReadyState: string; activeEditorReason: string;
  titleState: EditorFieldState | null; bodyState: EditorFieldState | null;
  publishPanelCandidates: { selector: string; tag: string; displayed: boolean; onScreen: boolean; isPublishPanel: boolean }[]; blockingDialogOpen: boolean;
  publishPanelState: { rootFound: boolean; rootDisplayed: boolean; nowRadioVisible: boolean; preRadioVisible: boolean; finalButtonVisible: boolean; publishPanelOpen: boolean };
  title: { matchedSelector: string; target: { tag: string; class: string } | null };
  body: { matchedSelector: string; target: { tag: string; class: string } | null };
  iframeCount: number; paragraphs: number; titleTag?: string; bodyTag?: string; reason: string;
};
type EditorFieldState = { rects: { x: number; y: number; width: number; height: number }[];
  contenteditable: string | null; isContentEditable: boolean; parentContenteditable: string | null; editableDescendants: number; displayed: boolean;
  editableHostTag: string | null; editableHostContenteditable: string | null };
type EditorTargetPosition = { x: number; y: number; rect: { x: number; y: number; width: number; height: number } };
type ExtensionMessage = {
  type: string; id?: string; jobId?: string; draftId?: string; baseUrl?: string; token?: string; task?: ExtensionTask; overwrite?: boolean;
  field?: "title" | "body";
  publisher?: "blocks" | "legacy";
  blockNumber?: number; imageNumber?: number;
  openList?: boolean;
};
type ExtensionReply = {
  cleanupWarning?: string;
  jobs?: { id: string; taskId: string | number; draftId: string | number; title: string; imageCount: number; status: string; publishMode?: string; finalizeMode?: string; scheduledAt?: string | null; reservationConfirmedAt?: string | null }[];
  error?: string; tasks?: { id: string | number; draftId?: string | number; title: string; status: string }[]; task?: ExtensionTask;
  diagnostic?: EditorDiagnostic; frameId?: number; message?: string;
  diagnostics?: { frameId: number; diagnostic?: EditorDiagnostic; reason?: string }[];
  position?: EditorTargetPosition; existing?: boolean;
  imageReady?: boolean;
  needsParagraph?: boolean;
  scheduleReady?: boolean;
  reservation?: { listFound: boolean; matchingEntries: number; openedList: boolean; diagnostic: ReservationDiagnostic; triggerPosition?: EditorTargetPosition };
  reservationDiagnostics?: ReservationDiagnostic[];
  verification?: { titleMatches: boolean; bodyMatches: boolean; actualLength: number; expectedLength: number };
};
type ReservationTriggerDiagnostic = {
  hitTag: string | null; hitText: string | null; hitClosestButtonText: string | null; hitClosestButtonMatchesTrigger: boolean;
  triggerRect: { x: number; y: number; width: number; height: number };
  viewportWidth: number; viewportHeight: number; devicePixelRatio: number;
  topLevel: boolean; iframeOffsetRequired: boolean; localX: number; localY: number;
  topX: number | null; topY: number | null; coordinateSpace: "top-viewport-css-pixels";
};
type ReservationDiagnostic = {
  stage: string; listAlreadyVisible: boolean; listTriggerFound: boolean; listTriggerCount: number; listTriggerClicked: boolean;
  listVisibleAfterClick: boolean; listHeadingFound: boolean; entryCount: number; matchingEntryCount: number;
  expectedTitle: string; expectedDateTime: string; frameId: number | null; frameUrl: string | null; reason: string;
  listTriggerCandidates?: { tag: string; name: string; role: string | null; testId: string | null; visible: boolean; allowed: boolean }[];
  triggerHitTest?: ReservationTriggerDiagnostic;
  ariaExpanded?: string | null; ariaPressed?: string | null; triggerClass?: string | null; triggerFocused?: boolean | null;
  ariaExpandedBefore?: string | null; ariaExpandedAfter?: string | null;
  ariaPressedBefore?: string | null; ariaPressedAfter?: string | null;
  triggerClassBefore?: string | null; triggerClassAfter?: string | null; triggerFocusedAfterClick?: boolean | null;
  clickMode?: "trusted-cdp"; triggerX?: number | null; triggerY?: number | null;
  framesBeforeClick?: { frameId: number; url: string }[]; framesAfterClick?: { frameId: number; url: string }[];
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
  tabs: { update(id: number, options: { url: string }): Promise<unknown>; query(options: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>; sendMessage(id: number, message: ExtensionMessage, options: { frameId: number }): Promise<ExtensionReply> };
  webNavigation: { getAllFrames(options: { tabId: number }): Promise<{ frameId: number; url: string }[] | null> };
  permissions: { request(options: { origins: string[] }): Promise<boolean> };

};
