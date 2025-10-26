# Release process

This guide explains how to create a dedicated release branch so that tags can be produced from a validated state.

## Creating a release branch

1. Open the **Actions** tab in GitHub and run the **Create release branch** workflow.
2. Provide the semantic version that will be released (for example `0.2.0`). The workflow sanitises the value and creates a branch named `release/v<version>`.
3. Optionally override the base reference if you need to branch from something other than `main`.
4. Wait for the workflow to finish. It verifies that the target branch does not already exist, then pushes the new release branch to `origin`.
5. When the branch is available, open a pull request if you want additional validation or go straight to tagging once checks have passed.

## Creating the tag

After the release branch has been created and validated:

1. Check out the `release/v<version>` branch locally.
2. Create the tag (for example `git tag v0.2.0`) and push it (`git push origin v0.2.0`).
3. Draft the release notes and publish the release using the tag as the source.

This separation ensures that release candidates can be tested without disrupting the `main` branch.
