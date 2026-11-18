# Sourced by tools/ci/candidate.sh and tools/ci/report.sh.
#
# GitHub turns Issues off in a new fork, and `gh issue list` then fails
# ("the '…' repository has disabled issues"). list_issues treats that as
# "no issues": it sets ISSUES to the output of `gh issue list "$@"`, or, where
# Issues are off, to nothing and ISSUES_OFF to true. Any other error of gh
# stops the script as before.
ISSUES=
ISSUES_OFF=false

list_issues() {
  local err status=0
  err=$(mktemp)
  ISSUES=$(gh issue list "$@" 2>"$err") || status=$?
  if [ "$status" -ne 0 ] && grep -qi 'disabled issues' "$err"; then
    ISSUES=
    ISSUES_OFF=true
    echo "::notice::Issues are turned off for this repository (Settings → General → Features → Issues), so failed syncs are not reported in issues."
    status=0
  elif [ "$status" -ne 0 ]; then
    cat "$err" >&2
  fi
  rm -f "$err"
  return "$status"
}
