export function getBookSourcePanelLayout(hasBook: boolean) {
  return {
    bodyClass: "min-h-0 flex flex-1 flex-col px-5 py-5",
    contentClass: hasBook
      ? "min-h-0 flex flex-1 flex-col overflow-hidden"
      : "min-h-0 flex flex-1 flex-col",
    footerClass: "mt-auto border-t border-[#e0d5c3] pt-6",
  };
}

export function getBookSummaryDetailLayout() {
  return {
    shellClass: "flex h-full min-h-0 overflow-hidden border border-[#d8cfbe] bg-[#fbf6ed]",
    detailPaneClass: "relative min-w-0 min-h-0 flex-1 overflow-hidden",
    detailTransitionName: "folio-note",
  };
}
