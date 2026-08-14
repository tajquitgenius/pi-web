package rpc

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestNewPiWorkerStartsDirectlyOnSession(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake executable uses a Python shebang")
	}
	binDir := t.TempDir()
	sessionPath := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(sessionPath, []byte("{}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	piPath := filepath.Join(binDir, "pi")
	script := `#!/usr/bin/python3
import json
import os
import sys
expected = ["--mode", "rpc", "--session", os.environ["PI_WEB_TEST_SESSION_PATH"]]
if sys.argv[1:] != expected:
    print("unexpected arguments: " + repr(sys.argv[1:]), file=sys.stderr)
    sys.exit(2)
for line in sys.stdin:
    request = json.loads(line)
    if request["type"] == "switch_session":
        print("switch_session must not be used during startup", file=sys.stderr)
        sys.exit(3)
    if request["type"] == "get_state":
        print(json.dumps({
            "id": request["id"],
            "type": "response",
            "success": True,
            "data": {
                "model": {"provider": "openai-codex-secondary", "id": "gpt-5.6-sol"},
                "thinkingLevel": "high",
            },
        }), flush=True)
`
	if err := os.WriteFile(piPath, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PI_WEB_TEST_SESSION_PATH", sessionPath)

	worker, err := NewPiWorkerWithStream(sessionPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	state := worker.Status()
	if state.ModelProvider != "openai-codex-secondary" {
		t.Fatalf("provider = %q", state.ModelProvider)
	}
}
