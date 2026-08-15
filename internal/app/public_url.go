package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"

	"pi-web/internal/server"
	"pi-web/internal/ui"
)

func validatePublicURL(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if strings.TrimSpace(raw) != raw {
		return "", fmt.Errorf("must not contain leading or trailing whitespace")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "https" || u.Host == "" || u.Hostname() == "" || u.Opaque != "" {
		return "", fmt.Errorf("must be an absolute HTTPS origin")
	}
	if u.User != nil {
		return "", fmt.Errorf("must not include userinfo")
	}
	if strings.Contains(u.Hostname(), "*") {
		return "", fmt.Errorf("must name one exact host, not a wildcard")
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("must not include a non-root path")
	}
	if u.RawQuery != "" || u.ForceQuery {
		return "", fmt.Errorf("must not include a query")
	}
	if strings.Contains(raw, "#") {
		return "", fmt.Errorf("must not include a fragment")
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", fmt.Errorf("must include a valid port when a port separator is present")
	}
	return "https://" + u.Host, nil
}

func parseRemoteAuthMode(raw string) (server.RemoteAuthMode, error) {
	switch raw {
	case "", "pairing":
		return server.RemoteAuthPairing, nil
	case "external":
		return server.RemoteAuthExternal, nil
	default:
		return server.RemoteAuthPairing, fmt.Errorf("must be pairing or external")
	}
}

func validatePublicBind(remoteAuth server.RemoteAuthMode, publicURL, bindHost string) error {
	if remoteAuth == server.RemoteAuthExternal && publicURL == "" {
		return fmt.Errorf("external remote auth requires %s to be an absolute HTTPS origin", publicURLEnvVar)
	}
	if publicURL != "" && !isLoopbackHost(bindHost) {
		return fmt.Errorf("refusing public URL with non-loopback bind host %s; externally managed HTTPS requires pi-web to remain on loopback", bindHost)
	}
	return nil
}

func buildHostContext(instanceName, publicURL, peersJSON string) (ui.HostContext, error) {
	instanceName = strings.TrimSpace(instanceName)
	if instanceName == "" {
		instanceName, _ = os.Hostname()
		instanceName = strings.TrimSpace(instanceName)
		if instanceName == "" {
			instanceName = "pi-web"
		}
	}

	peers := []ui.HostPeer{}
	if peersJSON != "" {
		decoder := json.NewDecoder(strings.NewReader(peersJSON))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&peers); err != nil {
			return ui.HostContext{}, fmt.Errorf("%s: %w", peersJSONEnvVar, err)
		}
		if peers == nil {
			return ui.HostContext{}, fmt.Errorf("%s must be a JSON array", peersJSONEnvVar)
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			if err == nil {
				err = fmt.Errorf("multiple JSON values")
			}
			return ui.HostContext{}, fmt.Errorf("%s: %w", peersJSONEnvVar, err)
		}
	}
	for i := range peers {
		peers[i].Label = strings.TrimSpace(peers[i].Label)
		if peers[i].Label == "" {
			return ui.HostContext{}, fmt.Errorf("%s peer %d has an empty label", peersJSONEnvVar, i)
		}
		peerURL, err := validatePublicURL(peers[i].URL)
		if err != nil || peerURL == "" {
			if err == nil {
				err = fmt.Errorf("must not be empty")
			}
			return ui.HostContext{}, fmt.Errorf("%s peer %d URL: %w", peersJSONEnvVar, i, err)
		}
		peers[i].URL = peerURL
	}
	return ui.HostContext{
		InstanceName: instanceName,
		CurrentURL:   publicURL,
		Peers:        peers,
	}, nil
}
