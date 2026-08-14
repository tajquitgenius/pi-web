package ui

import (
	"bytes"
	_ "embed"
	"html/template"
	"io"
)

//go:embed embedded/auth.html
var authTmplStr string

var authTmpl = template.Must(template.New("auth").Parse(authTmplStr))

// RenderAuthPrompt writes the standalone token-gate page. It reuses the shared
// theme stylesheet and boot script so the login screen honors every theme
// instead of a hardcoded dark/light copy that drifts from theme.css. The
// runtime "custom" theme resolves too: auth.html pulls /custom-themes.css,
// which is served publicly for this pre-auth case.
//
// cookieTheme is the request's pi-web-theme cookie (the live theme toggle's
// carrier); when empty it falls back to the server-persisted theme so the login
// screen matches the user's choice even before any client storage exists.
func RenderAuthPrompt(w io.Writer, cookieTheme string) error {
	theme := cookieTheme
	if theme == "" {
		theme = themeProvider()
	}
	data := struct {
		ServerTheme string
		ThemeCss    template.HTML
		ThemeBoot   template.HTML
	}{
		ServerTheme: theme,
		ThemeCss:    template.HTML("<style>\n" + exportThemeCSS + "\n</style>"),
		ThemeBoot:   liveThemeBootScript(),
	}
	var buf bytes.Buffer
	if err := authTmpl.Execute(&buf, data); err != nil {
		return err
	}
	_, err := w.Write(buf.Bytes())
	return err
}
