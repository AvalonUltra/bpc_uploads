#!/usr/bin/env bash
# A step of .github/workflows/upstream-sync.yml: commits the release files that
# tools/sync-upstream.mjs staged and pushes the commit to the candidate branch.
#
# Environment:
#   CHANGED            "true" when upstream's files are staged; otherwise an
#                      empty commit is made (a rehearsal of the workflow)
#   UPSTREAM           upstream's commit
#   MESSAGE_FILE       the commit message
#   PUSH_URL           where to push
#   CANDIDATE_BRANCH   the branch for the commit
#   ISSUE_LABEL        the label of the issues about failed syncs
#   GITHUB_EVENT_NAME, GITHUB_OUTPUT (proceed, sha, base), and for gh: GH_TOKEN
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/issues.sh"

base=$(git rev-parse HEAD)

# A release that failed here is not tried again on a schedule until main
# changes or the issue about it is closed. (Where Issues are turned off there
# is no such record, and every scheduled run tries again.)
if [ "${GITHUB_EVENT_NAME:-}" = schedule ]; then
  list_issues --state open --label "$ISSUE_LABEL" --json number,body \
    --jq "[.[] | select((.body // \"\") | contains(\"upstream=$UPSTREAM base=$base\")) | .number] | first // empty"
  known=$ISSUES
  if [ -n "$known" ]; then
    echo "::notice::Upstream $UPSTREAM already failed on this main, see issue #$known. Run the workflow by hand to try again."
    echo "proceed=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
fi

identity=(-c "user.name=github-actions[bot]" -c "user.email=41898282+github-actions[bot]@users.noreply.github.com")
if [ "$CHANGED" = true ]; then
  git "${identity[@]}" commit --quiet -F "$MESSAGE_FILE"
else
  git "${identity[@]}" commit --quiet --allow-empty -m "Rehearsal of the upstream sync (no changes)"
fi
git push --quiet --force "$PUSH_URL" "HEAD:refs/heads/$CANDIDATE_BRANCH"
{
  echo "proceed=true"
  echo "sha=$(git rev-parse HEAD)"
  echo "base=$base"
} >> "$GITHUB_OUTPUT"
