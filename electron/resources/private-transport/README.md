# Private transport sidecar binaries

`npm run build:private-transport --prefix electron` writes the current-platform
binary here using this layout:

```
private-transport/
  linux-x64/qortal-private-transport
  linux-arm64/qortal-private-transport
  darwin-x64/qortal-private-transport
  darwin-arm64/qortal-private-transport
  windows-x64/qortal-private-transport.exe
  windows-arm64/qortal-private-transport.exe
```

The binaries are generated artifacts and are not committed. Release jobs must
build the target artifact before invoking electron-builder. The Go program is
CGO-free, but signing/notarization of packaged macOS and Windows binaries remains
a release-pipeline responsibility.
