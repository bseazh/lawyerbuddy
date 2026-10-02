#!/usr/bin/env python3
"""Safely get/set/unset only RESOURCE_FILE in the protected API env file."""

import os
import re
import shlex
import stat
import sys
import tempfile
from pathlib import Path


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: set-resource-file.py get|set|unset ENV_FILE [RESOURCE_PATH]")
    action, env_path = sys.argv[1], Path(sys.argv[2])
    if action not in {"get", "set", "unset"} or (action == "set") != (len(sys.argv) == 4):
        raise SystemExit("invalid action or arguments")

    content = env_path.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    matcher = re.compile(r"^\s*(?:export\s+)?RESOURCE_FILE\s*=")
    indexes = [index for index, line in enumerate(lines) if matcher.match(line)]
    if len(indexes) > 1:
        raise SystemExit("multiple RESOURCE_FILE entries found; refusing to modify")

    if action == "get":
        if indexes:
            raw_value = lines[indexes[0]].split("=", 1)[1].strip()
            parsed = shlex.split(raw_value)
            if len(parsed) > 1:
                raise SystemExit("invalid RESOURCE_FILE value")
            print(parsed[0] if parsed else "")
        return

    if action == "set":
        value = "RESOURCE_FILE=" + shlex.quote(sys.argv[3]) + "\n"
        if indexes:
            lines[indexes[0]] = value
        else:
            if lines and not lines[-1].endswith(("\n", "\r")):
                lines[-1] += "\n"
            lines.append(value)
    else:
        lines = [line for line in lines if not matcher.match(line)]

    metadata = env_path.stat()
    descriptor, temporary = tempfile.mkstemp(prefix=f".{env_path.name}.", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
            output.writelines(lines)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, env_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    main()
