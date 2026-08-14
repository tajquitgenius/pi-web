package rpc

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveSessionDefaultsUsesExtensionAwareEphemeralRPC(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake executable uses a Python shebang")
	}
	binDir := t.TempDir()
	piPath := filepath.Join(binDir, "pi")
	script := `#!/usr/bin/python3
import json
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
            "provider": "openai-codex-secondary",
            "id": "gpt-5.6-sol",
            "name": "GPT-5.6 Sol",
        },
        "thinkingLevel": "high",
    },
}), flush=True)
`
	if err := os.WriteFile(piPath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	got, err := ResolveSessionDefaults(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.ModelProvider != "openai-codex-secondary" || got.ModelID != "gpt-5.6-sol" || got.ThinkingLevel != "high" {
		t.Fatalf("defaults = %#v", got)
	}
}
