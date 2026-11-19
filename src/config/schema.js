import { z } from 'zod';
import { TIMESTAMP_TOKEN_PATTERN } from '../utils/date.js';

export const TITLE_PLACEHOLDERS = ['date', 'branch', 'commit'];

const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

const refName = (label) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .max(200)
    .regex(SAFE_REF, `${label} may only contain letters, digits, ".", "_", "-" and "/"`)
    .refine((v) => !v.startsWith('-') && !v.startsWith('/') && !v.endsWith('/') && !v.endsWith('.'), {
      message: `${label} must not start with "-" or "/" or end with "/" or "."`,
    })
    .refine((v) => !v.includes('..') && !v.includes('//') && !v.endsWith('.lock'), {
      message: `${label} is not a valid Git ref name`,
    });

const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9@._/-]+$/, 'contains unsupported characters');

const timestampFormat = z
  .string()
  .min(1)
  .refine((v) => v.replace(TIMESTAMP_TOKEN_PATTERN, '').replace(/[-_.]/g, '') === '', {
    message: 'may only contain the tokens YYYY, MM, DD, HH, mm, ss and the separators "-", "_", "."',
  })
  .refine((v) => /YYYY/.test(v) && /MM/.test(v) && /DD/.test(v), {
    message: 'must include YYYY, MM and DD',
  });

const prTitle = z
  .string()
  .min(1)
  .max(250)
  .superRefine((value, ctx) => {
    for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
      if (!TITLE_PLACEHOLDERS.includes(match[1])) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown placeholder {${match[1]}}; supported: ${TITLE_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`,
        });
      }
    }
  });

const releaseSchema = z
  .object({
    baseBranch: refName('baseBranch'),
    productionBranch: refName('productionBranch'),
    branchPrefix: refName('branchPrefix').default('release'),
    branchTimestampFormat: timestampFormat.default('YYYYMMDD-HHmmss'),
    productionMergeStyle: z.enum(['merge', 'squash']).default('merge'),
  })
  .strict();

const pullRequestSchema = z
  .object({
    title: prTitle.default('Release: {date}'),
    draft: z.boolean().default(false),
    labels: z.array(z.string().min(1).max(100)).default([]),
    reviewers: z.array(identifier).default([]),
    assignees: z.array(identifier).default([]),
    includeCommitAuthors: z.boolean().default(false),
  })
  .strict();

const gitSchema = z
  .object({
    remote: identifier.default('origin'),
    fetchBeforeRelease: z.boolean().default(true),
    requireCleanWorkingTree: z.boolean().default(true),
  })
  .strict();

const changelogSchema = z
  .object({
    includeMerges: z.boolean().default(false),
  })
  .strict();

const optionsSchema = z
  .object({
    dryRun: z.boolean().default(true),
    pushBranch: z.boolean().default(true),
    createPullRequest: z.boolean().default(true),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    release: releaseSchema,
    pullRequest: pullRequestSchema.prefault({}),
    git: gitSchema.prefault({}),
    changelog: changelogSchema.prefault({}),
    options: optionsSchema.prefault({}),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.release.baseBranch === cfg.release.productionBranch) {
      ctx.addIssue({
        code: 'custom',
        path: ['release', 'productionBranch'],
        message: 'must differ from release.baseBranch',
      });
    }
    if (cfg.options.createPullRequest && !cfg.options.pushBranch) {
      ctx.addIssue({
        code: 'custom',
        path: ['options', 'createPullRequest'],
        message: 'a pull request needs the branch on the remote; enable options.pushBranch or disable createPullRequest',
      });
    }
  });

export function formatZodIssues(error) {
  return error.issues.map((issue) => {
    const where = issue.path.length ? issue.path.join('.') : '(root)';
    return `  - ${where}: ${issue.message}`;
  });
}
