package app

import (
	"os"
	"reflect"
	"testing"

	"pi-web/internal/server"
	"pi-web/internal/ui"
)

func TestValidatePublicURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "unset"},
		{name: "hostname", raw: "https://pi.example", want: "https://pi.example"},
		{name: "root path normalized", raw: "https://pi.example/", want: "https://pi.example"},
		{name: "explicit port", raw: "https://pi.example:8443", want: "https://pi.example:8443"},
		{name: "IPv6", raw: "https://[::1]:8443/", want: "https://[::1]:8443"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validatePublicURL(tt.raw)
			if err != nil {
				t.Fatalf("validatePublicURL(%q): %v", tt.raw, err)
			}
			if got != tt.want {
				t.Fatalf("validatePublicURL(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestValidatePublicURLRejectsNonOrigins(t *testing.T) {
	for _, raw := range []string{
		"http://pi.example", "//pi.example", "https://", "https://user@pi.example",
		"https://pi.example/session", "https://pi.example?token=secret", "https://pi.example?",
		"https://pi.example#section", "https://pi.example#", "https://pi.example:",
		"https://*.example.com", " https://pi.example", "https://pi.example ",
	} {
		t.Run(raw, func(t *testing.T) {
			if got, err := validatePublicURL(raw); err == nil {
				t.Fatalf("validatePublicURL(%q) = %q, want error", raw, got)
			}
		})
	}
}

func TestParseRemoteAuthMode(t *testing.T) {
	for _, tt := range []struct {
		raw  string
		want server.RemoteAuthMode
	}{
		{raw: "", want: server.RemoteAuthPairing},
		{raw: "pairing", want: server.RemoteAuthPairing},
		{raw: "external", want: server.RemoteAuthExternal},
	} {
		got, err := parseRemoteAuthMode(tt.raw)
		if err != nil {
			t.Fatalf("parseRemoteAuthMode(%q): %v", tt.raw, err)
		}
		if got != tt.want {
			t.Fatalf("parseRemoteAuthMode(%q) = %v, want %v", tt.raw, got, tt.want)
		}
	}
	for _, raw := range []string{"External", "none", " external", "external "} {
		if _, err := parseRemoteAuthMode(raw); err == nil {
			t.Fatalf("parseRemoteAuthMode(%q) succeeded, want error", raw)
		}
	}
}

func TestValidatePublicBindRequiresExternalModeToUseHTTPSLoopback(t *testing.T) {
	if err := validatePublicBind(server.RemoteAuthExternal, "https://pi.example", "127.0.0.1"); err != nil {
		t.Fatalf("external mode with HTTPS and loopback rejected: %v", err)
	}
	if err := validatePublicBind(server.RemoteAuthExternal, "https://pi.example", "::1"); err != nil {
		t.Fatalf("external mode with IPv6 loopback rejected: %v", err)
	}
	if err := validatePublicBind(server.RemoteAuthExternal, "", "127.0.0.1"); err == nil {
		t.Fatal("external mode without public URL should fail")
	}
	if err := validatePublicBind(server.RemoteAuthExternal, "https://pi.example", "0.0.0.0"); err == nil {
		t.Fatal("external mode with non-loopback bind should fail")
	}
	if err := validatePublicBind(server.RemoteAuthPairing, "https://pi.example", "0.0.0.0"); err == nil {
		t.Fatal("public URL with non-loopback bind should fail")
	}
	if err := validatePublicBind(server.RemoteAuthPairing, "", "0.0.0.0"); err != nil {
		t.Fatalf("non-public bind behavior changed: %v", err)
	}
}

func TestBuildHostContext(t *testing.T) {
	got, err := buildHostContext(" Workstation ", "https://current.example", `[{"label":" Peer ","url":"https://peer.example/"}]`)
	if err != nil {
		t.Fatal(err)
	}
	want := ui.HostContext{InstanceName: "Workstation", CurrentURL: "https://current.example", Peers: []ui.HostPeer{{Label: "Peer", URL: "https://peer.example"}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("host context = %#v, want %#v", got, want)
	}
}

func TestBuildHostContextDefaultsToHostname(t *testing.T) {
	got, err := buildHostContext("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	hostname, _ := os.Hostname()
	if hostname != "" && got.InstanceName != hostname {
		t.Fatalf("instanceName = %q, want hostname %q", got.InstanceName, hostname)
	}
	if got.Peers == nil || len(got.Peers) != 0 {
		t.Fatalf("peers = %#v, want empty array", got.Peers)
	}
}

func TestBuildHostContextRejectsInvalidPeers(t *testing.T) {
	for _, peers := range []string{
		`null`, `{}`, `[{"label":"","url":"https://peer.example"}]`,
		`[{"label":"Peer","url":"http://peer.example"}]`,
		`[{"label":"Peer","url":"https://peer.example/path"}]`,
		`[{"label":"Peer","url":"https://peer.example","extra":true}]`, `[] []`,
	} {
		t.Run(peers, func(t *testing.T) {
			if _, err := buildHostContext("host", "", peers); err == nil {
				t.Fatalf("buildHostContext accepted %s", peers)
			}
		})
	}
}
