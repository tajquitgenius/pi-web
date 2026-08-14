#!/usr/bin/env python3
import json
import os
import plistlib
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ServiceEnvironmentTest(unittest.TestCase):
    def test_launchd_loader_strips_env_file_quotes(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            config = home / ".config" / "pi-web"
            config.mkdir(parents=True)
            (config / "env").write_text(
                "PI_WEB_INSTANCE_NAME='Personal laptop'\n"
                "PI_WEB_PUBLIC_URL=https://personal-pi.example.com\n"
                "PI_WEB_PEERS_JSON='[{\"label\":\"Work laptop\",\"url\":\"https://work-pi.example.com\"}]'\n"
                "PI_WEB_TOKEN=test-token\n"
            )

            output = home / "environment.json"
            probe = home / "probe"
            probe.write_text(
                "#!/bin/sh\n"
                "python3 -c 'import json, os, sys; "
                "json.dump({key: os.environ.get(key) for key in "
                "[\"PI_WEB_INSTANCE_NAME\", \"PI_WEB_PUBLIC_URL\", "
                "\"PI_WEB_PEERS_JSON\", \"PI_WEB_TOKEN\"]}, open(sys.argv[1], \"w\"))' "
                '"$PI_WEB_ENV_OUTPUT"\n'
            )
            probe.chmod(probe.stat().st_mode | stat.S_IXUSR)

            with (ROOT / "init" / "com.pi-web.plist").open("rb") as file:
                arguments = plistlib.load(file)["ProgramArguments"]
            self.assertEqual(arguments[:2], ["/bin/sh", "-c"])

            environment = os.environ.copy()
            environment.update({"HOME": str(home), "PI_WEB_ENV_OUTPUT": str(output)})
            subprocess.run(
                [arguments[0], arguments[1], arguments[2], str(probe)],
                env=environment,
                check=True,
            )

            values = json.loads(output.read_text())
            self.assertEqual(values["PI_WEB_INSTANCE_NAME"], "Personal laptop")
            self.assertEqual(values["PI_WEB_PUBLIC_URL"], "https://personal-pi.example.com")
            self.assertEqual(
                values["PI_WEB_PEERS_JSON"],
                '[{"label":"Work laptop","url":"https://work-pi.example.com"}]',
            )
            self.assertEqual(values["PI_WEB_TOKEN"], "test-token")


if __name__ == "__main__":
    unittest.main()
