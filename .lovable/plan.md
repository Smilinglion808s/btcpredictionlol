# V3 timing patch: review-branch capability check (no action)

## Finding
This session can't safely publish the patch on its own review branch. Nothing was edited or pushed.

- Edits made here are saved to Lovable's internal repository, not straight to GitHub. The working branch is an internal edit branch (`edit/edt-...`), currently at `07d50caa`.
- The two-way GitHub sync follows the project's connected branch, which is normally `main`. Anything committed here becomes part of that branch and syncs to it.
- None of the tools I have here can create a separate GitHub branch, push only to it, or change the connected branch. Switching branches is done in the editor's GitHub settings, and it changes the branch for the whole project.
- I can't see from here which branch is selected in GitHub settings, whether a preview service builds every branch, or how your Railway auto-deploy is set up.

## Recommendation
Push the review branch using your own GitHub access (your separate plugin or a local clone): create a new branch from the current main and apply the exact patch there. Don't switch Lovable's connected branch, because this project's edits would then go to that branch. Railway services only redeploy for their watched branch and paths, so check that the V3 service doesn't watch the new branch.

## If you still want it done through Lovable
The only way is to switch the project's connected branch in the editor's GitHub settings. That affects everything, so it isn't recommended. Approving this plan does nothing on its own.
