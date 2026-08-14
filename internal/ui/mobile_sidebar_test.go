package ui

import (
	"os"
	"strings"
	"testing"
)

func TestStaticExportMobileSidebarClosesWhenNavigatingTree(t *testing.T) {
	sidebarSrc, err := os.ReadFile(repoPath("web/src/session/ui/sidebar.js"))
	if err != nil {
		t.Fatalf("read sidebar.js: %v", err)
	}
	exportSrc, err := os.ReadFile(repoPath("web/src/export/export-entry.js"))
	if err != nil {
		t.Fatalf("read export-entry.js: %v", err)
	}
	for _, check := range []string{
		"export function setSidebarOpen(open, { documentImpl = document } = {}) {",
		"documentImpl.body?.classList.toggle('sidebar-open', open);",
	} {
		if !strings.Contains(string(sidebarSrc), check) {
			t.Fatalf("sidebar.js missing %q", check)
		}
	}
	if !strings.Contains(string(exportSrc), "ui.closeSidebar()") {
		t.Fatal("export-entry.js missing mobile close-on-navigate")
	}
}

func TestStaticExportMobileSessionActionsStayAtTopAndHideBehindSidebar(t *testing.T) {
	checks := []string{
		`class="session-header-bar export-only"`,
		"@media (max-width: 900px)",
		".session-header-bar {",
		"position: fixed;",
		"inset: 0 0 auto;",
		"body.sidebar-open .session-header-bar",
	}
	combined := exportSessionCSS + exportSessionHtml + exportJs
	for _, check := range checks {
		if !strings.Contains(combined, check) {
			t.Fatalf("mobile export action UI missing %q", check)
		}
	}

	cssAfterMobile := exportSessionCSS[strings.Index(exportSessionCSS, "@media (max-width: 900px)"):]
	headerIdx := strings.Index(cssAfterMobile, ".session-header-bar")
	if headerIdx == -1 {
		t.Fatal("missing .session-header-bar in mobile media query")
	}
	blockIdx := strings.Index(cssAfterMobile[headerIdx:], "}")
	if blockIdx == -1 {
		t.Fatal("unclosed .session-header-bar block in mobile media query")
	}
	headerBlock := cssAfterMobile[headerIdx : headerIdx+blockIdx+1]
	if strings.Contains(headerBlock, "\nbottom:") && !strings.Contains(headerBlock, "\nbottom: auto") {
		t.Fatal("mobile export header should use top positioning")
	}
}

func TestStaticExportMobileActionsDoNotCoverHeaderToggleButtons(t *testing.T) {
	checks := []string{
		"margin-top: calc(52px + env(safe-area-inset-top))",
		"#content {",
		"padding: 18px 16px",
		".header-toggle-btn",
		"data-action=\"toggle-thinking\"",
		"data-action=\"toggle-tools\"",
	}
	combined := exportSessionCSS + exportJs
	for _, check := range checks {
		if !strings.Contains(combined, check) {
			t.Fatalf("mobile export controls missing %q", check)
		}
	}
}
