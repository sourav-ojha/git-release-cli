import { renderTitle } from '../github/pull-request.js';

export function buildPullRequestBody({ branch, base, production, cutoff, commitCount, markdown }) {
  return [
    `Release branch \`${branch}\` cut from \`${base}\` at \`${cutoff.slice(0, 12)}\`, targeting \`${production}\`.`,
    `${commitCount} commit${commitCount === 1 ? '' : 's'} since \`${production}\`.`,
    '',
    markdown,
    '',
  ].join('\n');
}

export function plannedOperations(plan) {
  const { config, branch, cutoff, title } = plan;
  const { remote } = config.git;
  const ops = [];
  if (config.git.fetchBeforeRelease) ops.push(`git fetch ${remote}`);
  ops.push(`git branch --no-track ${branch} ${cutoff}`);
  if (config.options.pushBranch) ops.push(`git push --set-upstream ${remote} refs/heads/${branch}:refs/heads/${branch}`);
  if (config.options.createPullRequest) {
    const pr = config.pullRequest;
    const extra = [
      pr.draft ? '--draft' : '',
      ...pr.labels.map((l) => `--label ${JSON.stringify(l)}`),
      ...pr.reviewers.map((r) => `--reviewer ${r}`),
      ...pr.assignees.map((a) => `--assignee ${a}`),
    ].filter(Boolean);
    ops.push(
      `gh pr create --base ${config.release.productionBranch} --head ${branch} --title ${JSON.stringify(title)} --body-file <generated>${extra.length ? ` ${extra.join(' ')}` : ''}`,
    );
  }
  return ops;
}

export function formatPlan(plan) {
  const { config, repoRoot, baseSha, productionSha, cutoff, cutoffSource, commitCount, branch, title, body, dryRun, notes = [] } = plan;
  const { remote } = config.git;
  const lines = [
    dryRun ? 'RELEASE PLAN — DRY RUN (no changes will be made)' : 'RELEASE PLAN',
    '',
    `  Repository:  ${repoRoot}`,
    `  Base:        ${config.release.baseBranch} (${remote}/${config.release.baseBranch} @ ${baseSha.slice(0, 12)})`,
    `  Production:  ${config.release.productionBranch} (${remote}/${config.release.productionBranch} @ ${productionSha.slice(0, 12)})`,
    `  Cutoff:      ${cutoff} (${cutoffSource})`,
    `  Commits:     ${commitCount} in ${config.release.productionBranch}..cutoff`,
    `  New branch:  ${branch}`,
    `  PR:          ${config.options.createPullRequest ? `${branch} -> ${config.release.productionBranch}${config.pullRequest.draft ? ' (draft)' : ''}` : 'not requested'}`,
    '',
    dryRun ? 'Operations that would run:' : 'Operations:',
    ...plannedOperations({ config, branch, cutoff, title }).map((op, i) => `  ${i + 1}. ${op}`),
  ];
  if (config.options.createPullRequest) lines.push('', `PR title: ${title}`);
  lines.push('', config.options.createPullRequest ? 'PR description:' : 'Release notes:', '', ...body.split('\n').map((l) => `  | ${l}`));
  if (notes.length) lines.push('', ...notes.map((n) => `Note: ${n}`));
  return lines.join('\n');
}

export function formatFinalSummary({ branch, cutoff, commitCount, pushed, pullRequest, config }) {
  const lines = [
    'Release prepared:',
    `  Branch:   ${branch} @ ${cutoff.slice(0, 12)} (${commitCount} commits)`,
    `  Pushed:   ${pushed ? `yes (${config.git.remote})` : 'no'}`,
  ];
  if (pullRequest) lines.push(`  PR:       ${pullRequest.url}${pullRequest.created ? '' : ' (already existed)'}`);
  else lines.push('  PR:       not created');
  return lines.join('\n');
}

export { renderTitle };
