package rpc

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func writeDefaultsStub(t *testing.T, provider, modelID, thinkingLevel string) {
	t.Helper()
	binDir := t.TempDir()
	piPath := filepath.Join(binDir, "pi")
	script := `#!/usr/bin/python3
import json
import os
import sys
if sys.argv[1:] != ["--mode", "rpc", "--no-session", "--no-context-files"]:
    print("unexpected arguments: " + repr(sys.argv[1:]), file=sys.stderr)
    sys.exit(2)
request = json.loads(sys.stdin.readline())
print(json.dumps({
    "id": request["id"],
    "type": "response",
    "success": True,
    "data": {
        "model": {
            "provider": os.environ["TEST_PROVIDER"],
            "id": os.environ["TEST_MODEL"],
        },
        "thinkingLevel": os.environ["TEST_THINKING"],
    },
}), flush=True)
`
	if err := os.WriteFile(piPath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TEST_PROVIDER", provider)
	t.Setenv("TEST_MODEL", modelID)
	t.Setenv("TEST_THINKING", thinkingLevel)
}

func TestResolveSessionDefaultsUsesExtensionAwareEphemeralRPC(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake executable uses a Python shebang")
	}
	writeDefaultsStub(t, "openai-codex-secondary", "gpt-5.6-sol", "high")

	got, err := ResolveSessionDefaults(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.ModelProvider != "openai-codex-secondary" || got.ModelID != "gpt-5.6-sol" || got.ThinkingLevel != "high" {
		t.Fatalf("defaults = %#v", got)
	}
}

func TestResolveSessionDefaultsRejectsPiUnknownSentinel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake executable uses a Python shebang")
	}
	writeDefaultsStub(t, "unknown", "unknown", "off")

	if _, err := ResolveSessionDefaults(context.Background()); err == nil {
		t.Fatal("unknown Pi defaults must be rejected")
	}
}
