package server

import (
	"log"
	"net/http"
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
	log.Printf("pwa build observed product=%s mode=%s running=%s deployed=%s status=%s", product, mode, running, deployed, status)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
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
