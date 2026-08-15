package server

import (
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) handleClientBuildObservation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := pairedDeviceFromContext(r.Context()); !ok {
		writeJSONError(w, http.StatusUnauthorized, "device pairing required")
		return
	}
	running := r.Header.Get("X-Pi-Web-Running-Build")
	deployed := r.Header.Get("X-Pi-Web-Deployed-Build")
	product := r.Header.Get("X-Pi-Web-Product")
	mode := r.Header.Get("X-Pi-Web-Display-Mode")
	if !isClientBuildFingerprint(running) || !isClientBuildFingerprint(deployed) ||
		(product != "desktop" && product != "mobile") ||
		(mode != "browser" && mode != "standalone") {
		writeJSONError(w, http.StatusBadRequest, "invalid build observation")
		return
	}
	status := "stale"
	if running == deployed {
		status = "current"
	}
	layout, valid := clientBuildLayout(r)
	if !valid {
		writeJSONError(w, http.StatusBadRequest, "invalid build observation")
		return
	}
	log.Printf("pwa build observed product=%s mode=%s running=%s deployed=%s status=%s%s", product, mode, running, deployed, status, layout)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func clientBuildLayout(r *http.Request) (string, bool) {
	fields := []struct {
		header string
		label  string
	}{
		{"X-Pi-Web-Screen-Height", "screen_h"},
		{"X-Pi-Web-Inner-Height", "inner_h"},
		{"X-Pi-Web-Visual-Height", "visual_h"},
		{"X-Pi-Web-Visual-Top", "visual_top"},
		{"X-Pi-Web-Root-Top", "root_top"},
		{"X-Pi-Web-Root-Bottom", "root_bottom"},
		{"X-Pi-Web-Composer-Top", "composer_top"},
		{"X-Pi-Web-Composer-Bottom", "composer_bottom"},
		{"X-Pi-Web-Composer-Padding-Bottom", "composer_pad_bottom"},
	}
	var values []string
	for _, field := range fields {
		raw := r.Header.Get(field.header)
		if raw == "" {
			continue
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < -5000 || value > 5000 {
			return "", false
		}
		values = append(values, field.label+"="+strconv.FormatFloat(value, 'f', 1, 64))
	}
	if len(values) == 0 {
		return "", true
	}
	return " " + strings.Join(values, " "), true
}

func isClientBuildFingerprint(value string) bool {
	if len(value) != 16 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}
