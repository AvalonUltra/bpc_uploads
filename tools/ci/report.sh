#!/usr/bin/env bash
# The last step of .github/workflows/upstream-sync.yml: closes the issue about
# a failed sync when main has upstream's release, and opens or updates it when
# this run failed. Where the repository has Issues turned off, a failure is
# written to the summary of the run instead, and this step fails, so that the
# run is marked as failed and GitHub tells the owner.
#
# Environment:
#   CHANGED            "true" when upstream had a release that main has not
#   VERSION            upstream's version
#   RUN_URL            the page of this run
# and when this run tried to accept the release:
#   PROCEED            "true"
#   TEST, ENGINE, PROMOTE   the results of those jobs
#   UPSTREAM, BASE, SHA     what was tried
#   FAILURES           lines of the test job about what failed (may be empty)
#   CANDIDATE_BRANCH, ISSUE_LABEL, GITHUB_REPOSITORY_OWNER, RUNNER_TEMP,
#   GITHUB_STEP_SUMMARY, and for gh: GH_TOKEN, GH_REPO
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/issues.sh"

# The first job calls this with the first few of these only, when upstream has nothing new.
: "${PROCEED:=}" "${TEST:=}" "${ENGINE:=}" "${PROMOTE:=}" "${UPSTREAM:=}" "${BASE:=}" "${SHA:=}" "${FAILURES:=}"

list_issues --state open --label "$ISSUE_LABEL" --json number --jq '.[].number'
open=$ISSUES

# main has upstream's current release: what failed before is over.
if { [ "$CHANGED" = false ] && [ "$PROCEED" != true ]; } || [ "$PROMOTE" = success ]; then
  for number in $open; do
    gh issue close "$number" --comment "\`main\` 现在和上游一致（$VERSION），这个问题已经解决。运行记录：$RUN_URL"
  done
  exit 0
fi
# A failure that is already reported and was not tried again.
[ "$PROCEED" = true ] || exit 0

body="$RUNNER_TEMP/upstream-sync-issue.md"
{
  echo "上游发布了 **$VERSION**，但自动同步没有通过检查，\`main\` 没有改动。"
  echo
  echo "| 步骤 | 结果 |"
  echo "| --- | --- |"
  echo "| 构建和 Node 测试 | $TEST |"
  echo "| WebKit 引擎和 Safari 测试 | $ENGINE |"
  echo "| 合入 main | $PROMOTE |"
  echo
  echo "- 运行记录：$RUN_URL"
  echo "- 候选提交：\`${SHA:0:7}\`，在分支 \`$CANDIDATE_BRANCH\` 上"
  if [ -n "$FAILURES" ]; then
    # Text from the test run: shown as it is, never as markup or a mention.
    echo
    echo '```text'
    printf '%s\n' "$FAILURES" | tr -d '`' | sed -e 's/@/(at)/g' | cut -c1-300 | head -25
    echo '```'
  fi
  echo
  echo "怎么处理："
  echo
  echo "- 构建报 \`expected … match(es)\` 这类错误，说明上游改了代码，\`safari/build.mjs\` 里的某个补丁对不上了。改好补丁并合入 \`main\` 之后，下一次定时运行会自动重试。"
  echo "- 如果只是偶然失败，在 Actions 页面手动运行一次「Upstream sync」就会重试；关闭这个 issue 也会让下一次定时运行重试。"
  echo "- 同步成功后这个 issue 会自动关闭。"
  echo
  echo "<!-- upstream=$UPSTREAM base=$BASE -->"
} > "$body"

title="上游同步失败：$VERSION"
if [ "$ISSUES_OFF" = true ]; then
  {
    echo "## $title"
    echo
    echo "> 这个仓库关闭了 Issues，所以失败写在这里。打开 Settings → General → Features → Issues 后，失败会记在带 \`$ISSUE_LABEL\` 标签的 issue 里。"
    echo
    grep -v '^<!-- upstream=' "$body"
  } >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"
  echo "::error::$title. The repository has Issues turned off; the report is in the summary of this run: $RUN_URL"
  exit 1
fi
first=$(printf '%s\n' "$open" | head -1)
if [ -n "$first" ]; then
  gh issue edit "$first" --title "$title" --body-file "$body"
  gh issue comment "$first" --body "又失败了一次：$RUN_URL"
else
  gh label create "$ISSUE_LABEL" --color D93F0B --description "The automatic upstream sync failed" --force
  gh issue create --title "$title" --body-file "$body" --label "$ISSUE_LABEL" --assignee "$GITHUB_REPOSITORY_OWNER" ||
    gh issue create --title "$title" --body-file "$body" --label "$ISSUE_LABEL"
fi
