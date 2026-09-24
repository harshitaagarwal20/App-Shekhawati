# Shekhawati ERP - Android app

A Capacitor wrapper that opens the live site
(`server.url` in `capacitor.config.json`). Web deployments reach the app
automatically; a blue "New version available - Refresh" bar appears at the top
after each deploy (see `client/src/components/UpdateBanner.jsx`).

A new APK is only needed if the site URL, app name or icon changes.

## Rebuild the APK

```bash
export JAVA_HOME="/c/Users/KUSHJI/android-tools/jdk-21.0.12.1+1"
npm run apk        # -> android/app/build/outputs/apk/release/app-release.apk
```

Before the next APK, bump `versionCode` in `android/app/build.gradle`.

## Keep safe

`shekhawati-release.jks` + `keystore.properties` are the signing key. Back them
up. Without them an updated APK cannot install over the existing app.
