package server

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientBuildObservationRequiresPairingAndLogsValidatedMetadata(t *testing.T) {
	s := &Server{}
	request := func(paired bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/client-build-observation", nil)
		req.Header.Set("X-Pi-Web-Running-Build", "aaaaaaaaaaaaaaaa")
		req.Header.Set("X-Pi-Web-Deployed-Build", "bbbbbbbbbbbbbbbb")
		req.Header.Set("X-Pi-Web-Product", "mobile")
		req.Header.Set("X-Pi-Web-Display-Mode", "standalone")
		if paired {
			req = req.WithContext(context.WithValue(req.Context(), pairedDeviceContextKey{}, pairedDeviceIdentity{ID: "device"}))
		}
		rec := httptest.NewRecorder()
		s.handleClientBuildObservation(rec, req)
		return rec
	}

	if rec := request(false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unpaired observation = %d, want 401", rec.Code)
	}
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })
	if rec := request(true); rec.Code != http.StatusNoContent {
		t.Fatalf("paired observation = %d, want 204", rec.Code)
	}
	want := "pwa build observed product=mobile mode=standalone running=aaaaaaaaaaaaaaaa deployed=bbbbbbbbbbbbbbbb status=stale"
	if !strings.Contains(logs.String(), want) {
		t.Fatalf("observation log = %q, want %q", logs.String(), want)
	}
}
