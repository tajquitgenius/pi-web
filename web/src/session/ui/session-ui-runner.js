import { sessionRuntime } from '../session-runtime.js';

export function setupSessionUi({
  documentImpl = document,
  windowImpl = window,
  storage = localStorage,
  sessionId = '',
  marked,
  hljs,
  escapeHtml,
  markdownApi,
  searchFiltersApi,
  sidebarApi,
  toggleStateApi,
  getLeafId,
  setSearchQuery,
  setFilterMode,
  forceTreeRerender,
  navigateTo,
} = {}) {
  markdownApi.configureSessionMarkdown({ marked, hljs, escapeHtml });
  const safeMarkedParse = (text) => markdownApi.safeMarkedParse(text, { marked });

  const searchFilterControls = searchFiltersApi.setupSessionSearchAndFilters({
    documentImpl,
    getLeafId,
    setSearchQuery,
    setFilterMode,
    forceTreeRerender,
    navigateTo,
  });

  const isMobileLayout = () => sidebarApi.isMobileLayout({ windowImpl });
  sidebarApi.setupSidebarResize({ documentImpl, windowImpl, storage });
  sidebarApi.setupSidebarCollapse({ documentImpl, windowImpl, storage });
  const closeSidebar = () => sidebarApi.setSidebarOpen(false, { documentImpl });
  const overlayEl = documentImpl.getElementById('sidebar-overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', closeSidebar);
    overlayEl.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        closeSidebar();
      },
      { passive: false },
    );
  }

  const toggleController = toggleStateApi.createToggleController({
    documentImpl,
    storage,
    sessionId,
  });
  // Registered so export-entry can reapply visibility state after a branch render.
  sessionRuntime.toggleState = toggleController;

  const attachHeaderHandlers = () => toggleController.attachHeaderHandlers();
  const toggleThinking = () => toggleController.toggleThinking();
  const toggleToolsVisibility = () => toggleController.toggleToolsVisibility();
  const toggleToolOutputs = () => toggleController.toggleToolOutputs();

  searchFiltersApi.setupSessionKeyboardShortcuts({
    documentImpl,
    clearSearch: () => searchFilterControls.clearAndNavigateBottom(),
    toggleThinking,
    toggleToolsVisibility,
    toggleToolOutputs,
  });

  return {
    safeMarkedParse,
    isMobileLayout,
    closeSidebar,
    attachHeaderHandlers,
    toggleController,
  };
}
