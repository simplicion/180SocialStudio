#!/usr/bin/env bash
# Runs an on-device render integration test on an Android emulator / device and keeps the media fixtures pushed
# (`flutter test` reinstalls the app, which wipes its files directory). The test writes test_assets/.waiting when it
# is ready for them.
#
#   [FILTER=name] tool/run_render_tests.sh [integration_test/media_engine_render_test.dart] [emulator-5554]
#
# Needs: ANDROID_HOME or %LOCALAPPDATA%/Android/Sdk, flutter on PATH, fixtures in test_assets/ (gitignored):
#   speech_obama_30s.mp4, sample-15s.mp4, sample-15s.mp3
set -u
TEST="${1:-integration_test/media_engine_render_test.dart}"
DEVICE="${2:-emulator-5554}"
SDK="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
[ -x "$ADB" ] || ADB="$SDK/platform-tools/adb.exe"
PKG=com.workspace180.social_studio_mobile
EXT=/sdcard/Android/data/$PKG/files/test_assets
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

if ! "$ADB" devices | grep -q "^$DEVICE"; then
  echo "Starting emulator Pixel_7_API_34…"
  ("$SDK/emulator/emulator" -avd Pixel_7_API_34 -no-window -no-audio -no-boot-anim -no-snapshot-save -gpu swiftshader_indirect >/dev/null 2>&1 &)
  "$ADB" wait-for-device
  until [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
fi

LOG="$(mktemp)"
# FILTER="reverse" runs only the tests whose name contains it (plus setup).
if [ -n "${FILTER:-}" ]; then
  flutter test "$TEST" -d "$DEVICE" --plain-name "$FILTER" >"$LOG" 2>&1 &
else
  flutter test "$TEST" -d "$DEVICE" >"$LOG" 2>&1 &
fi
TEST_PID=$!

push_fixtures() {
  "$ADB" -s "$DEVICE" shell mkdir -p $EXT >/dev/null 2>&1
  "$ADB" -s "$DEVICE" push test_assets/speech_obama_30s.mp4 $EXT/speech.mp4 >/dev/null 2>&1
  "$ADB" -s "$DEVICE" push test_assets/sample-15s.mp4 $EXT/broll.mp4 >/dev/null 2>&1
  "$ADB" -s "$DEVICE" push test_assets/sample-15s.mp3 $EXT/music.mp3 >/dev/null 2>&1
  # The voiceover recorder test needs the microphone without a permission dialog.
  "$ADB" -s "$DEVICE" shell pm grant $PKG android.permission.RECORD_AUDIO >/dev/null 2>&1
  "$ADB" -s "$DEVICE" shell touch $EXT/.ready >/dev/null 2>&1
}

while kill -0 $TEST_PID 2>/dev/null; do
  # The test writes .waiting once the freshly installed app is running; pushing earlier lands in a directory the
  # reinstall replaces.
  if "$ADB" -s "$DEVICE" shell "ls $EXT/.waiting && ! ls $EXT/.ready" >/dev/null 2>&1; then
    push_fixtures && echo "[fixtures pushed $(date +%T)]"
  fi
  sleep 5
done
wait $TEST_PID
STATUS=$?
grep -E "^[0-9:]+ \+|Expected|Actual|reason|MEDIA_ENGINE_REPORT|passed|failed" "$LOG" | tail -40
rm -f "$LOG"
exit $STATUS
