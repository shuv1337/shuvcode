export type DraftRelease = {
  tagName: string
  name: string
  targetCommitish: string
  isDraft: boolean
}

export function planDraftRelease(
  tag: string,
  target: string,
  release: DraftRelease | undefined,
  tagTarget: string | undefined,
) {
  if (!release) {
    if (tagTarget) throw new Error(`Tag ${tag} already exists without a matching draft release`)
    return "create" as const
  }
  if (!release.isDraft) throw new Error(`Release ${tag} is already published`)
  if (release.tagName !== tag || release.name !== tag)
    throw new Error(`Draft release ${tag} does not match the target release`)
  if (release.targetCommitish !== target) {
    throw new Error(`Draft release ${tag} targets ${release.targetCommitish}, not ${target}`)
  }
  if (tagTarget && tagTarget !== target) throw new Error(`Tag ${tag} targets ${tagTarget}, not ${target}`)
  return "reuse" as const
}
