export interface BookCenterTransitionConfig {
  name: string;
  enterX: number;
  enterY: number;
  leaveX: number;
  durationEnterMs: number;
  durationLeaveMs: number;
}

const BOOK_CENTER_TRANSITION: BookCenterTransitionConfig = {
  name: "folio-panel",
  enterX: 8,
  enterY: 0,
  leaveX: -6,
  durationEnterMs: 170,
  durationLeaveMs: 120,
};

const BOOK_DETAIL_TRANSITION: BookCenterTransitionConfig = {
  name: "folio-note",
  enterX: 10,
  enterY: 0,
  leaveX: -8,
  durationEnterMs: 180,
  durationLeaveMs: 120,
};

export function getBookCenterTransitionName(): string {
  return BOOK_CENTER_TRANSITION.name;
}

export function getBookCenterTransition(): BookCenterTransitionConfig {
  return BOOK_CENTER_TRANSITION;
}

export function getBookDetailTransition(): BookCenterTransitionConfig {
  return BOOK_DETAIL_TRANSITION;
}

export function getWorkbenchLoaderLabel(): string {
  return "正在加载工作台...";
}
