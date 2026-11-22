#!/usr/bin/env bash
# Build a signed APK for Liquid Store with the JDK + Android build-tools
# directly (no Gradle): aapt2, javac, d8, zipalign, apksigner.
#
# Everything is taken from the environment, so a checkout builds anywhere:
#
#   JAVA_HOME   JDK 17                     (default: /scratch/work/jdk)
#   SDK         Android SDK root           (default: /scratch/work/sdk)
#   BT          build-tools directory      (default: $SDK/build-tools/android-14)
#   AJ          android.jar                (default: $SDK/platforms/android-34/android.jar)
#   GSON        gson-2.10.1.jar            (default: /scratch/work/libs/gson-2.10.1.jar)
#   KEYSTORE    signing key                (default: ./liquid.keystore, created on first build)
#   KS_PASS     its password               (default: change-me — pass your own)
#   OUT         where the APK lands        (default: /scratch/output)
#
# The keystore lives outside build/ on purpose: a clean must not change the
# signing key, or every update becomes a reinstall.
set -e
ulimit -v unlimited

APP=$(cd "$(dirname "$0")" && pwd)
JAVA_HOME=${JAVA_HOME:-/scratch/work/jdk}
JAVA="$JAVA_HOME/bin/java"
SDK=${SDK:-/scratch/work/sdk}
BT=${BT:-$SDK/build-tools/android-14}
AJ=${AJ:-$SDK/platforms/android-34/android.jar}
GSON=${GSON:-/scratch/work/libs/gson-2.10.1.jar}
KEYSTORE=${KEYSTORE:-$APP/liquid.keystore}
KS_PASS=${KS_PASS:-change-me}
OUT=${OUT:-/scratch/output}
JVM_FLAGS="-Xmx512m -Xms64m -Xss1m -XX:CompressedClassSpaceSize=128m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=64m -XX:-UsePerfData -XX:+UseSerialGC"

for f in "$BT/aapt2" "$AJ" "$GSON" "$JAVA_HOME/bin/javac"; do
  [ -e "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

cd "$APP"
rm -rf build
mkdir -p build/gen build/classes build/dex

echo "[1/7] compile resources"
"$BT/aapt2" compile --dir res -o build/res.zip

echo "[2/7] link resources + assets"
"$BT/aapt2" link -o build/base.apk \
  -I "$AJ" \
  --manifest AndroidManifest.xml \
  -R build/res.zip \
  --java build/gen \
  --min-sdk-version 24 --target-sdk-version 34 \
  -A assets \
  --auto-add-overlay

echo "[3/7] compile java"
find build/gen -name '*.java' > build/sources.txt
find src -name '*.java' >> build/sources.txt
"$JAVA_HOME/bin/javac" -source 8 -target 8 -nowarn -Xlint:-options \
  -bootclasspath "$AJ" -classpath "$AJ:$GSON" \
  -d build/classes @build/sources.txt

echo "[4/7] dex"
"$JAVA" $JVM_FLAGS -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$AJ" --min-api 24 --output build/dex \
  $(find build/classes -name '*.class') "$GSON"

echo "[5/7] package"
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -X ../unsigned.apk classes.dex)

echo "[6/7] zipalign"
"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk

echo "[7/7] sign"
if [ ! -f "$KEYSTORE" ]; then
  echo "  creating $KEYSTORE"
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias liquid -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Liquid Store, OU=Apps, O=Liquid, L=Bengaluru, C=IN" >/dev/null 2>&1
fi
mkdir -p "$OUT"
"$JAVA" $JVM_FLAGS -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool sign \
  --ks "$KEYSTORE" --ks-pass pass:"$KS_PASS" --key-pass pass:"$KS_PASS" \
  --ks-key-alias liquid --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/LiquidStore.apk" build/aligned.apk
rm -f "$OUT/LiquidStore.apk.idsig"

"$JAVA" $JVM_FLAGS -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool verify "$OUT/LiquidStore.apk"

cp "$OUT/LiquidStore.apk" dist/LiquidStore.apk
echo "done -> $OUT/LiquidStore.apk (and dist/LiquidStore.apk)"
