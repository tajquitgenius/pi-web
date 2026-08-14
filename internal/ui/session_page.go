package ui

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"os"
	"strconv"

	"pi-web/internal/sessions"
)

// share-session.html renders the isolated static export/share snapshot. Live
// session pages are owned by the desktop and mobile React products.
//
//go:embed embedded/share-session.html
var exportSessionHtml string

var exportSessionTmpl = template.Must(template.New("export_session").Parse(exportSessionHtml))

//go:embed embedded/styles/theme.css
var exportThemeCSS string

//go:embed embedded/styles/session.css
var exportSessionCSS string

// LargeSessionTailEntries controls the initial tail window returned to live
// React products for huge sessions. Static exports always embed the complete
// conversation because they cannot fetch preceding windows.
//
// Defaults are production values and are overridable for tests. Read once at
// startup.
var (
	LargeSessionThreshold   = envInt("PI_WEB_LARGE_SESSION_THRESHOLD", 1500)
	LargeSessionTailEntries = envInt("PI_WEB_LARGE_SESSION_TAIL_ENTRIES", 1000)
)

func envInt(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// prepareSessionPageData computes the complete base64 session payload, CSS, and
// body attributes for a self-contained static export/share snapshot.
func prepareSessionPageData(session sessions.Session, cssTemplate string) (dataBase64, css, bodyAttrs string) {
	leafID := ""
	for i := len(session.Entries) - 1; i >= 0; i-- {
		if typ, _ := session.Entries[i]["type"].(string); typ == "label" {
			continue
		}
		if id, ok := session.Entries[i]["id"].(string); ok && id != "" {
			leafID = id
			break
		}
	}

	sessionData := map[string]any{
		"header":        session.Header,
		"entries":       session.Entries,
		"name":          session.Name,
		"leafId":        leafID,
		"systemPrompt":  nil,
		"tools":         nil,
		"renderedTools": nil,
	}

	dataJSON, _ := json.Marshal(sessionData)
	dataBase64 = base64.StdEncoding.EncodeToString(dataJSON)

	css = cssTemplate

	if session.SessionUUID != "" {
		bodyAttrs = ` data-session-uuid="` + session.SessionUUID + `"`
	}
	return
}
