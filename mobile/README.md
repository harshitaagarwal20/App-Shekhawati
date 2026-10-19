# Shekhawati ERP - Android app

A Capacitor wrapper that opens the live site
(`server.url` in `capacitor.config.json`) - the Static Web App, so deploy with
`tools/azure-deploy.ps1 -Swa` or the app keeps the previous build. Web
deployments then reach the app automatically: within a minute a blue bar
announces the new version, and the app reloads onto it by itself at the next
screen change, or once it is idle with nothing typed (see
`client/src/components/UpdateBanner.jsx`).

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
