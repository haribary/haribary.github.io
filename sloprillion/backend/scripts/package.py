"""Zip backend/dist/ into backend/dist/function.zip (run scripts/build.mjs first)."""
import os
import sys
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(here, "..", "dist")
out = os.path.join(dist, "function.zip")

if not os.path.isfile(os.path.join(dist, "handler.mjs")):
    sys.exit("dist/handler.mjs missing: run `node scripts/build.mjs` first")
if os.path.exists(out):
    os.remove(out)

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(dist):
        for name in sorted(files):
            path = os.path.join(root, name)
            if path == out:
                continue
            arc = os.path.relpath(path, dist).replace(os.sep, "/")
            z.write(path, arc)
            count += 1

print(f"wrote {out} ({count} files, {os.path.getsize(out)} bytes)")
