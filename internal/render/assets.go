package render

import "strings"

type Manifest map[string]ManifestEntry

type ManifestEntry struct {
	File string   `json:"file"`
	CSS  []string `json:"css,omitempty"`
}

func (m Manifest) ScriptPath(entry string) (string, bool) {
	item, ok := m[entry]
	if !ok || item.File == "" {
		return "", false
	}
	return "/static/" + strings.TrimPrefix(item.File, "/"), true
}
