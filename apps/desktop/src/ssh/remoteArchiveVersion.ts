// Locally patched Desktop builds append `-local.<commit>` to the upstream
// version. Only upstream versions are published as release archives, so SSH
// hosts must download the upstream runtime the local build is based on.
const LOCAL_BUILD_SUFFIX = /-local\.[0-9A-Za-z-]+$/u;

export function remoteArchiveVersion(appVersion: string): string {
  return appVersion.trim().replace(LOCAL_BUILD_SUFFIX, "");
}
